# models.py
import enum
from sqlalchemy import (
    Column, Integer, String, Text, ForeignKey, DateTime, 
    Enum as SQLAlchemyEnum, BigInteger
)
from sqlalchemy.dialects.postgresql import JSONB # PostgreSQL의 JSONB 타입을 위해 임포트
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# --- Enum 타입 정의 ---
class JobStatus(str, enum.Enum):
    PENDING = "PENDING"; PROCESSING = "PROCESSING"; COMPLETED = "COMPLETED"; FAILED = "FAILED"

class MaterialStatus(str, enum.Enum):
    UPLOADED = "UPLOADED"; EXTRACTING = "EXTRACTING"; SUMMARIZING = "SUMMARIZING"; COMPLETED = "COMPLETED"; FAILED = "FAILED"

# --- 테이블 클래스 정의 ---
class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    summary_jobs = relationship("SummaryJob", back_populates="subject", cascade="all, delete-orphan")

class SummaryJob(Base):
    __tablename__ = "summary_jobs"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), index=True)
    title = Column(String(255), nullable=False)
    status = Column(SQLAlchemyEnum(JobStatus), nullable=False, default=JobStatus.PENDING, index=True)
    final_summary_file_path = Column(Text)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))

    subject = relationship("Subject", back_populates="summary_jobs")
    source_materials = relationship("SourceMaterial", back_populates="job", cascade="all, delete-orphan")

class SourceMaterial(Base):
    __tablename__ = "source_materials"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("summary_jobs.id"), nullable=False, index=True)
    source_type = Column(String, nullable=False)
    original_filename = Column(String(255))
    storage_path = Column(Text, nullable=False)
    file_size_bytes = Column(BigInteger)
    extracted_text = Column(Text)
    individual_summary = Column(Text)
    status = Column(SQLAlchemyEnum(MaterialStatus), nullable=False, default=MaterialStatus.UPLOADED)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    output_artifacts = Column(JSONB)

    job = relationship("SummaryJob", back_populates="source_materials")