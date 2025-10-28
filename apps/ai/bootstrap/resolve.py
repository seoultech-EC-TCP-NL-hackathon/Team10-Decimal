"""
하드웨어 스펙 → 사용할 모델(사이즈/종류) 선택 규칙.
- 단위는 모두 GiB 기준.
"""

def pick_models(hw: dict) -> dict:
    """
    hw: {"cuda": bool, "vram_gib": float, "ram_gib": float, ...}
    반환: {"whisper": "...", "llm_cat_repo_id": "...", ... , "diar": "..."}
    """
    cuda = bool(hw.get("cuda"))
    vram = float(hw.get("vram_gib", 0.0))
    ram  = float(hw.get("ram_gib", 0.0))

    if cuda and vram > 11:
        whisper = "large-v3"
        llm_cat_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
        llm_cat_allow_pattern = "*Q4_K_M*"
        llm_sum_repo_id = "lmstudio-community/DeepSeek-R1-0528-Qwen3-8B-GGUF"
        llm_sum_allow_pattern = "*Q8_0*"
    elif cuda and vram > 7:
        whisper = "medium"
        llm_cat_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
        llm_cat_allow_pattern = "*Q4_K_M*"
        llm_sum_repo_id = "lmstudio-community/Qwen3-4B-Thinking-2507-GGUF"
        llm_sum_allow_pattern = "*Q8_0*"
    elif cuda and vram > 3:
        whisper = "small"
        llm_cat_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
        llm_cat_allow_pattern = "*Q4_K_M*"
        llm_sum_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
        llm_sum_allow_pattern = "*Q4_K_M*"
    else:
        # CPU only
        if ram > 11:
            whisper = "large-v3"
            llm_cat_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
            llm_cat_allow_pattern = "*Q4_K_M*"
            llm_sum_repo_id = "lmstudio-community/DeepSeek-R1-0528-Qwen3-8B-GGUF"
            llm_sum_allow_pattern = "*Q8_0*"
        elif ram > 7:
            whisper = "medium"
            llm_cat_repo_id = "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF"
            llm_cat_allow_pattern = "*Q4_K_M*"
            llm_sum_repo_id = "lmstudio-community/Qwen3-4B-Thinking-2507-GGUF"
            llm_sum_allow_pattern = "*Q8_0*"
        else:
            raise ValueError(f"[Error]: Low RAM ({ram:.1f} GiB detected) — minimum 8 GiB required")

    # === Diarization 모델 (고정) ===
    diar = "pyannote/speaker-diarization-3.1"

    return {
            "whisper": whisper, 
            "llm_cat_repo_id": llm_cat_repo_id, 
            "llm_cat_allow_pattern": llm_cat_allow_pattern, 
            "llm_sum_repo_id": llm_sum_repo_id, 
            "llm_sum_allow_pattern": llm_sum_allow_pattern, 
            "diar": diar,
            }