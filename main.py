# main.py
import os
import shutil
import time # AI 처리 시간 시뮬레이션을 위해 추가
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from pathlib import Path
from sqlalchemy.orm import Session
from typing import List, Optional

# 로컬 모듈 임포트
from . import models, schemas
from .database import SessionLocal, engine
from .config import settings # 설정 파일 임포트

# --- 설정 (Configurations) ---
models.Base.metadata.create_all(bind=engine)
UPLOAD_DIR = Path("./uploads")

app = FastAPI()

# --- 의존성 (Dependencies) ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- AI 파트가 구현해야 할 가상 AI 함수 및 백그라운드 작업 ---

def call_ai_model(file_path: Path, source_type: str) -> dict:
    """AI 파이프라인을 호출하는 가상 함수"""
    print(f"INFO: [AI] '{file_path.name}' 파일 처리 시작 (타입: {source_type})")
    processing_time = os.path.getsize(file_path) / (1024 * 512) # 0.5MB당 1초 가정
    time.sleep(processing_time) # 파일 크기에 비례하여 시간 시뮬레이션
    
    # AI 처리 결과물(파일)을 생성했다고 가정
    save_dir = file_path.parent
    speaker_text_path = save_dir / "speaker_transcript.txt"
    with open(speaker_text_path, "w", encoding="utf-8") as f:
        f.write(f"'{file_path.name}'의 화자 분리 텍스트입니다.")
    
    print(f"INFO: [AI] '{file_path.name}' 파일 처리 완료.")
    return {
        "extracted_text": f"'{file_path.name}'에서 추출된 전체 텍스트입니다.",
        "individual_summary": f"'{file_path.name}'에 대한 개별 요약본입니다.",
        "output_artifacts": {
            "speaker_attributed_text_path": str(speaker_text_path)
        }
    }

def run_ai_processing(job_id: int):
    """백그라운드에서 실행될 AI 처리 전체 과정"""
    print(f"INFO: [백그라운드 작업 시작] Job ID: {job_id}")
    db = SessionLocal()
    try:
        job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
        if not job: return

        job.status = models.JobStatus.PROCESSING
        db.commit()

        all_individual_summaries = []
        for material in job.source_materials:
            material.status = models.MaterialStatus.EXTRACTING
            db.commit()
            
            ai_results = call_ai_model(Path(material.storage_path), material.source_type)
            
            material.status = models.MaterialStatus.SUMMARIZING
            material.extracted_text = ai_results["extracted_text"]
            material.individual_summary = ai_results["individual_summary"]
            material.output_artifacts = ai_results["output_artifacts"]
            db.commit()

            all_individual_summaries.append(ai_results["individual_summary"])
            material.status = models.MaterialStatus.COMPLETED
            db.commit()

        # 최종 요약본 생성 (간단한 텍스트 조합으로 시뮬레이션)
        final_summary_content = "\n\n---\n\n".join(all_individual_summaries)
        final_summary_content = f"# {job.title} 최종 요약본\n\n{final_summary_content}"
        
        # 최종 요약 파일을 스토리지에 저장
        final_summary_dir = UPLOAD_DIR / "source_materials" / str(job.id)
        final_summary_path = final_summary_dir / "final_summary.md"
        with open(final_summary_path, "w", encoding="utf-8") as f:
            f.write(final_summary_content)

        job.final_summary_file_path = str(final_summary_path)
        job.status = models.JobStatus.COMPLETED
        job.completed_at = func.now()
        db.commit()
        print(f"INFO: [백그라운드 작업 성공] Job ID: {job_id}")
    except Exception as e:
        job.status = models.JobStatus.FAILED
        job.error_message = str(e)
        db.commit()
        print(f"ERROR: [백그라운드 작업 실패] Job ID: {job_id}, 에러: {e}")
    finally:
        db.close()


# --- API 엔드포인트 구현 ---

@app.post("/subjects", response_model=schemas.Subject)
def create_subject(subject: schemas.SubjectCreate, db: Session = Depends(get_db)):
    db_subject = models.Subject(**subject.model_dump())
    db.add(db_subject)
    db.commit()
    db.refresh(db_subject)
    return db_subject

@app.get("/subjects", response_model=List[schemas.Subject])
def read_subjects(db: Session = Depends(get_db)):
    subjects = db.query(models.Subject).all()
    return subjects

@app.post("/summary-jobs", response_model=schemas.SummaryJob)
async def create_summary_job_with_files(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    subject_id: Optional[int] = Form(None),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    summary_job = models.SummaryJob(title=title, subject_id=subject_id)
    db.add(summary_job)
    db.commit()
    db.refresh(summary_job)

    for file in files:
        save_dir = UPLOAD_DIR / "source_materials" / str(summary_job.id)
        os.makedirs(save_dir, exist_ok=True)
        file_location = save_dir / file.filename
        try:
            with open(file_location, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
        finally:
            file.file.close()

        source_type = "AUDIO" if file.filename.endswith(('.mp3', '.wav', '.m4a')) else "PDF"
        
        source_material = models.SourceMaterial(
            job_id=summary_job.id,
            source_type=source_type,
            original_filename=file.filename,
            storage_path=str(file_location),
            file_size_bytes=os.path.getsize(file_location)
        )
        db.add(source_material)
    
    db.commit()
    db.refresh(summary_job)
    
    # AI 처리를 백그라운드 작업으로 넘김
    background_tasks.add_task(run_ai_processing, summary_job.id)
    
    return summary_job

@app.get("/summary-jobs", response_model=List[schemas.SummaryJob])
def read_summary_jobs(subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.SummaryJob)
    if subject_id:
        query = query.filter(models.SummaryJob.subject_id == subject_id)
    return query.all()

@app.get("/summary-jobs/{job_id}", response_model=schemas.SummaryJob)
def read_summary_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.delete("/summary-jobs/{job_id}")
def delete_summary_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # 서버에 저장된 파일/폴더 삭제
    job_dir = UPLOAD_DIR / "source_materials" / str(job_id)
    if os.path.isdir(job_dir):
        shutil.rmtree(job_dir)
        
    db.delete(job)
    db.commit()
    return {"message": f"Job {job_id} and all related files deleted successfully."}