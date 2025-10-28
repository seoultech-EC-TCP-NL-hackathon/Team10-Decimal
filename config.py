# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

# .env 파일 경로 설정은 그대로 두어도 좋습니다.
# .bat 파일에서 환경 변수를 설정하면 .env 파일보다 우선 적용됩니다.
env_file_path = Path(__file__).parent / ".env"

class Settings(BaseSettings):
    # 환경 변수로부터 DATABASE_URL을 직접 읽어옵니다.
    DATABASE_URL: str

    model_config = SettingsConfigDict(env_file=env_file_path)

# 설정 객체 생성
settings = Settings()