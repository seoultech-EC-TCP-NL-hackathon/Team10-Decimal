# main.py (is_korean_only 로직 수정)
import os
import shutil
import time
from datetime import datetime, timezone
from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Form, 
    BackgroundTasks, Response
)
from fastapi.responses import JSONResponse
from pathlib import Path
from sqlalchemy.orm import Session
from typing import List, Optional
from fastapi.staticfiles import StaticFiles

# 로컬 모듈 임포트
from . import models, schemas
from .database import SessionLocal, engine

# --- 설정 (Configurations) ---
models.Base.metadata.create_all(bind=engine)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROJECTS_BASE_DIR = PROJECT_ROOT / "apps" / "projects"
AI_OUTPUT_DIR = PROJECT_ROOT / "apps" / "ai" / "output"
ALLOWED_EXTENSIONS = {".mp3", ".aac", ".m4a", ".wav",".flac",".ogg",".opus",".webm"}
MAX_FILES = 10
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024 # 10GB

app = FastAPI()

app.mount("/", StaticFiles(directory="apps/web/dist", html=True), name="static")

# --- 의존성 (Dependencies) ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- AI 파트 가상 함수 (시그니처 변경 없음) ---
def call_ai_model(file_path: Path, source_type: str, is_korean_only: bool) -> dict:
    """AI 파이프라인을 호출하는 가상 함수"""
    print(f"INFO: [AI] '{file_path.name}' 파일 처리 시작 (타입: {source_type})")
    
    if is_korean_only:
        print("INFO: [AI] === 한국어 특화 모델 사용 ===")
    else:
        print("INFO: [AI] === 일반 모델 사용 ===")
        
    processing_time = os.path.getsize(file_path) / (1024 * 512)
    time.sleep(processing_time)
    
    segments = [
        {"speaker_label": "Speaker 1", "start_time_seconds": 0.5, "end_time_seconds": 4.2, "text": "안녕하세요, 오늘 강의를 시작하겠습니다."},
        {"speaker_label": "Speaker 2", "start_time_seconds": 5.1, "end_time_seconds": 9.8, "text": "네, 교수님. 지난 시간에 배운 내용에 대해 질문이 있습니다."},
    ]
    
    save_dir = AI_OUTPUT_DIR
    save_dir.mkdir(parents=True, exist_ok=True) # 폴더가 없으면 생성
    
    file_stem = file_path.stem # 'audio1.mp3'에서 'audio1'을 추출
    
    # 1. speaker_attributed_text_path
    speaker_text_path = save_dir / f"{file_stem}_transcript.txt"
    with open(speaker_text_path, "w", encoding="utf-8") as f:
        f.write("[00:00:00.500] Speaker 1: 안녕하세요, 오늘 강의를 시작하겠습니다.\n")
        f.write("[00:00:05.100] Speaker 2: 네, 교수님. 지난 시간에 배운 내용에 대해 질문이 있습니다.\n")

    # 2. individual_summary
    individual_summary_content = f"'{file_path.name}'에 대한 AI 개별 요약본입니다."
    summary_text_path = save_dir / f"{file_stem}_summary.txt"
    with open(summary_text_path, "w", encoding="utf-8") as f:
        f.write(individual_summary_content)

    print(f"INFO: [AI] '{file_path.name}' 파일 처리 완료.")
    return {
        "transcription_segments": segments, 
        "individual_summary": individual_summary_content, # DB 저장을 위해 텍스트도 반환
        "output_artifacts": {
            "speaker_attributed_text_path": str(speaker_text_path),
            "individual_summary_path": str(summary_text_path) # 요약 파일 경로도 반환
        }
    }

