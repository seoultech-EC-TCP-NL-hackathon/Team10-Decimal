# apps/ai/bootstrap/install.py
"""
모델 설치/준비 유틸 (최소 의존 & 명확한 역할 분리)

주의:
- Whisper/pyannote는 모듈 내부 캐시(기본 경로)를 사용하므로 별도의 local_dir를 지정하지 않음.
- LLM은 HF 기본 캐시(local_dir=None)를 사용. 이미 있으면 자동 재사용.
"""

from __future__ import annotations
from pathlib import Path
import os
import time
from typing import Iterable, Optional, Union

# LLM(HF 캐시) 용
from huggingface_hub import snapshot_download

# Whisper / Pyannote 모듈 (런타임에 설치되어 있어야 함)
#   pip install openai-whisper
#   pip install pyannote.audio
import importlib


# ------------------------------
# .env 로딩 (루트 .env에서 HF_TOKEN 읽기)
# ------------------------------
def _find_env_path() -> Path:
    return Path(__file__).resolve().parents[3] / ".env"  # /.env 경로


def _parse_env_file(path: Path) -> dict:
    """
    매우 단순한 .env 파서 (python-dotenv 미사용).
    - 주석/빈 줄 무시
    - key=value 형식만 지원, 값의 양쪽 따옴표 제거
    """
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _load_hf_token_from_dotenv() -> Optional[str]:
    env_path = _find_env_path()
    if not env_path:
        return None
    env = _parse_env_file(env_path)
    token = env.get("HF_TOKEN") or env.get("HUGGINGFACE_TOKEN")
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
    """
    openai-whisper 모듈의 load_model을 호출하여 모델 다운로드/캐시를 보장.
    - 기본 캐시(~/.cache/whisper 등)를 사용.
    - 메모리 점유를 줄이기 위해 로딩 후 즉시 제거.
    """
    try:
        whisper = importlib.import_module("whisper")
    except ImportError as e:
        raise RuntimeError(
            "openai-whisper 패키지가 필요합니다. `pip install openai-whisper`"
        ) from e

    print(f"[install/whisper] ensuring '{model_size}'")
    # device='cpu'로 로드하여 최소 리소스로 캐시를 채움. in_memory=False로 파일만 준비할 수 없음.
    model = whisper.load_model(model_size, device="cpu")
    # 모델 객체 제거(캐시 파일은 남음)
    del model
    print(f"[install/whisper] ready: {model_size}")


# ------------------------------
# Pyannote 설치/캐시 보장 (pyannote.audio)
# ------------------------------
def ensure_pyannote_pipeline(repo_id: str, token: Optional[str]) -> None:
    """
    pyannote.audio의 Pipeline.from_pretrained을 호출하여 파이프라인 다운로드/캐시 보장.
    - repo_id 예: "pyannote/speaker-diarization-3.1"
    - 토큰 필요할 수 있음(HF_TOKEN). 없으면 공개 모델만 가능.
    """
    try:
        pa = importlib.import_module("pyannote.audio")
    except ImportError as e:
        raise RuntimeError(
            "pyannote.audio 패키지가 필요합니다. `pip install pyannote.audio`"
        ) from e

    print(f"[install/pyannote] ensuring '{repo_id}'")

    # 버전별 인자명이 다를 수 있어 try 순차 적용
    Pipeline = getattr(pa, "Pipeline", None)
    if Pipeline is None:
        raise RuntimeError("pyannote.audio: Pipeline 클래스를 찾을 수 없습니다.")

    pipeline = None
    err = None
    # 새로운 버전 스타일
    try:
        pipeline = Pipeline.from_pretrained(repo_id, use_auth_token=token)  # 구버전 스타일
    except TypeError as e1:
        err = e1
        try:
            pipeline = Pipeline.from_pretrained(repo_id, token=token)  # 신버전 스타일
        except Exception as e2:
            err = e2

    if pipeline is None:
        raise RuntimeError(f"pyannote 모델 준비 실패: {repo_id} ({err})")

    # 파이프라인 객체 제거(캐시 파일은 남음)
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
    """
    HF 기본 캐시(snapshot_download)로 LLM 준비.
    - repo_id: 완전한 'org/repo'
    - allow_patterns: GGUF 특정 양자화만 다운로드 (예: "*Q4_K_M*")
    - ignore_patterns 미사용(요청사항)
    - 반환: 캐시된 스냅샷 경로
    """
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
# 일괄 설치: pick_models() 사양 반영
# ------------------------------
def install_all(models: dict, base_dir_unused=None) -> None:
    """
    pick_models() 반환 딕셔너리(확장 키 포함):
      - whisper: "large-v3" | "medium" | "small"
      - llm_cat_repo_id, llm_cat_allow_pattern
      - llm_sum_repo_id, llm_sum_allow_pattern
      - diar: "pyannote/speaker-diarization-3.1"
    base_dir는 사용하지 않음(HF/모듈 기본 캐시 사용).
    """
    # 1) Whisper (openai-whisper 모듈)
    ensure_whisper_model(models["whisper"])

    # 2) LLM (분류용; HF 기본 캐시)
    ensure_llm_model(
        models["llm_cat_repo_id"],
        allow_patterns=models.get("llm_cat_allow_pattern"),
    )

    # 3) LLM (요약용; HF 기본 캐시)
    ensure_llm_model(
        models["llm_sum_repo_id"],
        allow_patterns=models.get("llm_sum_allow_pattern"),
    )

    # 4) Pyannote (pyannote.audio 모듈)
    token = _load_hf_token_from_dotenv()
    ensure_pyannote_pipeline(models["diar"], token=token)
