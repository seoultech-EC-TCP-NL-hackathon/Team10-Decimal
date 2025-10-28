"""
하드웨어/메모리/OS 감지 유틸
- GPU 유무, VRAM 용량, CPU 물리/논리 코어 수, RAM 용량, OS 정보 수집.
- 모든 용량 단위는 'GiB(2^30 bytes)' 기준으로 표기.
"""
import platform
import psutil

def ram_gib() -> float:
    """현재 시스템 RAM 용량 (GiB 단위, 소수점 한 자리까지 반올림)"""
    total_bytes = psutil.virtual_memory().total
    gib = total_bytes / (1024 ** 3)
    return round(gib, 1)

def cpu_info() -> dict:
    """
    CPU 정보:
    - cpu_physical_cores: 실제 물리 코어 수
    - cpu_logical_cores: 논리 코어 수 (SMT(하이퍼스레딩) 포함)
    """
    freq = psutil.cpu_freq()
    max_freq = freq.max / 1000 if freq and freq.max else None
    return {
        "cpu_physical_cores": psutil.cpu_count(logical=False),
        "cpu_logical_cores": psutil.cpu_count(logical=True),
    }

def gpu_info() -> dict:
    """
    GPU 정보:
    - gpu_cuda: CUDA 사용 가능 여부
    - gpu_vram_gib: GPU VRAM 용량 (GiB 단위)
    - gpu_name: GPU 이름
    """
    try:
        import torch
        has_cuda = torch.cuda.is_available()
        vram_gib = 0.0
        name = ""
        if has_cuda:
            prop = torch.cuda.get_device_properties(0)
            vram_gib = round(prop.total_memory / (1024 ** 3), 1)
            name = prop.name
        return {"gpu_cuda": has_cuda, "gpu_vram_gib": vram_gib, "gpu_name": name}
    except Exception:
        return {"gpu_cuda": False, "gpu_vram_gib": 0.0, "gpu_name": ""}

def os_info() -> dict:
    """운영체제 이름 및 버전 반환"""
    return {
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
    }

def detect_hardware() -> dict:
    """
    시스템 전체 하드웨어 정보 통합.
    - 모든 용량 단위는 GiB
    반환 예시:
    {
      "gpu_cuda": True,
      "gpu_vram_gib": 10.5,
      "gpu_name": "NVIDIA RTX 4070",
      "cpu_logical_cores": 16,
      "cpu_physical_cores": 8,
      "cpu_freq_ghz": 4.8,
      "ram_gib": 31.9,
      "os": {"system": "Windows", "release": "10", "version": "10.0.22621"}
    }
    """
    hw = {}

    # GPU
    g = gpu_info()
    hw.update(g)

    # CPU
    c = cpu_info()
    hw.update(c)

    # RAM
    hw["ram_gib"] = ram_gib()

    # OS
    hw["os"] = os_info()

    return hw