# --- 백그라운드 작업  ---
def run_ai_processing(job_id: int):
    """백그라운드에서 실행될 AI 처리 전체 과정"""
    print(f"INFO: [백그라운드 작업 시작] Job ID: {job_id}")
    db = SessionLocal()
    job = None
    transcribe_log = None
    summarize_log = None
    
    try:
        job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
        if not job: 
            print(f"ERROR: Job ID {job_id}를 찾을 수 없음")
            return

        # ---  1. Subject에서 is_korean_only 플래그 가져오기  ---
        is_korean_flag = False # 기본값
        subject_name_for_path = "default_subject"
        workspace_name_for_path = "default_workspace" 

        if job.subject_id:
            subject = db.query(models.Subject).filter(models.Subject.id == job.subject_id).first()
            
            if subject:
                is_korean_flag = subject.is_korean_only
                subject_name_for_path = subject.name
                
                if subject.workspace:
                    workspace_name_for_path = subject.workspace.name
                else:
                    workspace = db.query(models.Workspace).filter(models.Workspace.id == subject.workspace_id).first()
                    if workspace:
                        workspace_name_for_path = workspace.name
        
        print(f"INFO: [AI] 작업 {job_id}의 한국어 특화 모델 사용 여부: {is_korean_flag}")

        job.status = models.JobStatus.PROCESSING
        job.started_at = datetime.now(timezone.utc)
        
        transcribe_log = models.JobStageLog(
            job_id=job_id, 
            stage_name="transcribe", 
            status=models.JobStatus.PROCESSING, 
            start_time=datetime.now(timezone.utc)
        )
        summarize_log = models.JobStageLog(
            job_id=job_id, 
            stage_name="summarize", 
            status=models.JobStatus.PROCESSING, 
            start_time=datetime.now(timezone.utc)
        )
        db.add_all([transcribe_log, summarize_log])
        
        # [수정] DB Commit은 루프 밖에서 한 번만 수행하도록 변경
        # db.commit() # <- (삭제)

        for material in job.source_materials:
            
            # ---  2. call_ai_model로 플래그 값 전달  ---
            dynamic_input_dir = PROJECTS_BASE_DIR / workspace_name_for_path / subject_name_for_path
            full_file_path = dynamic_input_dir / material.storage_path
            
            if not full_file_path.exists():
                print(f"ERROR: AI가 처리할 원본 파일을 찾을 수 없습니다: {full_file_path}")
                material.status = models.MaterialStatus.FAILED
                # db.commit() # <- (삭제)
                continue # 다음 material 루프로 이동

            ai_results = call_ai_model(
                full_file_path, 
                material.source_type, 
                is_korean_flag
            )
            
            for seg_data in ai_results["transcription_segments"]:
                segment = models.SpeakerAttributedSegment(
                    material_id=material.id, 
                    **seg_data
                )
                db.add(segment)
            
            material.individual_summary = ai_results["individual_summary"]
            material.output_artifacts = ai_results["output_artifacts"]
            
            # [수정] SUMMARIZING 단계를 건너뛰고 바로 COMPLETED로 변경
            material.status = models.MaterialStatus.COMPLETED 
        
        # [수정] db.commit()을 루프 밖으로 이동 (10개 파일 처리 후 1번만 커밋)
        db.commit() 
        
        transcribe_log.status = models.JobStatus.COMPLETED
        transcribe_log.end_time = datetime.now(timezone.utc)
        
        summarize_log.status = models.JobStatus.COMPLETED
        summarize_log.end_time = datetime.now(timezone.utc)

        # [수정] (논리 오류 1) 불필요한 덮어쓰기 루프 삭제
        # for material in job.source_materials:
        #     material.status = models.MaterialStatus.COMPLETED

        # [수정] (논리 오류 2) 최종 작업 상태 판별
        # DB에서 방금 커밋된 material 상태를 다시 로드(refresh)
        db.refresh(job) 
        
        failed_materials_count = db.query(models.SourceMaterial).filter(
            models.SourceMaterial.job_id == job_id,
            models.SourceMaterial.status == models.MaterialStatus.FAILED
        ).count()

        if failed_materials_count > 0:
            job.status = models.JobStatus.FAILED
            job.error_message = f"총 {len(job.source_materials)}개 파일 중 {failed_materials_count}개 처리 실패."
        else:
            job.status = models.JobStatus.COMPLETED
            job.completed_at = datetime.now(timezone.utc)
        
        db.commit() # 최종 Job 상태 저장
        print(f"INFO: [백그라운드 작업 {job.status}] Job ID: {job_id}")

    except Exception as e:
        # ... (예외 처리 동일) ...
        print(f"ERROR: [백그라운드 작업 실패] Job ID: {job_id}, 에러: {e}")
        if job:
            job.status = models.JobStatus.FAILED
            job.error_message = f"Processing failed: {type(e).__name__} - {str(e)}"
            if transcribe_log and transcribe_log.status == models.JobStatus.PROCESSING:
                transcribe_log.status = models.JobStatus.FAILED
                transcribe_log.end_time = datetime.now(timezone.utc)
            if summarize_log and summarize_log.status == models.JobStatus.PROCESSING:
                summarize_log.status = models.JobStatus.FAILED
                summarize_log.end_time = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()

# --- API 엔드포인트 구현 ---

@app.post("/workspaces", response_model=schemas.Workspace, status_code=201)
def create_workspace(workspace: schemas.WorkspaceCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Workspace).filter(models.Workspace.name == workspace.name).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Workspace with name '{workspace.name}' already exists.")
    
    db_workspace = models.Workspace(**workspace.model_dump())
    db.add(db_workspace)
    db.commit()
    db.refresh(db_workspace)
    return db_workspace

