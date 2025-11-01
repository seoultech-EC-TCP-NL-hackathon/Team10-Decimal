# main.py (is_korean_only 로직 수정)
import os
import shutil
import time
from datetime import datetime, timezone
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Form,
    BackgroundTasks,
    Response,
)
from fastapi.responses import JSONResponse
from pathlib import Path
from sqlalchemy.orm import Session
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware

# 로컬 모듈 임포트
import models
import schemas
from database import SessionLocal, engine

# --- 설정 (Configurations) ---
models.Base.metadata.create_all(bind=engine)
UPLOAD_DIR = Path("./uploads")
ALLOWED_EXTENSIONS = {".mp3", ".aac", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".webm"}
MAX_FILES = 1
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024  # 10GB

app = FastAPI()

# --- CORS 설정 ---
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5500",  # Live Server 포트
    "http://localhost:5500",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        {
            "speaker_label": "Speaker 1",
            "start_time_seconds": 0.5,
            "end_time_seconds": 4.2,
            "text": "안녕하세요, 오늘 강의를 시작하겠습니다.",
        },
        {
            "speaker_label": "Speaker 2",
            "start_time_seconds": 5.1,
            "end_time_seconds": 9.8,
            "text": "네, 교수님. 지난 시간에 배운 내용에 대해 질문이 있습니다.",
        },
    ]

    save_dir = file_path.parent
    speaker_text_path = save_dir / "speaker_transcript.txt"
    with open(speaker_text_path, "w", encoding="utf-8") as f:
        f.write("[00:00:00.500] Speaker 1: 안녕하세요, 오늘 강의를 시작하겠습니다.\n")
        f.write(
            "[00:00:05.100] Speaker 2: 네, 교수님. 지난 시간에 배운 내용에 대해 질문이 있습니다.\n"
        )

    print(f"INFO: [AI] '{file_path.name}' 파일 처리 완료.")
    return {
        "transcription_segments": segments,
        "individual_summary": f"'{file_path.name}'에 대한 AI 개별 요약본입니다.",
        "output_artifacts": {"speaker_attributed_text_path": str(speaker_text_path)},
    }


# --- 백그라운드 작업 (is_korean_only 플래그 조회 로직 수정) ---
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
        is_korean_flag = False  # 기본값
        if job.subject_id:
            subject = (
                db.query(models.Subject)
                .filter(models.Subject.id == job.subject_id)
                .first()
            )
            if subject:
                is_korean_flag = subject.is_korean_only

        print(
            f"INFO: [AI] 작업 {job_id}의 한국어 특화 모델 사용 여부: {is_korean_flag}"
        )

        job.status = models.JobStatus.PROCESSING
        job.started_at = datetime.now(timezone.utc)
        db.commit()

        transcribe_log = models.JobStageLog(
            job_id=job_id,
            stage_name="transcribe",
            status=models.JobStatus.PROCESSING,
            start_time=datetime.now(timezone.utc),
        )
        db.add(transcribe_log)
        db.commit()

        for material in job.source_materials:
            material.status = models.MaterialStatus.TRANSCRIBING
            db.commit()

            # ---  2. call_ai_model로 플래그 값 전달  ---
            ai_results = call_ai_model(
                Path(material.storage_path),
                material.source_type,
                is_korean_flag,  # Subject에서 가져온 플래그
            )

            for seg_data in ai_results["transcription_segments"]:
                segment = models.SpeakerAttributedSegment(
                    material_id=material.id, **seg_data
                )
                db.add(segment)

            material.individual_summary = ai_results["individual_summary"]
            material.output_artifacts = ai_results["output_artifacts"]
            material.status = models.MaterialStatus.SUMMARIZING

        db.commit()

        transcribe_log.status = models.JobStatus.COMPLETED
        transcribe_log.end_time = datetime.now(timezone.utc)
        db.commit()

        summarize_log = models.JobStageLog(
            job_id=job_id,
            stage_name="summarize",
            status=models.JobStatus.PROCESSING,
            start_time=datetime.now(timezone.utc),
        )
        db.add(summarize_log)
        db.commit()

        all_summaries = [
            m.individual_summary for m in job.source_materials if m.individual_summary
        ]
        final_summary_content = "\n\n---\n\n".join(all_summaries)

        job.final_summary = f"# {job.title} 최종 요약\n\n{final_summary_content}"

        for material in job.source_materials:
            material.status = models.MaterialStatus.COMPLETED

        summarize_log.status = models.JobStatus.COMPLETED
        summarize_log.end_time = datetime.now(timezone.utc)

        job.status = models.JobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)
        db.commit()
        print(f"INFO: [백그라운드 작업 성공] Job ID: {job_id}")

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
    existing = (
        db.query(models.Workspace)
        .filter(models.Workspace.name == workspace.name)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Workspace with name '{workspace.name}' already exists.",
        )

    db_workspace = models.Workspace(**workspace.model_dump())
    db.add(db_workspace)
    db.commit()
    db.refresh(db_workspace)
    return db_workspace


@app.get("/workspaces", response_model=List[schemas.WorkspaceDetail])
def read_workspaces(db: Session = Depends(get_db)):
    return db.query(models.Workspace).all()


