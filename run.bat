@echo off

REM UTFD-8 인코딩 (한글로그 깨짐 방지)
chcp 65001 >nul
REM ============================================
REM  FastAPI + PostgreSQL Runner (No venv)
REM  DEV mode = foreground (console logs)
REM  PROD mode = background + logfile + PID
REM ============================================

setlocal ENABLEDELAYEDEXPANSION

REM ===== Python 설치/버전 확인 (없으면 안내만 하고 종료) =====
:ensure_python
    setlocal ENABLEDELAYEDEXPANSION
    set "REQ_VER=%~1"
    if "!REQ_VER!"=="" set "REQ_VER=3.10"

    REM 실행 파일 탐색 (py -> python -> python3)
    set "PYTHON="
    for %%P in (py python python3) do (
        where %%P >nul 2>nul && if not defined PYTHON set "PYTHON=%%P"
    )
    if not defined PYTHON (
        echo [ERROR] Python 이 설치되어 있지 않습니다.
        echo         최소 버전: !REQ_VER! 이상
        echo.
        echo 설치 방법 예시:
        echo   - Windows 10/11:  winget install Python.Python.3.12
        echo   - Microsoft Store에서 "Python" 검색 후 설치
        echo   - python.org 다운로드: https://www.python.org/downloads/windows/
        exit /b 1
    )

    REM 설치된 파이썬 버전 읽기
    for /f %%V in ('!PYTHON! -c "import sys;print(\'.\'.join(map(str,sys.version_info[:3])))"') do set "PYVER=%%V"

    REM 버전 숫자 파싱 (기본값 0)
    for /f "tokens=1-3 delims=." %%a in ("!PYVER!") do ( set /a PYMAJ=%%a, PYMIN=%%b, PYPAT=%%c )
    for /f "tokens=1-3 delims=." %%a in ("!REQ_VER!") do ( set /a MINMAJ=%%a, MINMIN=%%b, MINPAT=%%c )
    if not defined PYMIN set /a PYMIN=0
    if not defined PYPAT set /a PYPAT=0
    if not defined MINMIN set /a MINMIN=0
    if not defined MINPAT set /a MINPAT=0

    REM 버전 비교 (메이저/마이너만 엄격 비교; 패치는 참고용)
    if !PYMAJ! LSS !MINMAJ! goto :_py_too_old
    if !PYMAJ! EQU !MINMAJ! if !PYMIN! LSS !MINMIN! goto :_py_too_old

    endlocal & set "PYTHON=%PYTHON%" & set "PYVER=%PYVER%"
    echo [OK] Python !PYVER! 감지됨: %PYTHON%
    exit /b 0

:_py_too_old
    echo [ERROR] Python 최소 버전 !REQ_VER! 이상이 필요합니다. 현재: !PYVER!  (경로: %PYTHON%)
    echo         최신 버전 설치 후 다시 실행해 주세요.
    exit /b 1

call :ensure_python 3.10

REM ===== 기본 설정 =====
set "APP_NAME=my-app"
set "APP_MODULE=main:app"               REM FastAPI 엔트리포인트 (예: main.py에 app 객체)
set "DEFAULT_PORT=8000"
set "REQUIREMENTS_FILE=requirements.txt"
set "LOG_DIR=logs"
set "TMP_DIR=tmp"
set "PID_FILE=%TMP_DIR%\%APP_NAME%.pid"
set "REQ_HASH_FILE=%TMP_DIR%\requirements.sha256"
set "ENV_FILE=.env"
set "KEEP_LOGS=5"
set "MODE=dev"

REM ===== 공용 실행 베이스 (포트는 나중에 결합) =====
set "ENTRY_BASE=python -m uvicorn %APP_MODULE% --host 0.0.0.0"

echo.
echo ===============================
echo  Starting %APP_NAME%
echo ===============================
echo.

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

REM ---------- helpers ----------
:is_port_busy
    for /f "tokens=1-5" %%a in ('netstat -ano ^| findstr /R /C:":%1 .*LISTENING"') do ( exit /b 0 )
    exit /b 1

