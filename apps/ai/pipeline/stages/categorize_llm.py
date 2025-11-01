"""
LLM-powered categorisation stage.

This stage reads the available summary text for the current run and
uses a llama.cpp model to classify it as one of three document types.
If the llama.cpp runtime or model cannot be loaded the stage falls
back to a lightweight keyword heuristic so downstream stages still
receive a best-effort label.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Sequence

from ..base import BaseStage, StageContext, StageResult

_PROMPT_FILENAME = "categorize.txt"
_CANDIDATE_LABELS: tuple[str, ...] = ("\ub300\ud654\ub85d", "\uac15\uc758\ub85d", "\ud68c\uc758\ub85d")
_DEFAULT_PROMPT: str = (
    "\uc774 \ud14d\uc2a4\ud2b8\uac00 \ub300\ud654\ub85d\uc778\uc9c0, \uac15\uc758\ub85d\uc778\uc9c0, "
    "\ud68c\uc758\ub85d\uc778\uc9c0 \ud310\ubcc4\ud574\uc11c \ub300\ud654\ub85d\uc774\uba74 \"\ub300\ud654\ub85d\", "
    "\uac15\uc758\ub85d\uc774\uba74 \"\uac15\uc758\ub85d\", \ud68c\uc758\ub85d\uc774\uba74 \"\ud68c\uc758\ub85d\" "
    "\uc73c\ub85c \ucd9c\ub825\ud574\uc918. \uac15\uc758\ud558\ub294 \uc0c1\ud669 \uac19\uc73c\uba74 \uac15\uc758\ub85d, "
    "\ud68c\uc758\ud558\ub294 \uc0c1\ud669 \uac19\uc73c\uba74 \ud68c\uc758\ub85d\uc774\uc57c. \ub450 \ub2e4 \uc544\ub2c8\uba74 "
    "\ub300\ud654\ub85d\uc73c\ub85c \ubd84\ub958\ud574\uc918."
)


class CategorizeLLMStage(BaseStage):
    """Classify the summary into dialogue, lecture or meeting minutes."""

    name = "categorize"

    def run(self, context: StageContext) -> StageResult:
        summary_text = self._load_summary_text(context)
        if not summary_text:
            default_label = _CANDIDATE_LABELS[0]
            message = "Summary text is empty; defaulting to the conversation label."
            context.data["categories"] = {"document_type": default_label, "source": "empty"}
            context.data["document_type"] = default_label
            return StageResult(name=self.name, success=True, data=context.data["categories"], message=message)

        self._release_unused_resources(context)
        llama = self._load_llama_model(context)
        if llama is None:
            label = self._heuristic_label(summary_text)
            message = "llama_cpp model unavailable; used heuristic classification."
            source = "heuristic"
        else:
            label = self._classify_with_llm(context, llama, summary_text)
            if not label:
                label = self._heuristic_label(summary_text)
                message = "LLM classification failed; used heuristic classification."
                source = "heuristic"
            else:
                message = None
                source = "llm"

        result: Dict[str, str] = {"document_type": label, "source": source}
        context.data["categories"] = result
        context.data["document_type"] = label
        print(f"[CategorizeStage] Classified summary as '{label}' using {source}.")
        return StageResult(name=self.name, success=True, data=result, message=message)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _load_llama_model(self, context: StageContext) -> Optional[Any]:
        """Initialise a llama.cpp model with GPU preference and CPU fallback."""
        model_path = self._resolve_model_path(
            context,
            repo_key="llm_cat_repo_id",
            pattern_key="llm_cat_allow_pattern",
        )
        if model_path is None:
            return None

        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError:
            print("    [CategorizeStage] llama_cpp is not installed.")
            return None

        gpu_layers = self._determine_gpu_layers(context)
        init_kwargs = {
            "model_path": str(model_path),
            "n_ctx": 4096,
            "logits_all": False,
            "embedding": False,
        }

        try:
            llama = Llama(n_gpu_layers=gpu_layers, **init_kwargs)
            offload_note = "GPU" if gpu_layers != 0 else "CPU"
            print(f"    [CategorizeStage] Loaded llama.cpp model '{model_path.name}' on {offload_note}.")
            return llama
        except Exception as gpu_exc:
            if gpu_layers != 0:
                print(f"    [CategorizeStage] GPU initialisation failed ({gpu_exc}); retrying on CPU.")
            try:
                llama = Llama(n_gpu_layers=0, **init_kwargs)
                print(f"    [CategorizeStage] Loaded llama.cpp model '{model_path.name}' on CPU.")
                return llama
            except Exception as cpu_exc:
                print(f"    [CategorizeStage] Failed to load llama.cpp model on CPU: {cpu_exc}")
                return None

    def _classify_with_llm(self, context: StageContext, llama: Any, summary_text: str) -> str:
        """Run the llama.cpp model and interpret the response."""
        system_prompt = self._load_system_prompt(context) or _DEFAULT_PROMPT
        prompt = summary_text.strip()
        if len(prompt) > 4000:
            prompt = prompt[:4000]

        try:
            response = llama.create_chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                max_tokens=8,
            )
            content = (response["choices"][0]["message"]["content"] or "").strip()
        except Exception as exc:
            print(f"    [CategorizeStage] LLM classification failed: {exc}")
            return ""

        cleaned = self._strip_think_tags(content)
        return self._normalise_label(cleaned)

    def _load_system_prompt(self, context: StageContext) -> str:
        """Load the categorisation system prompt from disk."""
        prompt_dir = context.config.root_dir / "apps" / "ai" / "sysprompt"
        prompt_path = prompt_dir / _PROMPT_FILENAME
        try:
            prompt = prompt_path.read_text(encoding="utf-8").strip()
            if prompt:
                return prompt
        except FileNotFoundError:
            print(f"    [CategorizeStage] Prompt file not found: {prompt_path}")
        except Exception as exc:
            print(f"    [CategorizeStage] Failed to read prompt file '{prompt_path}': {exc}")
        return _DEFAULT_PROMPT

    def _resolve_model_path(
        self,
        context: StageContext,
        *,
        repo_key: str,
        pattern_key: str,
    ) -> Optional[Path]:
        """Locate the GGUF model file specified in the configuration."""
        selected = context.config.selected_models
        repo_id = selected.get(repo_key)
        if not repo_id:
            print("    [CategorizeStage] No categorisation model configured.")
            return None

        allow_patterns = self._as_patterns(selected.get(pattern_key))

        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            print("    [CategorizeStage] huggingface_hub is not installed; cannot resolve model.")
            return None

        cache_dir: Optional[Path] = None
        try:
            cache_dir = Path(
                snapshot_download(
                    repo_id=repo_id,
                    allow_patterns=allow_patterns,
                    local_files_only=True,
                )
            )
        except Exception as exc:
            print(f"    [CategorizeStage] Local cache lookup failed ({exc}); attempting download.")
            try:
                cache_dir = Path(
                    snapshot_download(
                        repo_id=repo_id,
                        allow_patterns=allow_patterns,
                    )
                )
            except Exception as download_exc:
                print(f"    [CategorizeStage] Unable to download categorisation model: {download_exc}")
                return None

        if cache_dir is None:
            return None

        model_path = self._select_model_file(cache_dir, allow_patterns)
        if model_path is None:
            print(f"    [CategorizeStage] No GGUF model file found under '{cache_dir}'.")
        return model_path

    def _select_model_file(self, cache_dir: Path, allow_patterns: Optional[Sequence[str]]) -> Optional[Path]:
        """Select a GGUF model file from the cache directory."""
        candidates: list[Path] = []
        if allow_patterns:
            for pattern in allow_patterns:
                candidates.extend(cache_dir.rglob(pattern))
        if not candidates:
            candidates = list(cache_dir.rglob("*.gguf"))
        candidates = [path for path in candidates if path.suffix.lower() == ".gguf"]
        if not candidates:
            return None
        # Prefer the lexicographically last file (often the highest quantisation quality).
        return sorted(candidates)[-1]

    def _heuristic_label(self, text: str) -> str:
        """Fallback heuristic based on keyword counts."""
        lowered = self._strip_think_tags(text).lower()
        meeting_terms = ("\ud68c\uc758", "\ud68c\uc758\ub85d", "agenda", "meeting", "\uc758\uc81c", "\ud611\uc758", "\ucc38\uc11d\uc790")
        lecture_terms = ("\uac15\uc758", "lecture", "\uad50\uc218", "\ud559\uc0dd", "\uc218\uc5c5", "\uce74\ub9ac\ud0c0\uc9c0\ub110", "\uc2ac\ub77c\uc774\ub4dc")

        meeting_score = self._count_terms(lowered, meeting_terms)
        lecture_score = self._count_terms(lowered, lecture_terms)

        if meeting_score > lecture_score and meeting_score > 0:
            return _CANDIDATE_LABELS[2]
        if lecture_score > meeting_score and lecture_score > 0:
            return _CANDIDATE_LABELS[1]
        return _CANDIDATE_LABELS[0]

    @staticmethod
    def _count_terms(text: str, terms: Iterable[str]) -> int:
        return sum(text.count(term.lower()) for term in terms if term)

    def _normalise_label(self, raw: str) -> str:
        """Ensure the LLM response maps to one of the expected labels."""
        cleaned = raw.strip()
        for label in _CANDIDATE_LABELS:
            if label in cleaned:
                return label

        mappings = {
            "dialog": _CANDIDATE_LABELS[0],
            "conversation": _CANDIDATE_LABELS[0],
            "chat": _CANDIDATE_LABELS[0],
            "lecture": _CANDIDATE_LABELS[1],
            "class": _CANDIDATE_LABELS[1],
            "course": _CANDIDATE_LABELS[1],
            "meeting": _CANDIDATE_LABELS[2],
            "minutes": _CANDIDATE_LABELS[2],
        }
        lowered = cleaned.lower()
        for key, label in mappings.items():
            if key in lowered:
                return label
        return _CANDIDATE_LABELS[0]

    @staticmethod
    def _as_patterns(value: Any) -> Optional[list[str]]:
        if value is None:
            return None
        if isinstance(value, str):
            return [value]
        try:
            return [str(item) for item in value]
        except TypeError:
            return [str(value)]

    def _load_summary_text(self, context: StageContext) -> str:
        """Load summary text from speaker attributed data or transcript fallbacks."""
        speaker_text = context.data.get("speaker_attributed_text")
        if isinstance(speaker_text, str) and speaker_text.strip():
            return self._strip_think_tags(speaker_text.strip())

        speaker_path = context.base_dir / "speaker-attributed.txt"
        if speaker_path.exists():
            try:
                contents = speaker_path.read_text(encoding="utf-8").strip()
                if contents:
                    return self._strip_think_tags(contents)
            except Exception as exc:
                print(f"    [CategorizeStage] Failed to read speaker-attributed.txt: {exc}")

        summary = context.data.get("summary")
        if isinstance(summary, str) and summary.strip():
            return self._strip_think_tags(summary.strip())

        summary_path = context.base_dir / "summary.txt"
        if summary_path.exists():
            try:
                contents = summary_path.read_text(encoding="utf-8").strip()
                if contents:
                    return self._strip_think_tags(contents)
            except Exception as exc:
                print(f"    [CategorizeStage] Failed to read summary.txt: {exc}")

        stt_segments = context.data.get("stt") or []
        collected: list[str] = []
        for segment in stt_segments:
            text = (segment.get("text") or "").strip()
            if text:
                collected.append(text)
        combined = "\n".join(collected).strip()
        return self._strip_think_tags(combined)

    @staticmethod
    def _strip_think_tags(text: str) -> str:
        """Remove <think>...</think> sections from LLM outputs."""
        if "<think" not in text:
            return text
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()

    def _determine_gpu_layers(self, context: StageContext) -> int:
        """Determine how many layers to offload to GPU (defaults to all)."""
        env_value = os.getenv("LLAMA_GPU_LAYERS")
        if env_value:
            try:
                gpu_layers = int(env_value)
                if gpu_layers < 0:
                    return -1
                return gpu_layers
            except ValueError:
                print(f"    [CategorizeStage] Invalid LLAMA_GPU_LAYERS='{env_value}'; ignoring.")

        hardware = {}
        try:
            hardware = context.config.hardware
        except Exception:
            hardware = {}

        if hardware.get("gpu_cuda"):
            return -1

        try:
            import torch  # type: ignore

            if getattr(torch, "cuda", None) and torch.cuda.is_available():
                return -1
        except Exception:
            pass

        # Attempt full offload; loader will fall back to CPU if the GPU path fails.
        return -1

    def _release_unused_resources(self, context: StageContext) -> None:
        """Release heavy resources before loading the LLM."""
        release_whisper = getattr(context.resources, "release_whisper_model", None)
        if callable(release_whisper):
            release_whisper()
