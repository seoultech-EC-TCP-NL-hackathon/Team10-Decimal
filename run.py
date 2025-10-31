#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
FastAPI + PostgreSQL Runner (Python port of run.bat)

Features mirrored from the batch script:
- Python version check (>= 3.10)
- requirements.txt SHA256 hash detect & pip install (first-run / changes)
- uvicorn & fastapi presence check
- .env auto-generate on first run (with free PORT and random API_KEY)
- .env load into environment; update PORT in .env if port conflict
- Port probing & free-port search (up to 50 tries)
- PostgreSQL TCP connectivity probe (non-fatal)
- Duplicate instance prevention via PID file (kill if exists)
- Log directory rotation (keep N most recent)
- DEV (foreground) / PROD (background with logfile + PID) modes
- Background startup wait-loop until port is LISTENING (up to 10s)

No external dependencies; Windows-friendly (uses netstat/taskkill if needed).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple, List

# ---------- Helpers: console prints ----------
def info(msg: str) -> None:
    print(f"[INFO] {msg}")

def warn(msg: str) -> None:
    print(f"[WARN] {msg}")

def err(msg: str) -> None:
    print(f"[ERROR] {msg}")

def ok(msg: str) -> None:
    print(f"[OK] {msg}")

# ---------- System / environment helpers ----------
def ensure_python(min_version: Tuple[int, int] = (3, 10)) -> None:
    pyver = sys.version_info[:3]
    if pyver < (min_version[0], min_version[1], 0):
        err(f"Python >= {min_version[0]}.{min_version[1]} required, found {pyver[0]}.{pyver[1]}.{pyver[2]}")
        sys.exit(1)
    ok(f"Python {pyver[0]}.{pyver[1]}.{pyver[2]} detected: {sys.executable}")

def run_cmd(cmd: List[str], check: bool = False, capture: bool = False, **kwargs) -> subprocess.CompletedProcess:
    # Convenience wrapper that keeps Windows quoting safe
    return subprocess.run(cmd, check=check, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None,
                          **kwargs)

# ---------- Port & PID utilities (Windows-friendly but cross-platform best-effort) ----------
_NETSTAT_LISTEN_RE = re.compile(r":(?P<port>\d+)\s+.*LISTENING", re.IGNORECASE)

def _netstat_lines() -> List[str]:
    try:
        cp = run_cmd(["netstat", "-ano"], capture=True)
        return cp.stdout.splitlines() if cp.stdout else []
    except Exception:
        return []

def is_port_busy(port: int) -> bool:
    # returns True if busy, else False
    patt = re.compile(fr":{port}\s+.*LISTENING", re.IGNORECASE)
    for line in _netstat_lines():
        if patt.search(line):
            return True
    return False

def get_pid_on_port(port: int) -> Optional[int]:
    patt = re.compile(fr":{port}\s+.*LISTENING", re.IGNORECASE)
    for line in _netstat_lines():
        if patt.search(line):
            parts = line.split()
            if parts:
                try:
                    pid = int(parts[-1])
                    return pid
                except ValueError:
                    pass
    return None

def find_free_port(start: int, max_tries: int = 50) -> Optional[int]:
    candidate = start
    tries = 0
    while tries < max_tries:
        if not is_port_busy(candidate):
            return candidate
        candidate += 1
        tries += 1
    return None

def kill_pid(pid: int) -> None:
    # Windows: use taskkill; otherwise try os.kill
    try:
        if os.name == "nt":
            run_cmd(["taskkill", "/PID", str(pid), "/F"], check=False)
        else:
            # SIGTERM
            os.kill(pid, 15)
    except Exception:
        pass

# ---------- requirements.txt hashing & pip install ----------
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def ensure_requirements(requirements: Path, hash_file: Path) -> None:
    if not requirements.exists():
        warn("requirements.txt 가 없습니다. 의존성 설치를 스킵합니다.")
        return

    new_hash = sha256_file(requirements)
    if not hash_file.exists():
        info("의존성 설치 중 (처음 실행)...")
        _pip_install(requirements)
        hash_file.write_text(new_hash, encoding="utf-8")
    else:
        cur_hash = hash_file.read_text(encoding="utf-8").strip()
        if (cur_hash or "").lower() != new_hash.lower():
            info("requirements.txt 변경 감지 → 재설치...")
            _pip_install(requirements)
            hash_file.write_text(new_hash, encoding="utf-8")
        else:
            info("의존성 변경 없음.")