:find_free_port
    set "CANDIDATE=%~1"
    set "TRIES=0"
    :_ffp_loop
        call :is_port_busy %CANDIDATE%
        if !ERRORLEVEL!==0 (
        set /a CANDIDATE+=1
        set /a TRIES+=1
        if !TRIES! GEQ 50 ( set "FREE_PORT=" & exit /b 1 )
        goto _ffp_loop
        ) else ( set "FREE_PORT=%CANDIDATE%" & exit /b 0 )

:get_pid_on_port
    set "PID_ON_PORT="
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%1 .*LISTENING"') do ( set "PID_ON_PORT=%%p" )
    exit /b 0

REM ---------- requirements.txt 변경 감지 ----------
if exist "%REQUIREMENTS_FILE%" (
    for /f "tokens=1" %%H in ('certutil -hashfile "%REQUIREMENTS_FILE%" SHA256 ^| findstr /R "^[0-9A-F]"') do set "NEW_HASH=%%H"

    if not exist "%REQ_HASH_FILE%" (
        echo [INFO] 의존성 설치 중 (처음 실행)...
        %PYTHON% -m pip install --upgrade pip
        %PYTHON% -m pip install -r "%REQUIREMENTS_FILE%"
        if not "%ERRORLEVEL%"=="0" ( echo [ERROR] requirements 설치 실패. & exit /b 1 )
        echo %NEW_HASH% > "%REQ_HASH_FILE%"
    ) else (
        set /p CUR_HASH=<"%REQ_HASH_FILE%"
        if /I not "%CUR_HASH%"=="%NEW_HASH%" (
            echo [INFO] requirements.txt 변경 감지 → 재설치...
            %PYTHON% -m pip install --upgrade pip
            %PYTHON% -m pip install -r "%REQUIREMENTS_FILE%"
            if not "%ERRORLEVEL%"=="0" ( echo [ERROR] requirements 재설치 실패. & exit /b 1 )
            echo %NEW_HASH% > "%REQ_HASH_FILE%"
        ) else (
            echo [INFO] 의존성 변경 없음.
        )
    )
) else (
    echo [WARN] requirements.txt 가 없습니다. 의존성 설치를 스킵합니다.
)

REM ---------- uvicorn/fastapi 설치 여부 확인 (자동설치 없음, 없으면 종료) ----------
%PYTHON% -c "import importlib,sys;mods=['uvicorn','fastapi'];sys.exit(0 if all(importlib.util.find_spec(m) for m in mods) else 1)"
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] 'uvicorn' 또는 'fastapi' 모듈이 없습니다.
    echo         → requirements.txt 에 다음을 포함하고 다시 실행하세요:
    echo             fastapi
    echo             uvicorn
    exit /b 1
)

REM ---------- .env 자동 생성(없으면) ----------
if not exist "%ENV_FILE%" (
    echo [INFO] .env 생성 중...
    set "DEFAULT_START_PORT=%DEFAULT_PORT%"
    call :find_free_port %DEFAULT_START_PORT%
    for /f %%G in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(''N'')"') do set "API_KEY_GEN=%%G"
    (
        echo ENV=development
        echo PORT=!FREE_PORT!
        echo PGHOST=127.0.0.1
        echo PGPORT=5432
        echo PGUSER=app_user
        echo PGPASSWORD=app_password
        echo PGDATABASE=app_db
        REM 아래는 리터럴로 기록(다른 변수 참조 안 함)
        echo DB_URL=postgresql+psycopg2://app_user:app_password@127.0.0.1:5432/app_db
        echo API_KEY=!API_KEY_GEN!
    ) > "%ENV_FILE%"
)

REM ---------- .env 로드 ----------
for /f "usebackq delims=" %%A in ("%ENV_FILE%") do (
    set "LINE=%%A"
    if not "!LINE!"=="" (
        echo !LINE! | findstr /b "#" >nul || (
        for /f "tokens=1,* delims==" %%K in ("!LINE!") do if not "%%K"=="" set "%%K=%%L"
        )
    )
)

if not defined PORT set "PORT=%DEFAULT_PORT%"
if not defined PGHOST set "PGHOST=127.0.0.1"
if not defined PGPORT set "PGPORT=5432"

