@echo off
REM ============================================
REM  FastAPI + PostgreSQL Runner (Interactive PG port conflict handler)
REM ============================================

setlocal ENABLEDELAYEDEXPANSION

REM ===== 기본 설정 =====
set "APP_NAME=my-app"
set "REQUIREMENTS_FILE=requirements.txt"
set "LOG_DIR=logs"
set "TMP_DIR=tmp"
set "PID_FILE=%TMP_DIR%\%APP_NAME%.pid"
set "REQ_HASH_FILE=%TMP_DIR%\requirements.hash"
set "ENV_FILE=.env"
set "KEEP_LOGS=5"
set "MODE=dev"

REM FastAPI (uvicorn) 실행 커맨드 (%PORT% 사용)
set "ENTRY_CMD=python -m uvicorn main:app --host 0.0.0.0 --port %PORT%"

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

REM ---------- Python 확인 ----------
where python >nul 2>nul || ( echo [ERROR] Python 미설치. & pause & exit /b 1 )

REM ---------- .env 자동 생성(없으면) ----------
if not exist "%ENV_FILE%" (
  echo [INFO] .env 생성 중...
  set "DEFAULT_START_PORT=8000"
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
    echo DB_URL=postgresql+psycopg2://%%PGUSER%%:%%PGPASSWORD%%@%%PGHOST%%:%%PGPORT%%/%%PGDATABASE%%
    echo POSTGRES_SERVICE_NAME=
    echo POSTGRES_DATA_DIR=
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

if not defined PORT set "PORT=8000"
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

REM ---------- PostgreSQL TCP 연결 간이 체크 ----------
echo [INFO] Checking PostgreSQL TCP on %PGHOST%:%PGPORT% ...
for /f %%R in ('powershell -NoProfile -Command "Test-NetConnection -ComputerName '%PGHOST%' -Port %PGPORT% -WarningAction SilentlyContinue -InformationLevel Quiet"') do set "PG_OK=%%R"

if /I not "%PG_OK%"=="True" (
  REM 여기서 바로 실패하지 말고, 5432 충돌/미기동 등 상황별로 처리
  call :is_port_busy %PGPORT%
  if !ERRORLEVEL!==0 (
    REM ==== 포트는 점유되어 있는데 DB연결 실패 → 충돌 핸들러 호출 ====
    call :handle_pg_port_conflict
  ) else (
    echo [ERROR] PostgreSQL(%PGHOST%:%PGPORT%)에 연결할 수 없습니다. 서버가 꺼져있을 수 있습니다.
    echo        - 서비스 시작 또는 환경 변수 확인 후 재실행하세요.
    exit /b 1
  )
) else (
  echo [OK] PostgreSQL TCP 연결 확인됨.
)

REM ---------- 의존성 ----------
if exist "%REQUIREMENTS_FILE%" (
  for %%F in ("%REQUIREMENTS_FILE%") do set "NEW_HASH=%%~zF"
  if not exist "%REQ_HASH_FILE%" (
    echo %NEW_HASH% > "%REQ_HASH_FILE%"
    python -m pip install --upgrade pip
    python -m pip install -r "%REQUIREMENTS_FILE%"
  ) else (
    set /p CUR_HASH=<"%REQ_HASH_FILE%"
    if not "%CUR_HASH%"=="%NEW_HASH%" (
      echo %NEW_HASH% > "%REQ_HASH_FILE%"
      python -m pip install --upgrade pip
      python -m pip install -r "%REQUIREMENTS_FILE%"
    )
  )
)

REM ---------- 중복 실행 방지 ----------
if exist "%PID_FILE%" (
  set /p PID=<"%PID_FILE%"
  tasklist /FI "PID eq %PID%" | find "%PID%" >nul && taskkill /PID %PID% /F >nul
  del "%PID_FILE%" >nul 2>nul
)

REM ---------- 로그 ----------
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set "TODAY=%%a-%%b-%%c"
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set "TIME_NOW=%%a-%%b"
set "LOG_FILE=%LOG_DIR%\%APP_NAME%_%TODAY%_%TIME_NOW%.log"
pushd "%LOG_DIR%" >nul
for /f "skip=%KEEP_LOGS% delims=" %%F in ('dir /b /o-d *.log 2^>nul') do del "%%F"
popd >nul

if "%1"=="--prod" set "MODE=prod"

REM ---------- 실행 ----------
if "%MODE%"=="prod" (
  echo [INFO] PRODUCTION mode on PORT %PORT% ...
  start "" /B cmd /c "%ENTRY_CMD% >> "%LOG_FILE%" 2>&1"
  for /f "tokens=2 delims=," %%P in ('wmic process where "commandline like '%%%ENTRY_CMD%%%' and not name like 'wmic%%'" get processid /format:csv ^| findstr /r "[0-9]"') do set "PID=%%P"
  if defined PID ( echo %PID% > "%PID_FILE%" )
  echo [INFO] Background. Log: %LOG_FILE%
) else (
  echo [INFO] DEV mode on PORT %PORT% ...
  %ENTRY_CMD% 2>&1 | tee "%LOG_FILE%"
)

echo.
echo ===============================
echo  Done (mode=%MODE%)
echo ===============================
echo.
exit /b 0

REM =================== 여기부터: PG 포트 충돌 핸들러 ===================
:handle_pg_port_conflict
  echo.
  echo [ALERT] PostgreSQL 포트 %PGPORT% 가 다른 프로세스에 점유되어 있습니다.
  call :get_pid_on_port %PGPORT%
  if defined PID_ON_PORT (
    for /f "tokens=*" %%x in ('tasklist /FI "PID eq %PID_ON_PORT%" ^| find /I "%PID_ON_PORT%"') do set "PROC_LINE=%%x"
    echo   - 점유 PID: %PID_ON_PORT%
    echo   - 프로세스: %PROC_LINE%
  )

  echo.
  echo 선택하세요:
  echo   [1] PostgreSQL 서버의 포트를 변경(예: 5433)하고 서비스 재시작 (권장)
  echo   [2] 5432 점유 프로세스를 강제로 종료 (위험할 수 있음)
  echo   [3] 중단
  set /p CHOICE="입력 (1/2/3): "

  if "%CHOICE%"=="1" goto change_pg_port
  if "%CHOICE%"=="2" goto kill_conflict
  goto abort_run

:change_pg_port
  echo.
  if "%POSTGRES_SERVICE_NAME%"=="" (
    set /p POSTGRES_SERVICE_NAME="PostgreSQL 서비스 이름 입력 (예: postgresql-x64-14): "
  )
  if "%POSTGRES_DATA_DIR%"=="" (
    set /p POSTGRES_DATA_DIR="postgresql.conf 가 있는 데이터 디렉터리 입력 (예: C:\Program Files\PostgreSQL\14\data): "
  )

  if not exist "%POSTGRES_DATA_DIR%\postgresql.conf" (
    echo [ERROR] postgresql.conf 경로가 올바르지 않습니다: %POSTGRES_DATA_DIR%
    goto abort_run
  )

  echo [INFO] 새 포트 탐색 시작 (from %PGPORT%+1)...
  set /a START=%PGPORT%+1
  call :find_free_port !START!
  if not defined FREE_PORT (
    echo [ERROR] 대체 포트를 찾지 못했습니다.
    goto abort_run
  )
  echo [INFO] 새 포트 후보: %FREE_PORT%

  echo [INFO] postgresql.conf 업데이트 (port = %FREE_PORT%)...
  powershell -NoProfile -Command "(Get-Content '%POSTGRES_DATA_DIR%\postgresql.conf') -replace '^[\s#]*port\s*=\s*\d+','port = %FREE_PORT%' | Set-Content '%POSTGRES_DATA_DIR%\postgresql.conf'"

  echo [INFO] 서비스 재시작: %POSTGRES_SERVICE_NAME%
  net stop "%POSTGRES_SERVICE_NAME%"
  if not "%ERRORLEVEL%"=="0" echo [WARN] 서비스 중지 단계에서 경고가 발생할 수 있습니다.
  net start "%POSTGRES_SERVICE_NAME%"
  if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] 서비스 시작 실패. 서비스명/권한/로그를 확인하세요.
    goto abort_run
  )

  echo [INFO] .env 갱신 (PGPORT, DB_URL)...
  powershell -NoProfile -Command "(Get-Content '.env') -replace '^PGPORT=.*', 'PGPORT=%FREE_PORT%' | Set-Content '.env'"
  powershell -NoProfile -Command "(Get-Content '.env') -replace '^DB_URL=.*', 'DB_URL=postgresql+psycopg2://%PGUSER%:%PGPASSWORD%@%PGHOST%:%FREE_PORT%/%PGDATABASE%' | Set-Content '.env'"

  set "PGPORT=%FREE_PORT%"
  echo [OK] PostgreSQL가 새 포트(%PGPORT%)로 재구동되었습니다.
  echo.
  exit /b 0

:kill_conflict
  if not defined PID_ON_PORT (
    echo [ERROR] 점유 PID를 찾지 못했습니다.
    goto abort_run
  )
  echo.
  set /p CONFIRM="PID %PID_ON_PORT% 를 정말 종료할까요? (Y/N): "
  if /I not "%CONFIRM%"=="Y" goto abort_run

  taskkill /PID %PID_ON_PORT% /F
  if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] 프로세스 종료 실패. 관리자 권한이 필요할 수 있습니다.
    goto abort_run
  )
  echo [OK] 프로세스 종료 완료.
  echo.
  exit /b 0

:abort_run
  echo.
  echo [ABORT] 실행을 중단합니다.
  exit /b 1
