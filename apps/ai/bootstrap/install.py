"""
모델 설치/준비 유틸
"""

from __future__ import annotations
from pathlib import Path
import os
import time
import importlib
from typing import Iterable, Optional, Union

from dotenv import load_dotenv
from huggingface_hub import snapshot_download


# ------------------------------
# .env 로딩 (루트 .env에서 HF_TOKEN 읽기)
# ------------------------------
def _load_hf_token_from_dotenv() -> Optional[str]:
    """
    루트 디렉토리의 .env 파일을 python-dotenv로 로드하고,
    HF_TOKEN 또는 HUGGINGFACE_TOKEN 값을 반환.
    """
    root_env_path = Path(__file__).resolve().parents[3] / ".env"
    if root_env_path.exists():
        load_dotenv(dotenv_path=root_env_path)
    else:
        # .env가 없어도 load_dotenv()는 None 반환 (무시 가능)
        load_dotenv()

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
    return token if token not in ("", "None", "null") else None


def _as_patterns(value: Optional[Union[str, Iterable[str]]]) -> Optional[list[str]]:
    """allow_patterns 인자를 list[str]로 정규화."""
    if value is None:
        return None
    if isinstance(value, str):
        return [value]
    return list(value)


# ------------------------------
# Whisper 설치/캐시 보장 (openai-whisper)
# ------------------------------
def ensure_whisper_model(model_size: str) -> None:
    """openai-whisper 모듈의 load_model을 호출하여 모델 다운로드/캐시를 보장."""
    try:
        whisper = importlib.import_module("whisper")
    except ImportError as e:
        raise RuntimeError(
            "openai-whisper 패키지가 필요합니다. `pip install openai-whisper`"
        ) from e

    print(f"[install/whisper] ensuring '{model_size}'")
    model = whisper.load_model(model_size, device="cpu")
    del model
    print(f"[install/whisper] ready: {model_size}")


# ------------------------------
# Pyannote 설치/캐시 보장 (pyannote.audio)
# ------------------------------
def ensure_pyannote_pipeline(repo_id: str, token: Optional[str]) -> None:
    """pyannote.audio의 Pipeline.from_pretrained을 호출하여 캐시 보장."""
    try:
        pa = importlib.import_module("pyannote.audio")
    except ImportError as e:
        raise RuntimeError(
            "pyannote.audio 패키지가 필요합니다. `pip install pyannote.audio`"
        ) from e

    print(f"[install/pyannote] ensuring '{repo_id}'")

    Pipeline = getattr(pa, "Pipeline", None)
    if Pipeline is None:
        raise RuntimeError("pyannote.audio: Pipeline 클래스를 찾을 수 없습니다.")

    pipeline = None
    err = None
    try:
        pipeline = Pipeline.from_pretrained(repo_id, use_auth_token=token)
    except TypeError as e1:
        err = e1
        try:
            pipeline = Pipeline.from_pretrained(repo_id, token=token)
        except Exception as e2:
            err = e2

    if pipeline is None:
        raise RuntimeError(f"pyannote 모델 준비 실패: {repo_id} ({err})")

    del pipeline
    print(f"[install/pyannote] ready: {repo_id}")


# ------------------------------
# LLM 설치/캐시 보장 (HF 기본 캐시)
# ------------------------------
def ensure_llm_model(
    repo_id: str,
    *,
    revision: Optional[str] = None,
    allow_patterns: Optional[Union[str, Iterable[str]]] = None,
    max_workers: Optional[int] = None,
    retries: int = 2,
    backoff_sec: float = 2.0,
) -> Path:
    """Hugging Face snapshot_download()를 이용해 모델 캐시 확보."""
    token = _load_hf_token_from_dotenv()
    ap = _as_patterns(allow_patterns)

    last_err = None
    for attempt in range(1, retries + 1):
        try:
            print(f"[install/llm] snapshot: {repo_id} (rev={revision or 'latest'}, allow={ap})")
            cache_dir = snapshot_download(
                repo_id=repo_id,
                revision=revision,
                local_dir=None,                   # HF 기본 캐시 사용
                local_dir_use_symlinks=True,
                allow_patterns=ap,
                token=token,
                tqdm_enabled=True,
                max_workers=max_workers,
            )
            print(f"[install/llm] ready (cache): {cache_dir}")
            return Path(cache_dir)
        except Exception as e:
            last_err = e
            print(f"[install/llm] Error({attempt}/{retries}): {e}")
            if attempt < retries:
                sleep_for = backoff_sec * (2 ** (attempt - 1))
                print(f"[install/llm] Retry in {sleep_for:.1f}s...")
                time.sleep(sleep_for)

    raise RuntimeError(f"[install/llm] Failed to prepare '{repo_id}'. last_error={last_err}")


# ------------------------------
# 일괄 설치
# ------------------------------
def install_all(models: dict, base_dir_unused=None) -> None:
    """
    pick_models() 반환 딕셔너리를 기반으로 전체 모델 캐시 보장.
    whisper, llm_cat, llm_sum, diar 키를 포함해야 함.
    """
    ensure_whisper_model(models["whisper"])

    ensure_llm_model(
        models["llm_cat_repo_id"],
        allow_patterns=models.get("llm_cat_allow_pattern"),
    )

    ensure_llm_model(
        models["llm_sum_repo_id"],
        allow_patterns=models.get("llm_sum_allow_pattern"),
    )

    token = _load_hf_token_from_dotenv()
    ensure_pyannote_pipeline(models["diar"], token=token)
