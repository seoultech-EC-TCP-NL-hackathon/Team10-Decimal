# apps/ai/bootstrap/manager.py
"""
모델 프로비저닝 매니저
- 하드웨어 감지 → 모델 선택 → 설치 → 구성 저장(ai.config.json)
- 이미 구성 파일이 있으면 스킵(재설치를 원하면 force=True)

반영 사항:
- probe.detect_hardware(): gpu_cuda/gpu_vram_gib/ram_gib 등 GiB 단위
- resolve.pick_models(): whisper + (llm_cat/llm_sum + allow_pattern) + diar
- install.install_all(): Whisper/pyannote는 모듈 캐시, LLM은 HF 기본 캐시
"""

from __future__ import annotations
from pathlib import Path
import json
from typing import Any, Dict, Optional

from .probe import detect_hardware
from .resolve import pick_models
from .install import install_all


def _read_config(config_json: Path) -> Optional[Dict[str, Any]]:
    """기존 구성 파일을 읽어 dict로 반환. 없으면 None."""
    if not config_json.exists():
        return None
    try:
        return json.loads(config_json.read_text(encoding="utf-8"))
    except Exception:
        # 손상된 파일 등은 무시하고 재생성
        return None


def _write_config(config_json: Path, payload: Dict[str, Any]) -> None:
    """구성 payload를 JSON으로 기록(들여쓰기/UTF-8)."""
    config_json.parent.mkdir(parents=True, exist_ok=True)
    config_json.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def ensure_models_ready(
    *,
    models_dir: Path,           # 인터페이스 유지용 인자(Whisper/pyannote/LLM 모두 각자 캐시 사용)
    config_json: Path,          # 예: apps/ai/ai.config.json
    force: bool = False,        # True면 기존 구성 무시하고 재선택/재설치
    noninteractive: bool = True # 현재는 사용 안하지만 인터페이스 유지
) -> Dict[str, Any]:
    """
    모델 준비 절차:
    1) (force=False) & config 존재 → 바로 로드 후 반환
    2) 하드웨어 감지(detect_hardware) → 모델 선택(pick_models)
    3) 설치(install_all) → 구성 파일 저장 → 반환
    """
    # 0) 기존 구성 재사용
    if not force:
        existing = _read_config(config_json)
        if existing:
            print("[bootstrap] Config exists, skip installation.")
            return existing

    # 1) 하드웨어 감지 (GiB 단위/키명: gpu_cuda, gpu_vram_gib, ram_gib, cpu_* 등)
    hw = detect_hardware()
    print(f"[bootstrap] Detected hardware: {hw}")

    # 2) 모델 선택 (RAM/VRAM 기준 규칙 + LLM 분리 + allow_pattern)
    selected = pick_models(hw)  # ValueError 발생 가능(예: RAM < 8 GiB)
    print(f"[bootstrap] Selected models: {selected}")

    # 3) 설치 (Whisper/pyannote: 모듈 캐시 | LLM: HF 기본 캐시)
    #    install_all 시그니처 유지 위해 base_dir_unused 전달하지만 내부에서 미사용
    install_all(selected, models_dir)

    # 4) 구성 기록
    payload = {
        "hardware": hw,
        "selected": selected,
        # models_dir는 호환성 표시용(실제 설치는 각자 캐시), 경로 표시는 사용자 편의를 위해 남겨둠
        "models_dir": str(models_dir),
        "version": 1,
    }
    _write_config(config_json, payload)
    print(f"[bootstrap] Config saved to {config_json}")

    return payload


if __name__ == "__main__":
    # 수동 테스트용: python -m apps.ai.bootstrap.manager
    import argparse, os
    parser = argparse.ArgumentParser(description="Ensure AI models are ready.")
    parser.add_argument("--models-dir", type=Path, default=Path("data/models"))
    parser.add_argument("--config-json", type=Path, default=Path("apps/ai/ai.config.json"))
    parser.add_argument("--force", action="store_true", help="Re-select and reinstall models.")
    args = parser.parse_args()

    ensure_models_ready(
        models_dir=args.models_dir,
        config_json=args.config_json,
        force=args.force,
        noninteractive=True,
    )