@app.get("/workspaces", response_model=List[schemas.WorkspaceDetail])
def read_workspaces(db: Session = Depends(get_db)):
    return db.query(models.Workspace).all()

@app.delete("/workspaces/{workspace_id}", status_code=204)
def delete_workspace(workspace_id: int, db: Session = Depends(get_db)):
    # 1. 워크스페이스 조회
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail=f"Workspace with id {workspace_id} not found.")

    # 2. [파일 삭제] 하위의 모든 AI 산출물 파일(txt)을 먼저 삭제
    try:
        # [수정] N+1 쿼리를 방지하기 위해 삭제할 Material을 한 번에 조회
        materials_to_delete = db.query(models.SourceMaterial).join(models.SummaryJob).join(models.Subject).filter(
            models.Subject.workspace_id == workspace_id
        ).all()

        for material in materials_to_delete:
            # AI가 생성한 산출물 파일들을 삭제
            if material.output_artifacts:
                # 1. transcript 파일 삭제
                if "speaker_attributed_text_path" in material.output_artifacts:
                    transcript_path = Path(material.output_artifacts["speaker_attributed_text_path"])
                    # is_file()로 존재 확인 후 unlink()로 삭제 시도
                    if transcript_path.is_file():
                        transcript_path.unlink()
                        
                # 2. summary 파일 삭제
                if "individual_summary_path" in material.output_artifacts:
                    summary_path = Path(material.output_artifacts["individual_summary_path"])
                    # is_file()로 존재 확인 후 unlink()로 삭제 시도
                    if summary_path.is_file():
                        summary_path.unlink()

    except OSError as e:
        print(f"Error deleting associated AI files for workspace {workspace_id}: {e}")
        # 파일 삭제에 실패해도 DB 삭제는 계속 진행

    # 3. [DB 삭제] 워크스페이스 삭제 (하위 Subject, Job 등은 DB에서 자동 cascade 삭제)
    db.delete(workspace)
    db.commit()
    return Response(status_code=204)

# ---  Subject API 수정 (is_korean_only 저장)  ---
@app.post("/subjects", response_model=schemas.Subject, status_code=201)
def create_subject(subject: schemas.SubjectCreate, db: Session = Depends(get_db)):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == subject.workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=400, detail=f"Invalid workspace_id: {subject.workspace_id}. Workspace not found.")
        
    existing_subject = db.query(models.Subject).filter(models.Subject.name == subject.name).first()
    if existing_subject:
        raise HTTPException(status_code=409, detail=f"Subject with name '{subject.name}' already exists.")

    #  subject.model_dump()가 is_korean_only 값을 포함하여 전달
    db_subject = models.Subject(**subject.model_dump()) 
    db.add(db_subject)
    db.commit()
    db.refresh(db_subject)
    return db_subject

@app.get("/subjects", response_model=List[schemas.SubjectDetail])
def read_subjects(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.Subject)
    if workspace_id:
        query = query.filter(models.Subject.workspace_id == workspace_id)
    return query.all()

@app.delete("/subjects/{subject_id}", status_code=204)
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail=f"Subject with id {subject_id} not found.")

    # Subject를 삭제하기 전, 하위 AI 산출물 파일을 먼저 삭제
    try:
        # 이 Subject에 속한 모든 Job을 조회
        jobs_to_delete = db.query(models.SummaryJob).filter(models.SummaryJob.subject_id == subject_id).all()
        
        for job in jobs_to_delete:
            for material in job.source_materials:
                if material.output_artifacts:
                    if "speaker_attributed_text_path" in material.output_artifacts:
                        transcript_path = Path(material.output_artifacts["speaker_attributed_text_path"])
                        if transcript_path.is_file():
                            transcript_path.unlink()
                            
                    if "individual_summary_path" in material.output_artifacts:
                        summary_path = Path(material.output_artifacts["individual_summary_path"])
                        if summary_path.is_file():
                            summary_path.unlink()

    except OSError as e:
        print(f"Error deleting associated AI files for subject {subject_id}: {e}")
        # 파일 삭제에 실패해도 DB 삭제는 계속 진행
        
    db.delete(subject)
    db.commit()
    return Response(status_code=204)