def _pip_install(requirements: Path) -> None:
    # Upgrade pip then install -r requirements.txt
    cp1 = run_cmd([sys.executable, "-m", "pip", "install", "--upgrade", "pip"], capture=True)
    if cp1.returncode != 0:
        err("pip 업그레이드 실패.")
        print(cp1.stdout or "")
        print(cp1.stderr or "")
        sys.exit(1)

    cp2 = run_cmd([sys.executable, "-m", "pip", "install", "-r", str(requirements)], capture=True)
    if cp2.returncode != 0:
        err("requirements 설치 실패.")
        print(cp2.stdout or "")
        print(cp2.stderr or "")
        sys.exit(1)

# ---------- module presence check ----------
def ensure_uvicorn_fastapi() -> None:
    try:
        import importlib.util as iu
        ok_all = all(iu.find_spec(m) is not None for m in ("uvicorn", "fastapi"))
        if not ok_all:
            raise ImportError
    except Exception:
        err("'uvicorn' 또는 'fastapi' 모듈이 없습니다.")
        print("        → requirements.txt 에 다음을 포함하고 다시 실행하세요:\n            fastapi\n            uvicorn")
        sys.exit(1)

# ---------- .env helpers ----------
def create_env_if_missing(env_path: Path, default_port: int) -> None:
    if env_path.exists():
        return
    info(".env 생성 중...")
    free_port = find_free_port(default_port) or default_port
    api_key = uuid.uuid4().hex  # N-format

    lines = [
        "ENV=development",
        f"PORT={free_port}",
        "PGHOST=127.0.0.1",
        "PGPORT=5432",
        "PGUSER=app_user",
        "PGPASSWORD=app_password",
        "PGDATABASE=app_db",
        "DB_URL=postgresql+psycopg2://app_user:app_password@127.0.0.1:5432/app_db",
        "HUGGINGFACE_TOKEN=",
        f"API_KEY={api_key}",
    ]
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

def load_env(env_path: Path) -> dict:
    env = {}
    if not env_path.exists():
        return env
    with env_path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k:
                    env[k] = v
                    os.environ[k] = v
    return env

def replace_env_port(env_path: Path, new_port: int) -> None:
    if not env_path.exists():
        return
    text = env_path.read_text(encoding="utf-8")
    # Replace first line starting with PORT=
    new_text = re.sub(r"^PORT=.*$", f"PORT={new_port}", text, flags=re.MULTILINE)
    env_path.write_text(new_text, encoding="utf-8")

def ensure_env_key(env_path: Path, key: str, default_value: str = "") -> None:
    """env 파일에 key= 가 없으면 마지막 줄에 추가한다(기존 값은 절대 덮어쓰지 않음)."""
    if not env_path.exists():
        return
    text = env_path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(key)}=", flags=re.MULTILINE)
    if not pattern.search(text):
        # 마지막 줄에 안전하게 덧붙이기
        with env_path.open("a", encoding="utf-8") as f:
            f.write(f"{key}={default_value}\n")

