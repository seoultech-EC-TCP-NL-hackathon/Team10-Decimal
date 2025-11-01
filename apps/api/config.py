# config.py (단순화 버전 - 수정)
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

# 이 config.py 파일(apps/api/config.py)의 부모의 부모 폴더(루트)에서 .env를 찾음
env_file_path = Path(__file__).parent.parent.parent / ".env"

class Settings(BaseSettings):
    # DATABASE_URL 환경 변수를 직접 읽어옵니다.
    DB_URL: str

    # .env 파일 경로를 명시적으로 지정
    model_config = SettingsConfigDict(
        env_file=env_file_path,
        extra='ignore' 
    )

# 설정 객체 생성
settings = Settings()