# models.py
import enum
from sqlalchemy import (
    Column, Integer, String, Text, ForeignKey, DateTime, 
    Enum as SQLAlchemyEnum, BigInteger, DECIMAL, Index,
    Boolean
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# --- Enum 타입 정의 ---
class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class MaterialStatus(str, enum.Enum):
    UPLOADED = "UPLOADED"
    TRANSCRIBING = "TRANSCRIBING"
    SUMMARIZING = "SUMMARIZING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

# --- 테이블 클래스 정의 ---
class Workspace(Base): 
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    subjects = relationship("Subject", back_populates="workspace", cascade="all, delete-orphan")

class Subject(Base):
    __tablename__ = "subjects"
    id = Column(Integer, primary_key=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False) 
    name = Column(String(255), unique=True, nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_korean_only = Column(Boolean, nullable=False, default=False)
    
    workspace = relationship("Workspace", back_populates="subjects")
    summary_jobs = relationship("SummaryJob", back_populates="subject", cascade="all, delete-orphan")

class SummaryJob(Base):
    __tablename__ = "summary_jobs"
    id = Column(Integer, primary_key=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=True) 
    title = Column(String(255), nullable=False)
    status = Column(SQLAlchemyEnum(JobStatus), nullable=False, default=JobStatus.PENDING)

    final_summary = Column(Text) 
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True)) 
    completed_at = Column(DateTime(timezone=True))

    subject = relationship("Subject", back_populates="summary_jobs")
    source_materials = relationship("SourceMaterial", back_populates="job", cascade="all, delete-orphan")
    job_stage_logs = relationship("JobStageLog", back_populates="job", cascade="all, delete-orphan") 

    __table_args__ = (
        Index('ix_summary_jobs_subject_id', 'subject_id'),
        Index('ix_summary_jobs_status', 'status'),
    )

class SourceMaterial(Base):
    __tablename__ = "source_materials"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("summary_jobs.id"), nullable=False, index=True)
    source_type = Column(String, nullable=False)
    original_filename = Column(String(255))
    storage_path = Column(Text, nullable=False)
    file_size_bytes = Column(BigInteger)
    individual_summary = Column(Text) 
    status = Column(SQLAlchemyEnum(MaterialStatus), nullable=False, default=MaterialStatus.UPLOADED)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # 화자 분리 파일 경로 등 추가 결과물 저장
    output_artifacts = Column(JSONB, nullable=True)
    
    job = relationship("SummaryJob", back_populates="source_materials")
    speaker_attributed_segments = relationship("SpeakerAttributedSegment", back_populates="material", cascade="all, delete-orphan")

# (TranscriptionSegment -> SpeakerAttributedSegment)
class SpeakerAttributedSegment(Base):
    __tablename__ = "speaker_attributed_segments" # 테이블 이름 변경

    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("source_materials.id"), nullable=False, index=True)
    speaker_label = Column(String(50))
    start_time_seconds = Column(DECIMAL(10, 4), nullable=False)
    end_time_seconds = Column(DECIMAL(10, 4), nullable=False)
    text = Column(Text, nullable=False)

    material = relationship("SourceMaterial", back_populates="speaker_attributed_segments")

class JobStageLog(Base):
    __tablename__ = "job_stage_logs"
    
    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("summary_jobs.id"), nullable=False, index=True)
    stage_name = Column(String(50), nullable=False)
    status = Column(SQLAlchemyEnum(JobStatus), nullable=False, default=JobStatus.PENDING)
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    details = Column(JSONB)

    job = relationship("SummaryJob", back_populates="job_stage_logs")

    __table_args__ = (
        Index('ix_job_stage_logs_job_id_stage_name', 'job_id', 'stage_name'),
    )