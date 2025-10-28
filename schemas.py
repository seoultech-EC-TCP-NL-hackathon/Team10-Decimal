# schemas.py
from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any
from datetime import datetime
from .models import JobStatus, MaterialStatus # models.py에서 Enum 클래스 임포트

# --- SourceMaterial 스키마 ---
class SourceMaterialBase(BaseModel):
    source_type: str
    original_filename: Optional[str] = None
    storage_path: str
    file_size_bytes: Optional[int] = None

class SourceMaterial(SourceMaterialBase):
    id: int
    job_id: int
    status: MaterialStatus
    created_at: datetime
    output_artifacts: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)

# --- Subject 스키마 ---
class SubjectBase(BaseModel):
    name: str
    description: Optional[str] = None

class SubjectCreate(SubjectBase):
    pass

class Subject(SubjectBase):
    id: int
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

# --- SummaryJob 스키마 ---
class SummaryJobBase(BaseModel):
    title: str
    subject_id: Optional[int] = None

class SummaryJobCreate(SummaryJobBase):
    pass

class SummaryJob(SummaryJobBase):
    id: int
    status: JobStatus
    final_summary_file_path: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    # 관계를 맺고 있는 객체들도 함께 응답에 포함
    subject: Optional[Subject] = None
    source_materials: List[SourceMaterial] = []

    model_config = ConfigDict(from_attributes=True)