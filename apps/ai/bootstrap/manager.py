"""
모델 준비 관리자

동작 개요:
1) 설정 파일(config_json)이 존재하면 로드 후 반환 (재실행 스킵)
2) 없으면:
   - 하드웨어 감지:    probe.detect_hardware()
   - 모델 선택:        resolve.pick_models(hw)
   - 모델 설치/캐시:   install.install_all(models)
   - 결과 기록:        config_json(JSON) 저장

주의:
- 모델 설치는 HF 기본 캐시 & 각 모듈 내 캐시 사용. 별도 models_dir 사용하지 않음.
- config_json의 'models_backend'는 'hf_cache'로 표기해 둠(문서화 목적).
"""

from __future__ import annotations
from pathlib import Path
import json
from typing import Any, Dict

from .probe import detect_hardware
from .resolve import pick_models
from .install import install_all


def ensure_models_ready(models_dir: Path | None, config_json: Path, noninteractive: bool = True) -> Dict[str, Any]:
    """
    최초 실행 시 모델 준비를 보장하고, 결과를 config_json에 기록한다.
    - models_dir 인자는 과거 시그니처 호환용으로 받지만, 실제 설치는 HF/모듈 기본 캐시를 사용한다.
    - config_json이 이미 있으면 로드하여 그대로 반환(멱등).
    """
    # 0) 기존 설정 존재하면 즉시 반환
    if config_json.exists():
        try:
            return json.loads(config_json.read_text(encoding="utf-8"))
        except Exception:
            # 손상된 파일이면 새로 생성
            pass

    # 1) 하드웨어 감지 (GiB 기준 키 네이밍은 probe.detect_hardware() 결과에 따름)
    hw = detect_hardware()

    # 2) 모델 선택 (사용자 규칙 반영)
    selected = pick_models(hw)

    # 3) 설치/캐시 확보 (Whisper/pyannote/LLM)
    #    - install_all 내부에서:
    #       * Whisper → openai-whisper 모듈로 캐시 확보
    #       * LLM     → HF snapshot_download(기본 캐시)
    #       * Pyannote→ pyannote.audio Pipeline.from_pretrained(캐시)
    install_all(selected, base_dir_unused=None)

    # 4) 결과 페이로드 구성 및 기록
    payload = {
        "hardware": hw,              # probe.detect_hardware() 결과 그대로
        "selected": selected,        # resolve.pick_models() 사양 그대로
        "models_backend": "hf_cache" # 문서화용(모델들은 HF/모듈 기본 캐시에 존재)
    }

    config_json.parent.mkdir(parents=True, exist_ok=True)
    config_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    return payload


# 선택: CLI로 단독 실행 테스트 지원
if __name__ == "__main__":
    import sys

    # 기본 위치 가정: apps/ai/ai.config.json
    # 필요하면 인자로 경로를 넘길 수 있음: python -m apps.ai.bootstrap.manager apps/ai/ai.config.json
    cfg_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("apps/ai/ai.config.json")
    result = ensure_models_ready(models_dir=None, config_json=cfg_path, noninteractive=True)
    print("[bootstrap] completed")
    print(json.dumps(result, indent=2, ensure_ascii=False))
