"""
Model resource manager for the AI pipeline.

This module provides a small helper class that lazily loads models
on first use. It reads the model identifiers from the runtime
configuration (see :mod:`apps.ai.config`) and encapsulates the
fallback behaviour in environments where the heavy dependencies are
not installed. If a given model cannot be loaded (due to missing
packages or absent weights) the corresponding attribute will be
``None`` and downstream stages should handle that scenario
gracefully (often by emitting placeholder outputs).
"""

from __future__ import annotations

import importlib
import gc
from typing import Any, Dict, Optional

from .config import Config


class Resources:
    """Lazily load and expose ML models for the pipeline.

    Parameters
    ----------
    config : Config
        Loaded configuration. The selected models are read from
        ``config.selected_models``.

    Notes
    -----
    - Whisper, pyannote and LLM models are loaded the first time
      their respective properties are accessed. Subsequent access
      returns the cached instance.
    - If the required Python package is not available or the model
      cannot be loaded, the property returns ``None``. Consumers
      should check for ``None`` and implement fallback logic.
    """

    def __init__(self, config: Config) -> None:
        self.config: Config = config
        self._whisper_model: Optional[Any] = None
        self._diar_pipeline: Optional[Any] = None
        self._llm_cat: Optional[Any] = None
        self._llm_sum: Optional[Any] = None

    # ------------------------------------------------------------------
    # Whisper ASR model
    # ------------------------------------------------------------------
    @property
    def whisper_model(self) -> Optional[Any]:
        """Return the loaded Whisper model or ``None`` if unavailable."""
        if self._whisper_model is None:
            model_size = self.config.selected_models.get("whisper")
            if not model_size:
                return None
            try:
                whisper = importlib.import_module("whisper")
                torch = importlib.import_module("torch")
            except ImportError:
                # openai-whisper is not installed
                self._whisper_model = None
                return None
            try:
                preferred_device = "cuda" if torch.cuda.is_available() else "cpu"
                self._whisper_model = whisper.load_model(model_size, device=preferred_device)
                print(f"[Resources] Loaded Whisper model '{model_size}' on {preferred_device.upper()}.")
            except Exception as exc:
                if "cuda" in str(exc).lower() or "gpu" in str(exc).lower():
                    print(f"[Resources] Failed to load Whisper on CUDA ({exc}); retrying on CPU.")
                    try:
                        self._whisper_model = whisper.load_model(model_size, device="cpu")
                        print(f"[Resources] Loaded Whisper model '{model_size}' on CPU.")
                    except Exception as cpu_exc:
                        print(f"[Resources] Failed to load Whisper model '{model_size}' on CPU: {cpu_exc}")
                        self._whisper_model = None
                else:
                    print(f"[Resources] Failed to load Whisper model '{model_size}': {exc}")
                    self._whisper_model = None
        return self._whisper_model

    # ------------------------------------------------------------------
    # Pyannote diarisation pipeline
    # ------------------------------------------------------------------
    @property
    def diarization_pipeline(self) -> Optional[Any]:
        """Return a pyannote.audio Pipeline instance or ``None`` if unavailable."""
        if self._diar_pipeline is None:
            repo_id = self.config.selected_models.get("diar")
            if not repo_id:
                return None
            try:
                from pyannote.audio import Pipeline
                torch = importlib.import_module("torch")
            except Exception:
                self._diar_pipeline = None
                return None
            # Attempt to load the pipeline; silently ignore errors
            try:
                pipeline = Pipeline.from_pretrained(repo_id)
                preferred_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                if hasattr(pipeline, "to"):
                    try:
                        pipeline.to(preferred_device)
                        print(f"[Resources] Loaded diarisation pipeline '{repo_id}' on {preferred_device}.")
                    except Exception as exc:
                        if preferred_device.type == "cuda":
                            print(f"[Resources] Failed to move diarisation pipeline to CUDA ({exc}); retrying on CPU.")
                            pipeline.to(torch.device("cpu"))
                            print(f"[Resources] Loaded diarisation pipeline '{repo_id}' on CPU.")
                        else:
                            print(f"[Resources] Loaded diarisation pipeline '{repo_id}' on CPU.")
                self._diar_pipeline = pipeline
            except Exception as exc:
                print(f"[Resources] Failed to load diarisation pipeline '{repo_id}': {exc}")
                self._diar_pipeline = None
        return self._diar_pipeline

    # ------------------------------------------------------------------
    # Resource release helpers
    # ------------------------------------------------------------------
    def release_whisper_model(self) -> None:
        """Release the Whisper model to free memory."""
        if self._whisper_model is None:
            return
        try:
            # Attempt to move the model to CPU before releasing to ease CUDA memory pressure.
            if hasattr(self._whisper_model, "to"):
                try:
                    import torch  # type: ignore

                    self._whisper_model.to("cpu")
                except Exception:
                    pass
        except Exception:
            pass

        self._whisper_model = None

        try:
            import torch  # type: ignore

            if hasattr(torch.cuda, "empty_cache"):
                torch.cuda.empty_cache()
        except Exception:
            pass

        gc.collect()

    # ------------------------------------------------------------------
    # Categorisation LLM
    # ------------------------------------------------------------------
    @property
    def llm_cat(self) -> Optional[Any]:
        """Return the categorising language model or ``None`` if unavailable."""
        if self._llm_cat is None:
            repo_id = self.config.selected_models.get("llm_cat_repo_id")
            pattern = self.config.selected_models.get("llm_cat_allow_pattern")
            if not repo_id:
                return None
            # Try to load from HuggingFace via transformers if installed
            try:
                from transformers import AutoModelForCausalLM, AutoTokenizer
            except ImportError:
                self._llm_cat = None
                return None
            try:
                tokenizer = AutoTokenizer.from_pretrained(repo_id)
                model = AutoModelForCausalLM.from_pretrained(repo_id)
                self._llm_cat = (model, tokenizer)
            except Exception:
                self._llm_cat = None
        return self._llm_cat

    # ------------------------------------------------------------------
    # Refinement LLM
    # ------------------------------------------------------------------
    @property
    def llm_sum(self) -> Optional[Any]:
        """Return the summarisation/refinement language model or ``None`` if unavailable."""
        if self._llm_sum is None:
            repo_id = self.config.selected_models.get("llm_sum_repo_id")
            if not repo_id:
                return None
            try:
                from transformers import AutoModelForCausalLM, AutoTokenizer
            except ImportError:
                self._llm_sum = None
                return None
            try:
                tokenizer = AutoTokenizer.from_pretrained(repo_id)
                model = AutoModelForCausalLM.from_pretrained(repo_id)
                self._llm_sum = (model, tokenizer)
            except Exception:
                self._llm_sum = None
        return self._llm_sum
