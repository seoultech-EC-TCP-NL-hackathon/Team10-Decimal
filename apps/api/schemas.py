# schemas.py
from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any
from datetime import datetime
from decimal import Decimal
from models import JobStatus, MaterialStatus


# --- Base Schemas ---
class WorkspaceBase(BaseModel):
    name: str
    description: Optional[str] = None


class SubjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    is_korean_only: bool = False  # 기본값은 False


class SummaryJobBase(BaseModel):
    title: str
    subject_id: Optional[int] = None


class SpeakerAttributedSegmentBase(BaseModel):
    speaker_label: Optional[str] = None
    start_time_seconds: Decimal
    end_time_seconds: Decimal
    text: str


class JobStageLogBase(BaseModel):
    stage_name: str
    details: Optional[Any] = None


class SourceMaterialBase(BaseModel):
    source_type: str
    original_filename: Optional[str] = None
    storage_path: str
    file_size_bytes: Optional[int] = None
    individual_summary: Optional[str] = None
    output_artifacts: Optional[Any] = None  # JSONB 타입, Optional


# --- Create Schemas ---
class WorkspaceCreate(WorkspaceBase):
    pass


class SubjectCreate(SubjectBase):
    workspace_id: int  # 생성 시 workspace_id 필요


class SummaryJobCreate(SummaryJobBase):
    pass


class SpeakerAttributedSegmentCreate(SpeakerAttributedSegmentBase):
    material_id: int


class JobStageLogCreate(JobStageLogBase):
    job_id: int


class SourceMaterialCreate(SourceMaterialBase):
    job_id: int


# --- Read/Response Schemas ---
class SpeakerAttributedSegment(SpeakerAttributedSegmentBase):
    id: int
    material_id: int
    model_config = ConfigDict(from_attributes=True)


class SourceMaterial(SourceMaterialBase):
    id: int
    job_id: int
    status: MaterialStatus
    created_at: datetime
    speaker_attributed_segments: List[SpeakerAttributedSegment] = []
    model_config = ConfigDict(from_attributes=True)


class JobStageLog(JobStageLogBase):
    id: int
    job_id: int
    status: JobStatus
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class Subject(SubjectBase):
    id: int
    workspace_id: int  # 조회 시 workspace_id 포함
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SummaryJob(SummaryJobBase):
    id: int
    status: JobStatus
    final_summary: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    source_materials: List[SourceMaterial] = []
    job_stage_logs: List[JobStageLog] = []

    model_config = ConfigDict(from_attributes=True)


class Workspace(WorkspaceBase):
    id: int
    created_at: datetime
    subjects: List[Subject] = []
    model_config = ConfigDict(from_attributes=True)


# --- Detail Schemas ---
class SummaryJobDetail(SummaryJob):
    subject: Optional[Subject] = None


class SubjectDetail(Subject):
    workspace: Optional[Workspace] = None
    summary_jobs: List[SummaryJob] = []


class WorkspaceDetail(Workspace):
    pass
