# config.py (단순화 버전 - 수정)
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

# 이 config.py 파일과 같은 디렉토리에서 .env 파일을 찾도록 경로 설정
env_file_path = Path(__file__).parent / ".env"

class Settings(BaseSettings):
    # DATABASE_URL 환경 변수를 직접 읽어옵니다.
    DATABASE_URL: str

    # .env 파일 경로를 명시적으로 지정
    model_config = SettingsConfigDict(
        env_file=env_file_path,
        extra='ignore' 
    )

# 설정 객체 생성
settings = Settings()