# ---------- PostgreSQL connectivity ----------
def probe_postgres(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

# ---------- log rotation ----------
def rotate_logs(log_dir: Path, keep: int) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    logs = sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in logs[keep:]:
        try:
            old.unlink(missing_ok=True)
        except Exception:
            pass

# ---------- uvicorn launching ----------
def build_uvicorn_cmd(app_module: str, port: int) -> List[str]:
    return [
        sys.executable, "-m", "uvicorn", app_module,
        "--host", "0.0.0.0",
        "--port", str(port),
    ]

def wait_for_listen(port: int, timeout_ms: int = 10_000) -> Optional[int]:
    wait_ms = 200
    elapsed = 0
    while elapsed < timeout_ms:
        pid = get_pid_on_port(port)
        if pid:
            return pid
        time.sleep(wait_ms / 1000.0)
        elapsed += wait_ms
        if wait_ms < 1000:
            wait_ms += 200
    return None

# ---------- main ----------
def main(argv: Optional[List[str]] = None) -> int:
    ensure_python((3, 10))

    parser = argparse.ArgumentParser(description="FastAPI Runner")
    parser.add_argument("--prod", action="store_true", help="Run in PROD mode (background with logs)")
    parser.add_argument("--app-name", default="my-app")
    parser.add_argument("--app-module", default="main:app")
    parser.add_argument("--default-port", type=int, default=8000)
    parser.add_argument("--requirements-file", default="requirements.txt")
    parser.add_argument("--log-dir", default="logs")
    parser.add_argument("--tmp-dir", default="tmp")
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--keep-logs", type=int, default=5)
    args = parser.parse_args(argv)

    APP_NAME = args.app_name
    APP_MODULE = args.app_module
    DEFAULT_PORT = int(args.default_port)
    REQUIREMENTS_FILE = Path(args.requirements_file)
    LOG_DIR = Path(args.log_dir)
    TMP_DIR = Path(args.tmp_dir)
    ENV_FILE = Path(args.env_file)
    KEEP_LOGS = int(args.keep_logs)
    PID_FILE = TMP_DIR / f"{APP_NAME}.pid"
    REQ_HASH_FILE = TMP_DIR / "requirements.sha256"

    # Directories
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    print()
    print("===============================")
    print(f" Starting {APP_NAME}")
    print("===============================")
    print()

    # requirements install if needed
    ensure_requirements(REQUIREMENTS_FILE, REQ_HASH_FILE)

    # uvicorn/fastapi check
    ensure_uvicorn_fastapi()

    # .env ensure, then load
    create_env_if_missing(ENV_FILE, DEFAULT_PORT)
    env = load_env(ENV_FILE)
    ensure_env_key(ENV_FILE, "HUGGINGFACE_TOKEN", "")   # ← 없으면 빈 키 생성
    # (참고) 값을 덮어쓰지 않으므로, WebUI에서 값을 채워 넣으면 그대로 유지됨.

    # Defaults
    PORT = int(env.get("PORT", str(DEFAULT_PORT)) or DEFAULT_PORT)
    PGHOST = env.get("PGHOST", "127.0.0.1")
    PGPORT = int(env.get("PGPORT", "5432"))

    # FastAPI port conflict → find free & update .env
    if is_port_busy(PORT):
        warn(f"FastAPI 포트 {PORT} 사용 중 → 대체 포트 탐색...")
        free_port = find_free_port(PORT)
        if free_port is None:
            err("FastAPI 대체 포트 탐색 실패.")
            return 1
        replace_env_port(ENV_FILE, free_port)
        os.environ["PORT"] = str(free_port)
        PORT = free_port
        ok(f"FastAPI 포트 {PORT} 로 변경.")
    else:
        info(f"FastAPI 포트 {PORT} 사용 가능.")

    # PostgreSQL TCP check (non-fatal)
    pg_ok = probe_postgres(PGHOST, PGPORT)
    if not pg_ok:
        warn(f"PostgreSQL({PGHOST}:{PGPORT}) 연결 실패(서버 꺼짐/방화벽/포트 충돌 가능). 계속 진행은 가능하지만 DB 접근은 실패할 수 있습니다.")

    # Prevent duplicate instance
    if PID_FILE.exists():
        try:
            old_pid = int(PID_FILE.read_text(encoding="utf-8").strip())
        except Exception:
            old_pid = None
        if old_pid:
            # If still running, kill
            kill_pid(old_pid)
        try:
            PID_FILE.unlink(missing_ok=True)
        except Exception:
            pass

    # Log file naming & rotation
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_file = LOG_DIR / f"{APP_NAME}_{ts}.log"
    rotate_logs(LOG_DIR, KEEP_LOGS)

    mode = "prod" if args.prod else "dev"
    entry_cmd = build_uvicorn_cmd(APP_MODULE, PORT)

    # Run
    if mode == "prod":
        info(f"PROD mode on PORT {PORT} (background) ...")
        # Start in background with stdout/stderr redirected to logfile
        with log_file.open("a", encoding="utf-8") as lf:
            # On Windows, creationflags to detach console a bit cleaner, but optional.
            proc = subprocess.Popen(entry_cmd, stdout=lf, stderr=lf)
        # wait loop for LISTENING
        pid_on_port = wait_for_listen(PORT, timeout_ms=10_000)
        if pid_on_port:
            PID_FILE.write_text(str(pid_on_port), encoding="utf-8")
            ok(f"PID={pid_on_port} (startup waited up to 10s)")
            info(f"Log: {log_file}")
        else:
            warn("PID를 10000ms 내에 찾지 못했습니다. 서버가 아직 기동 중일 수 있습니다.")
            info(f"Log: {log_file}")
    else:
        info(f"DEV mode on PORT {PORT} (foreground) ...")
        # Foreground: inherit IO (user sees uvicorn logs directly)
        # If you want pretty logs in console and file simultaneously, tee-like handling would be needed.
        # Keeping parity with batch: just foreground.
        rc = subprocess.call(entry_cmd)
        return rc

    print()
    print("===============================")
    print(f" Done (mode={mode})")
    print("===============================")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