# ---  Summary Job API (녹음 파일 저장)  ---
@app.post("/summary-jobs", response_model=schemas.SummaryJobDetail, status_code=201)
async def create_summary_job_with_files(
    background_tasks: BackgroundTasks,
    title: str = Form(...), 
    subject_id: Optional[int] = Form(None),
    #  is_korean_only 파라미터 여기서 삭제 
    # is_korean_only: bool = Form(False), 
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    # --- 입력 검증 로직 ---
    if not files:
        raise HTTPException(status_code=400, detail="At least one file must be uploaded.")
        
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_FILES} files can be uploaded at once.")

    for file in files:
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in ALLOWED_EXTENSIONS:
            allowed_ext_str = ", ".join(ALLOWED_EXTENSIONS)
            raise HTTPException(status_code=415, detail=f"File format not allowed for '{file.filename}'. Allowed formats: {allowed_ext_str}")

        if file.size is None:
             raise HTTPException(status_code=411, detail=f"File size could not be determined for '{file.filename}'.")
        elif file.size > MAX_FILE_SIZE_BYTES:
             raise HTTPException(status_code=413, detail=f"File '{file.filename}' exceeds the size limit of 10GB.")
    
    if subject_id is not None:
        subject = db.query(models.Subject).filter(models.Subject.id == subject_id).first()
        if not subject:
            raise HTTPException(status_code=400, detail=f"Invalid subject_id: {subject_id}. Subject not found.")
    
    # --- 검증 통과 후 로직 ---
    #  is_korean_only 값 없이 SummaryJob 생성
    summary_job = models.SummaryJob(title=title, subject_id=subject_id) 
    db.add(summary_job)
    db.commit()
    db.refresh(summary_job)

    # ... (SourceMaterial 생성 로직 ) ...
    try:
        for file in files:
            
            source_type = file.content_type or "unknown"
            
            source_material = models.SourceMaterial(
                job_id=summary_job.id,
                source_type=source_type,
                original_filename=file.filename,
                storage_path=file.filename,
                file_size_bytes=file.size
            )
            db.add(source_material)
        
        db.commit() # 모든 SourceMaterial을 한 번에 저장
    
    except Exception as e:
        db.rollback() 
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded files: {e}")
    
    finally:
        for file in files:
            await file.close() #  모든 파일 핸들 닫기

    db.refresh(summary_job) #  source_materials 관계를 새로고침

    background_tasks.add_task(run_ai_processing, summary_job.id)
    return summary_job

# --- (나머지 GET, DELETE API는 변경 없음) ---
@app.get("/summary-jobs", response_model=List[schemas.SummaryJobDetail])
def read_summary_jobs(subject_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(models.SummaryJob).order_by(models.SummaryJob.created_at.desc())
    if subject_id:
        query = query.filter(models.SummaryJob.subject_id == subject_id)
    return query.all()

@app.get("/summary-jobs/{job_id}", response_model=schemas.SummaryJobDetail)
def read_summary_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job with id {job_id} not found.")
    return job

@app.get("/source-materials/{material_id}/download", response_class=Response)
def download_individual_summary(material_id: int, db: Session = Depends(get_db)):
    """
    개별 파일(SourceMaterial)의 요약본(individual_summary)을 다운로드합니다.
    """
    material = db.query(models.SourceMaterial).filter(models.SourceMaterial.id == material_id).first()
    
    if not material:
        raise HTTPException(status_code=404, detail=f"Source material with id {material_id} not found.")
    
    if material.status != models.MaterialStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Transcription and summarization for this material are not completed yet.")
        
    if not material.individual_summary:
        raise HTTPException(status_code=404, detail="Individual summary content not found for this material.")
        
    # 파일 이름에 원본 파일명을 활용
    filename = Path(material.original_filename).stem # 원본 파일명에서 확장자 제거
    
    return Response(
        content=material.individual_summary, 
        media_type="text/markdown", 
        headers={
            "Content-Disposition": f"attachment; filename={filename}_summary.md"
        }
    )

@app.delete("/summary-jobs/{job_id}", status_code=200)
def delete_summary_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job with id {job_id} not found.")

    # --- [수정] AI 산출물 파일 삭제 로직 ---
    try:
        for material in job.source_materials:
            # AI가 생성한 산출물 파일들을 삭제
            if material.output_artifacts:
                if "speaker_attributed_text_path" in material.output_artifacts:
                    transcript_path = Path(material.output_artifacts["speaker_attributed_text_path"])
                    if transcript_path.is_file():
                        transcript_path.unlink()
                        
                # [추가] 2. AI가 생성한 ..._summary.txt 삭제
                if "individual_summary_path" in material.output_artifacts:
                    summary_path = Path(material.output_artifacts["individual_summary_path"])
                    if summary_path.is_file():
                        summary_path.unlink()

            # [참고] 원본 오디오 파일 (apps/projects/...)은 삭제하지 않습니다.
            # 프론트엔드/AI가 관리하는 파일로 간주합니다.

    except OSError as e:
        print(f"Error deleting associated AI files for job {job_id}: {e}")
        # 파일 삭제에 실패해도 DB 삭제는 계속 진행합니다.
            
    db.delete(job)
    db.commit()
    return JSONResponse(content={"message": f"Job {job_id} and associated files deleted successfully."})
