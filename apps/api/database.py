# database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# config.py에서 설정 객체를 가져옴
from config import settings

# 설정 객체에서 DATABASE_URL을 바로 사용
engine = create_engine(settings.DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