# ---  Subject API 수정 (is_korean_only 저장)  ---
@app.post("/subjects", response_model=schemas.Subject, status_code=201)
def create_subject(subject: schemas.SubjectCreate, db: Session = Depends(get_db)):
    workspace = (
        db.query(models.Workspace)
        .filter(models.Workspace.id == subject.workspace_id)
        .first()
    )
    if not workspace:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid workspace_id: {subject.workspace_id}. Workspace not found.",
        )

    existing_subject = (
        db.query(models.Subject).filter(models.Subject.name == subject.name).first()
    )
    if existing_subject:
        raise HTTPException(
            status_code=409,
            detail=f"Subject with name '{subject.name}' already exists.",
        )

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
        raise HTTPException(
            status_code=404, detail=f"Subject with id {subject_id} not found."
        )
    db.delete(subject)
    db.commit()
    return Response(status_code=204)


# ---  Summary Job API 수정 (녹음 파일 저장)  ---
@app.post("/summary-jobs", response_model=schemas.SummaryJobDetail, status_code=201)
async def create_summary_job_with_files(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    subject_id: Optional[int] = Form(None),
    korean_only: bool = Form(False),  # 한국어 특화 파라미터 활성화
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    # 🔍 받은 값 로그 출력
    print(f"\n{'='*60}")
    print(f"📥 [프론트엔드 요청 상세]")
    print(f"{'='*60}")
    print(f"  title: '{title}'")
    print(f"  subject_id: {subject_id}")
    print(f"  korean_only: {korean_only}")
    print(f"  files: {[f.filename for f in files]}")

    # title에서 workspace와 subject 분리 (title 형식: "workspace - subject")
    workspace_name = None
    subject_name = None
    if " - " in title:
        parts = title.split(" - ", 1)
        workspace_name = parts[0]
        subject_name = parts[1]
        print(f"  ✅ Workspace: '{workspace_name}'")
        print(f"  ✅ Subject: '{subject_name}'")
    else:
        print(f"  ⚠️ title이 'workspace - subject' 형식이 아님")
    print(f"{'='*60}\n")

    # --- 입력 검증 로직 ---
    if len(files) != MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"Exactly {MAX_FILES} file must be uploaded."
        )
    file = files[0]
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        allowed_ext_str = ", ".join(ALLOWED_EXTENSIONS)
        raise HTTPException(
            status_code=415,
            detail=f"File format not allowed. Allowed formats: {allowed_ext_str}",
        )

    if file.size is None:
        raise HTTPException(
            status_code=411, detail="File size could not be determined."
        )
    elif file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413, detail=f"File size exceeds the limit of 10GB."
        )

    if subject_id is not None:
        subject = (
            db.query(models.Subject).filter(models.Subject.id == subject_id).first()
        )
        if not subject:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid subject_id: {subject_id}. Subject not found.",
            )
    else:
        # subject_id가 없으면 title에서 파싱하여 자동 생성
        if workspace_name and subject_name:
            # Workspace 찾기 또는 생성
            workspace = (
                db.query(models.Workspace)
                .filter(models.Workspace.name == workspace_name)
                .first()
            )
            if not workspace:
                workspace = models.Workspace(name=workspace_name)
                db.add(workspace)
                db.commit()
                db.refresh(workspace)
                print(f"✅ Workspace 생성됨: '{workspace_name}' (ID: {workspace.id})")

            # Subject 찾기 또는 생성 (is_korean_only 값 포함)
            subject = (
                db.query(models.Subject)
                .filter(
                    models.Subject.name == subject_name,
                    models.Subject.workspace_id == workspace.id,
                )
                .first()
            )
            if not subject:
                subject = models.Subject(
                    name=subject_name,
                    workspace_id=workspace.id,
                    is_korean_only=korean_only,  # 한국어 특화 값 저장
                )
                db.add(subject)
                db.commit()
                db.refresh(subject)
                print(
                    f"✅ Subject 생성됨: '{subject_name}' (ID: {subject.id}, Korean Only: {korean_only})"
                )

            subject_id = subject.id

    # --- 검증 통과 후 로직 ---
    summary_job = models.SummaryJob(title=title, subject_id=subject_id)
    db.add(summary_job)
    db.commit()
    db.refresh(summary_job)

    # ... (파일 저장 및 SourceMaterial 생성 로직 동일) ...
    save_dir = UPLOAD_DIR / "source_materials" / str(summary_job.id)
    os.makedirs(save_dir, exist_ok=True)
    file_location = save_dir / file.filename
    try:
        with open(file_location, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Failed to save uploaded file: {e}"
        )
    finally:
        await file.close()

    source_material = models.SourceMaterial(
        job_id=summary_job.id,
        source_type=file.content_type or "unknown",
        original_filename=file.filename,
        storage_path=str(file_location),
        file_size_bytes=file.size,
    )
    db.add(source_material)
    db.commit()
    db.refresh(summary_job)

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


@app.get("/summary-jobs/{job_id}/download")
def download_summary(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()

    if not job:
        raise HTTPException(status_code=404, detail=f"Job with id {job_id} not found.")
    if job.status != models.JobStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Job {job_id} is not completed yet (status: {job.status}).",
        )

    if not job.final_summary:
        raise HTTPException(
            status_code=404, detail=f"Summary content for job {job_id} not found."
        )

    return Response(
        content=job.final_summary,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f"attachment; filename=summary_job_{job_id}.md"
        },
    )


@app.delete("/summary-jobs/{job_id}", status_code=200)
def delete_summary_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.SummaryJob).filter(models.SummaryJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job with id {job_id} not found.")

    job_dir = UPLOAD_DIR / "source_materials" / str(job_id)
    if os.path.isdir(job_dir):
        try:
            shutil.rmtree(job_dir)
        except OSError as e:
            print(f"Error deleting directory {job_dir}: {e}")

    db.delete(job)
    db.commit()
    return JSONResponse(
        content={"message": f"Job {job_id} and associated files deleted successfully."}
    )
