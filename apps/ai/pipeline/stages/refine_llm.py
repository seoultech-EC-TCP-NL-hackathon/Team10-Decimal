"""
Refinement and summarisation stage.

This stage uses a llama.cpp model to generate a formatted summary based
on the classified document type. When the llama.cpp runtime is not
available the stage falls back to a deterministic transcript merge so
that downstream consumers still receive an output.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from ..base import BaseStage, StageContext, StageResult

_DEFAULT_DOCUMENT_TYPE = "\ub300\ud654\ub85d"
_PROMPT_FILES: Dict[str, str] = {
    "\ub300\ud654\ub85d": "conversation.txt",
    "\uac15\uc758\ub85d": "lecture.txt",
    "\ud68c\uc758\ub85d": "meeting.txt",
}
_DEFAULT_PROMPTS: Dict[str, str] = {
    "\ub300\ud654\ub85d": (
        "[\uc81c\ubaa9]\n- \ud654\uc81c \ubc0f \uc8fc\uc81c\uc5d0 \ub300\ud55c \uc694\uc57d\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4.\n\n"
        "[\ucc38\uc5ec\uc790]\n- \ub300\ud55c \uc218\uc758 \ucc38\uc5ec\uc790\uc640 \ub2f5\ubcc0\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4.\n\n"
        "[\uc8fc\uc694 \ub0b4\uc6a9]\n- \ub300\ud654\uc758 \ud575\uc2ec \ub0b4\uc6a9\uc744 \uc9c1\uad00\uc801\uc73c\ub85c 정리합니다.\n\n"
        "[\uacb0\ub860 \ubc0f \ud6c8\uc6a9]\n- \ub2e4\uc74c \ub2f4\ub2f9\uc774 \ud544\uc694\ud55c \ud504\ub85c\uc81d\ud2b8 \ud65c\ub3d9\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4."
    ),
    "\uac15\uc758\ub85d": (
        "[\uac15\uc758 \ubd80\uac00\uc800]\n- \uac15\uc0ac \ubc0f \ucc38\uc11d\uc790\uc758 \ucc38\uc5ec \ub0b4\uc6a9\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4.\n\n"
        "[\uac15\uc758 \uc57d\uc11c]\n- \uc8fc\uc694 \uac15\uc758 \ud2b9\uc9d5\uacfc \ud544\uc694\uc810\uc744 \ud569\uacc4\ud569\ub2c8\ub2e4.\n\n"
        "[\ub2e4\uc74c \uba74]\n- \ud559\uc0dd\uc774 \ubcf4\uc11c \ud544\uc694\ud55c \ud65c\uc6a9 \ubc0f \ub3d9\uae30\uc0ac\ud56d\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4."
    ),
    "\ud68c\uc758\ub85d": (
        "[\ud68c\uc758 \uae30\ub85d]\n- \ud68c\uc758\uc758 \uc8fc\uc81c\uc640 \uc77c\uc2dc, \ucc38\uc5ec\uc790\ub97c \uc815\ub9ac\ud569\ub2c8\ub2e4.\n\n"
        "[\ub0b4\uc6a9 \uc694\uc57d]\n- \ud68c\uc758\uc5d0\uc11c \ub098\uc628 \uc8fc\uc694 \uc758\uacbd\uc744 \uc694\uc57d\ud569\ub2c8\ub2e4.\n\n"
        "[\uacb0\uc815 \uc0ac\ud56d]\n- \uc758\uacbd\uacfc \ud6c8\uc6a9\uc0ac\ud56d\uc744 \uac00\ub871\uc801\uc73c\ub85c \ub123\uc2b5\ub2c8\ub2e4."
    ),
}


class RefineLLMStage(BaseStage):
    """Generate a formatted summary using llama.cpp with prompt templates."""

    name = "refine"

    def run(self, context: StageContext) -> StageResult:
        document_type = str(context.data.get("document_type") or _DEFAULT_DOCUMENT_TYPE)
        self._release_unused_resources(context)
        source_text = self._load_input_text(context)
        if not source_text:
            message = "No transcript text available; produced empty summary."
            context.data["summary"] = ""
            self._save_summary_file(context, "")
            return StageResult(name=self.name, success=True, data="", message=message)

        llama = self._load_llama_model(context)
        summary: str
        source: str
        message: Optional[str]

        if llama is None:
            summary = self._fallback_summary(context, source_text)
            source = "fallback"
            message = "llama_cpp model unavailable; used fallback formatting."
        else:
            system_prompt = self._load_system_prompt(context, document_type)
            generated = self._summarise_with_llm(llama, system_prompt, document_type, source_text)
            if generated:
                summary = generated
                source = "llm"
                message = None
            else:
                summary = self._fallback_summary(context, source_text)
                source = "fallback"
                message = "LLM summarisation failed; used fallback formatting."

        summary = self._strip_think_tags(summary)
        context.data["summary"] = summary
        context.data["summary_source"] = source
        self._save_summary_file(context, summary)

        print(f"    [RefineStage] Generated summary ({source}) with length {len(summary)} characters.")

        return StageResult(name=self.name, success=True, data=summary, message=message)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _load_input_text(self, context: StageContext) -> str:
        """Load input text for summarisation from summary.txt or transcripts."""
        # Prefer any existing summary text stored in the context.
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
                print(f"    [RefineStage] Failed to read speaker-attributed.txt: {exc}")

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
                print(f"    [RefineStage] Failed to read summary.txt: {exc}")

        # Fallback to merged transcript data.
        segments = self._collect_segments(context)
        lines = self._segments_to_lines(segments)
        combined = "\n".join(lines).strip()
        return self._strip_think_tags(combined)

    def _collect_segments(self, context: StageContext) -> List[Dict[str, Any]]:
        """Collect transcript-like segments for summarisation."""
        merged_segments = context.data.get("merged_transcript") or []
        if not merged_segments:
            merge_result = context.data.get("merge_result") or {}
            merged_segments = merge_result.get("segments") or []
        if merged_segments:
            return list(merged_segments)

        stt_segments = context.data.get("stt") or []
        return list(stt_segments)

    def _segments_to_lines(self, segments: Iterable[Dict[str, Any]]) -> List[str]:
        """Convert segments into `SPEAKER: text` lines."""
        lines: List[str] = []
        for seg in segments:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            speaker = seg.get("speaker")
            if speaker is None:
                start = seg.get("start")
                speaker = f"SPEAKER@{start:.2f}" if isinstance(start, (int, float)) else "UNKNOWN"
            line = f"{speaker}: {text}"
            if lines and lines[-1] == line:
                continue
            lines.append(line)
        return lines

    def _load_llama_model(self, context: StageContext) -> Optional[Any]:
        """Initialise a llama.cpp model with GPU preference and CPU fallback."""
        model_path = self._resolve_model_path(
            context,
            repo_key="llm_sum_repo_id",
            pattern_key="llm_sum_allow_pattern",
        )
        if model_path is None:
            return None

        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError:
            print("    [RefineStage] llama_cpp is not installed.")
            return None

        gpu_layers = self._determine_gpu_layers(context)
        init_kwargs = {
            "model_path": str(model_path),
            "n_ctx": 8192,
            "logits_all": False,
            "embedding": False,
        }

        try:
            llama = Llama(n_gpu_layers=gpu_layers, **init_kwargs)
            offload_note = "GPU" if gpu_layers != 0 else "CPU"
            print(f"    [RefineStage] Loaded llama.cpp model '{model_path.name}' on {offload_note}.")
            return llama
        except Exception as gpu_exc:
            if gpu_layers != 0:
                print(f"    [RefineStage] GPU initialisation failed ({gpu_exc}); retrying on CPU.")
            try:
                llama = Llama(n_gpu_layers=0, **init_kwargs)
                print(f"    [RefineStage] Loaded llama.cpp model '{model_path.name}' on CPU.")
                return llama
            except Exception as cpu_exc:
                print(f"    [RefineStage] Failed to load llama.cpp model on CPU: {cpu_exc}")
                return None

    def _summarise_with_llm(
        self,
        llama: Any,
        system_prompt: str,
        document_type: str,
        source_text: str,
    ) -> str:
        """Generate a summary via llama.cpp."""
        prompt = source_text.strip()
        if len(prompt) > 6000:
            prompt = prompt[:6000]
        user_content = (
            f"Document type: {document_type}\n\n"
            "Produce a structured summary following the requested format.\n\n"
            "Source text:\n"
            f"{prompt}"
        )

        try:
            response = llama.create_chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
                max_tokens=1024,
            )
            content = (response["choices"][0]["message"]["content"] or "").strip()
        except Exception as exc:
            print(f"    [RefineStage] LLM summary generation failed: {exc}")
            return ""

        return self._strip_think_tags(content)

    def _load_system_prompt(self, context: StageContext, document_type: str) -> str:
        """Load the system prompt for the given document type."""
        prompt_dir = context.config.root_dir / "apps" / "ai" / "sysprompt"
        filename = _PROMPT_FILES.get(document_type, _PROMPT_FILES[_DEFAULT_DOCUMENT_TYPE])
        prompt_path = prompt_dir / filename
        try:
            prompt = prompt_path.read_text(encoding="utf-8").strip()
            if prompt:
                return prompt
        except FileNotFoundError:
            print(f"    [RefineStage] Prompt file not found: {prompt_path}")
        except Exception as exc:
            print(f"    [RefineStage] Failed to read prompt file '{prompt_path}': {exc}")
        return _DEFAULT_PROMPTS.get(document_type, _DEFAULT_PROMPTS[_DEFAULT_DOCUMENT_TYPE])

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
            print("    [RefineStage] No refinement model configured.")
            return None

        allow_patterns = self._as_patterns(selected.get(pattern_key))

        try:
            from huggingface_hub import snapshot_download
        except ImportError:
            print("    [RefineStage] huggingface_hub is not installed; cannot resolve model.")
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
            print(f"    [RefineStage] Local cache lookup failed ({exc}); attempting download.")
            try:
                cache_dir = Path(
                    snapshot_download(
                        repo_id=repo_id,
                        allow_patterns=allow_patterns,
                    )
                )
            except Exception as download_exc:
                print(f"    [RefineStage] Unable to download refinement model: {download_exc}")
                return None

        if cache_dir is None:
            return None

        model_path = self._select_model_file(cache_dir, allow_patterns)
        if model_path is None:
            print(f"    [RefineStage] No GGUF model file found under '{cache_dir}'.")
        return model_path

    def _select_model_file(self, cache_dir: Path, allow_patterns: Optional[Sequence[str]]) -> Optional[Path]:
        """Select a GGUF model file from the cache directory."""
        candidates: List[Path] = []
        if allow_patterns:
            for pattern in allow_patterns:
                candidates.extend(cache_dir.rglob(pattern))
        if not candidates:
            candidates = list(cache_dir.rglob("*.gguf"))
        candidates = [path for path in candidates if path.suffix.lower() == ".gguf"]
        if not candidates:
            return None
        return sorted(candidates)[-1]

    def _fallback_summary(self, context: StageContext, source_text: str) -> str:
        """Produce a deterministic fallback summary."""
        lines = self._segments_to_lines(self._collect_segments(context))
        if lines:
            return self._strip_think_tags("\n".join(lines))
        return self._strip_think_tags(source_text)

    def _save_summary_file(self, context: StageContext, summary: str) -> None:
        """Persist the summary to the run directory."""
        try:
            context.base_dir.mkdir(parents=True, exist_ok=True)
            clean = self._strip_think_tags(summary)
            (context.base_dir / "summary.txt").write_text(clean, encoding="utf-8")
        except Exception as exc:
            print(f"    [RefineStage] Failed to write summary.txt: {exc}")

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

    def _strip_think_tags(self, text: str) -> str:
        """Remove <think>...</think> sections from LLM outputs."""
        if not isinstance(text, str) or "<think" not in text:
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
                print(f"    [RefineStage] Invalid LLAMA_GPU_LAYERS='{env_value}'; ignoring.")

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
        except Exception as e:
            # Ignore all exceptions here; fallback to CPU if GPU detection fails.
            print(f"    [RefineStage] Exception while checking for CUDA GPU: {e}")

        # Attempt full offload; loader will fall back to CPU if GPU loading fails.
        return -1

    def _release_unused_resources(self, context: StageContext) -> None:
        """Release heavy resources before loading the LLM."""
        release_whisper = getattr(context.resources, "release_whisper_model", None)
        if callable(release_whisper):
            release_whisper()