REM ---------- FastAPI 포트 자동 충돌 회피 ----------
call :is_port_busy %PORT%
if !ERRORLEVEL!==0 (
    echo [WARN] FastAPI 포트 %PORT% 사용 중 → 대체 포트 탐색...
    call :find_free_port %PORT%
    if defined FREE_PORT (
        powershell -NoProfile -Command "(Get-Content '%ENV_FILE%') -replace '^PORT=.*', 'PORT=%FREE_PORT%' | Set-Content '%ENV_FILE%'" >nul 2>&1
        set "PORT=%FREE_PORT%"
        echo [OK] FastAPI 포트 %PORT% 로 변경.
    ) else (
        echo [ERROR] FastAPI 대체 포트 탐색 실패.
        exit /b 1
    )
) else (
    echo [INFO] FastAPI 포트 %PORT% 사용 가능.
)

REM ---------- PostgreSQL TCP 체크 (구버전 PS 대응: 순수 .NET 소켓) ----------
for /f %%R in ('powershell -NoProfile -Command "$c=new-object net.sockets.tcpclient;try{$c.Connect(''%PGHOST%'',%PGPORT%);$ok=$c.Connected}catch{$ok=$false};$c.Close();$ok"') do set "PG_OK=%%R"
if /I not "%PG_OK%"=="True" (
    echo [WARN] PostgreSQL(%PGHOST%:%PGPORT%) 연결 실패(서버 꺼짐/방화벽/포트 충돌 가능). 계속 진행은 가능하지만 DB 접근은 실패할 수 있습니다.
)

REM ---------- 중복 실행 방지 ----------
if exist "%PID_FILE%" (
    set /p OLD_PID=<"%PID_FILE%"
    tasklist /FI "PID eq %OLD_PID%" | find "%OLD_PID%" >nul && taskkill /PID %OLD_PID% /F >nul
    del "%PID_FILE%" >nul 2>nul
)

REM ---------- 로그 파일명(ISO 타임스탬프) ----------
for /f %%T in ('powershell -NoProfile -Command "(Get-Date).ToString(''yyyyMMdd-HHmmss'')"') do set "TS=%%T"
set "LOG_FILE=%LOG_DIR%\%APP_NAME%_%TS%.log"

REM 오래된 로그 삭제
pushd "%LOG_DIR%" >nul
for /f "skip=%KEEP_LOGS% delims=" %%F in ('dir /b /o-d *.log 2^>nul') do del "%%F"
popd >nul

if "%1"=="--prod" set "MODE=prod"

REM ---------- 실행 직전: 포트 결합해 최종 커맨드 생성 ----------
set "ENTRY_CMD=%ENTRY_BASE% --port %PORT%"

REM ---------- 실행 ----------
if /I "%MODE%"=="prod" (
    echo [INFO] PROD mode on PORT %PORT% (background) ...
    start "" /B cmd /c "%ENTRY_CMD% >> "%LOG_FILE%" 2>&1"

    REM === robust PID wait-loop: wait up to ~10s for LISTENING ===
    set "WAIT_MS=200"
    set "MAX_MS=10000"
    set /a ELAPSED=0
    set "PID_FOUND="

    :wait_uvicorn_listen
    call :get_pid_on_port %PORT%
    if defined PID_ON_PORT (
        set "PID_FOUND=%PID_ON_PORT%"
        goto :pid_ok
    )

    powershell -NoProfile -Command "Start-Sleep -Milliseconds %WAIT_MS%" >nul
    set /a ELAPSED+=WAIT_MS
    if %WAIT_MS% LSS 1000 set /a WAIT_MS+=200
    if %ELAPSED% LSS %MAX_MS% goto :wait_uvicorn_listen

    echo [WARN] PID를 %MAX_MS%ms 내에 찾지 못했습니다. 서버가 아직 기동 중일 수 있습니다.
    echo [INFO] Log: %LOG_FILE%
    goto :after_start

    :pid_ok
    echo %PID_FOUND% > "%PID_FILE%"
    echo [OK] PID=%PID_FOUND% (startup waited %ELAPSED% ms)
    echo [INFO] Log: %LOG_FILE%

    :after_start
) else (
    echo [INFO] DEV mode on PORT %PORT% (foreground) ...
    %ENTRY_CMD%
)

echo.
echo ===============================
echo  Done (mode=%MODE%)
echo ===============================
echo.
exit /b 0