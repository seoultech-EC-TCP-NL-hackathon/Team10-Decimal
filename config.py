# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    # 환경 변수로부터 DATABASE_URL 읽어옴
    DATABASE_URL: str

# 설정 객체 생성
settings = Settings()