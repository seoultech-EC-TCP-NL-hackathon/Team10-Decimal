# apps/api/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker, declarative_base

# 윈도우에서 클라이언트 인코딩 강제 (디코딩 오류 회피)
os.environ.setdefault("PGCLIENTENCODING", "UTF8")

# .env의 개별 값도 함께 쓰게끔 (없으면 기본값 사용)
PGUSER = os.getenv("PGUSER", "app_user")
PGPASSWORD = os.getenv("PGPASSWORD", "admin1234")
PGHOST = os.getenv("PGHOST", "127.0.0.1")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGDATABASE = os.getenv("PGDATABASE", "app_db")

# 문자열 DSN 대신 URL 객체로 생성 → DSN 디코딩 우회
url = URL.create(
    drivername="postgresql+psycopg2",   # (psycopg3 쓰면 'postgresql+psycopg')
    username=PGUSER,
    password=PGPASSWORD,
    host=PGHOST,
    port=PGPORT,
    database=PGDATABASE,
)

engine = create_engine(url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
