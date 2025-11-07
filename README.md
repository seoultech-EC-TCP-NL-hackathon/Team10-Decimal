# Decimal

<img height="256" width="256" alt="TeamLogo" src="https://github.com/user-attachments/assets/adfa14ec-a191-494a-8292-6e1ba4848295" />

Decimal is a local-first audio understanding stack. It ingests long lectures, meetings, or ad-hoc recordings, diarizes the speakers, transcribes them with Whisper, runs llama.cpp summaries, and exposes everything through a FastAPI backend plus a lightweight web client.

## Table of Contents
- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the Stack](#running-the-stack)
- [Web & API Entry Points](#web--api-entry-points)
- [AI Pipeline](#ai-pipeline)
- [Backend Data Model & Workflow](#backend-data-model--workflow)
- [Local Directories](#local-directories)
- [Useful Commands](#useful-commands)
- [Troubleshooting](#troubleshooting)

## Overview
- Upload up to 10 audio files (mp3, wav, flac, opus, webm, etc.) per summary job with per-file limits of 10 GB.
- Organize recordings through Workspaces -> Subjects -> Summary Jobs, and keep every run auditable via SQLAlchemy models.
- Execute a six-stage AI pipeline (normalize, diarize, STT, merge, categorize, refine) backed by Whisper, pyannote, and llama.cpp with CPU/GPU fallbacks.
- Serve the resulting transcripts, summaries, artifacts, and downloadable files over FastAPI endpoints and an embedded web UI mounted at `/web`.
- Automate environment checks (Python >=3.10), dependency hashes, `.env` creation, PostgreSQL role provisioning, and uvicorn startup through `run.py`.

## Tech Stack
- **Backend:** FastAPI, Pydantic v2, SQLAlchemy 2.x, Alembic-ready schema, background tasks.
- **Database:** PostgreSQL (psycopg2) with UTF-8 enforcement; SQLite (`apps/api/test.db`) can be used for quick local smoke tests.
- **AI:** openai-whisper, pyannote.audio, torch/torchaudio, llama.cpp GGUF models, custom pipeline stages under `apps/ai`.
- **Frontend:** Static HTML/CSS/ES6 modules in `apps/web`, consuming the REST API via `fetch`.
- **Tooling:** `run.py` launcher, Hugging Face model bootstrap (`apps/ai/bootstrap`), ffmpeg/ffprobe for audio prep, `docs/api/openapi.yaml` for schema documentation.

## Repository Layout
```text
.
|-- run.py                    # Cross-platform launcher for the FastAPI app
|-- requirements.txt
|-- apps
|   |-- api                   # FastAPI service, SQLAlchemy models, schemas, routes
|   |-- ai                    # Audio + LLM pipeline, bootstrapper, resources
|   |-- projects              # Reserved for exported project bundles
|   `-- web                   # Front-end assets served at /web
|-- docs
|   |-- api/openapi.yaml      # OpenAPI contract
|   `-- architecture          # Draw.io + PNG diagrams explaining the stack
|-- logs                      # Rotated uvicorn logs when using run.py --prod
|-- summary                   # User-curated summary exports
`-- tmp                       # PID files, requirement hashes, bootstrap markers
```

## Prerequisites
- Python 3.10 or later.
- PostgreSQL 14+ with a superuser (default `postgres`) reachable via `psql`.
- `ffmpeg`/`ffprobe` on `PATH` for audio normalization and segmentation.
- Git LFS (optional) if you plan to pull large pretrained models into the repo.
- Hugging Face access token with permission to download pyannote models; stored in `HUGGINGFACE_TOKEN`.
- (Optional) CUDA-capable GPU for faster Whisper/llama.cpp inference.

## Setup
1. **Create and activate a virtual environment**
   ```bash
   python -m venv .venv
   # Windows
   .\.venv\Scripts\activate
   # macOS/Linux
   source .venv/bin/activate
   ```

2. **Install dependencies**
   ```bash
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. **Configure environment variables (`.env` in the repo root)**  
   The launcher will auto-create this file on the first run, but you can edit it upfront. Key settings:

   | Key | Purpose |
   | --- | --- |
   | `ENV` | `development` or `production` toggle consumed by the app. |
   | `PORT` | FastAPI port. `run.py` will move to a free port if needed. |
   | `PGHOST`, `PGPORT` | PostgreSQL host/port. |
   | `PGUSER`, `PGPASSWORD` | Application database role. |
   | `PGDATABASE` | Target database name. |
   | `DB_URL` | Full SQLAlchemy URL `postgresql://USER:PASS@HOST:PORT/DB`. |
   | `POSTGRES_PASSWORD` | Superuser password so `run.py` can create roles/dbs. Leave empty if you manage it yourself. |
   | `HUGGINGFACE_TOKEN` | Required by pyannote + HF downloads in the AI bootstrap. |
   | `API_KEY` | Reserved for future authenticated endpoints / web client. |

   **Grant Hugging Face / pyannote access**
   1. Sign in to https://huggingface.co/ and request access to the `pyannote/speaker-diarization-3.1` model family (you will find an "Access request" button on the model card).
   2. Once approved, open **Settings > Access Tokens**, create a new token with the `read` scope, and copy it.
   3. Either run `huggingface-cli login --token <token>` (preferred if multiple repos share the cache) or paste the token into the `HUGGINGFACE_TOKEN` entry in `.env`.
   4. Re-run the bootstrap step (below) any time you rotate the token so the pyannote pipeline can refresh its credentials.

4. **Bootstrap the AI configuration and cache the models**  
   This inspects your hardware, chooses reasonable Whisper/pyannote/llama.cpp targets, downloads weights, and writes `apps/ai/ai.config.json`.
   ```bash
   python -m apps.ai.bootstrap.manager
   ```

5. **Prepare PostgreSQL (only needed once)**  
   With `POSTGRES_PASSWORD` populated, `python run.py` will create the `PGUSER` role, grant privileges, and create `PGDATABASE`.  
   To do it manually:
   ```bash
   psql -h 127.0.0.1 -U postgres -c "CREATE USER app_user WITH PASSWORD 'app_password';"
   psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE app_db OWNER app_user;"
   ```

## Running the Stack
### `run.py` helper (recommended)
```bash
python run.py            # development mode (foreground, streaming uvicorn logs)
python run.py --prod     # background mode, logs under logs/<app>_YYYYMMDD-HHMMSS.log
```
`run.py` handles:
- Python version verification.
- `requirements.txt` hash + auto-install when the file changes.
- `.env` creation and automatic PORT reassignment to avoid conflicts.
- PostgreSQL connectivity probes and optional role/database bootstrap.
- PID management to prevent double-launches.

Customize it with `--app-module apps.api.main:app`, `--default-port 9000`, `--keep-logs 10`, etc.

### Manual uvicorn (optional)
```bash
uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
```
Use this when iterating purely on the API and you do not need the safeguards bundled in `run.py`.

## Web & API Entry Points
- **Web client:** http://localhost:8000/web  
  Upload recordings, monitor summary jobs, browse local folders, and read generated summaries.
- **Interactive docs:** http://localhost:8000/docs (FastAPI Swagger UI) or read [`docs/api/openapi.yaml`](docs/api/openapi.yaml).
- **Health check:** http://localhost:8000/ (returns `{"message": "Hello Decimal"}` once you expose such a route, or use the docs endpoint.)

## AI Pipeline
All logic lives under `apps/ai` and can be executed independently via `python -m apps.ai.main <audio-file>`.

1. **NormalizeStage** - Converts input audio to mono 16 kHz WAV with ffmpeg, splits long sessions into <=30 min chunks.
2. **DiarizeStage** - Runs pyannote speaker diarization when models are available; otherwise produces deterministic placeholders so the rest of the pipeline still succeeds.
3. **STTStage** - Uses Whisper (auto GPU/CPU + fp16 fallback) to create time-aligned transcripts per chunk.
4. **MergeStage** - Aligns diarization turns with STT segments, builds speaker-attributed transcripts, and indexes dominant speakers.
5. **CategorizeLLMStage** - Classifies the document type (conversation / lecture / meeting) using llama.cpp GGUF models or heuristics if the model is absent.
6. **RefineLLMStage** - Generates formatted Markdown summaries using prompt templates tuned per document type; falls back to deterministic transcript merges when llama.cpp is unavailable.

Artifacts (chunks, diarization JSON, stt.json, speaker-attributed text, summary.txt) are written under `apps/ai/output/<job_id>` by `apps/ai/io/storage.py`.

## Backend Data Model & Workflow
- **Workspace** -> root folder grouping Subjects.
- **Subject** -> a logical course/meeting thread; stores `is_korean_only` so the pipeline can pick different prompts/models.
- **SummaryJob** -> one run initiated by the user; tracks status (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`) and its `SourceMaterial`s.
- **SourceMaterial** -> each uploaded file, its storage path under `apps/api/uploads`, and AI output pointers (`output_artifacts`).
- **SpeakerAttributedSegment** -> diarized sentences persisted for later review.
- **JobStageLog** -> fine-grained pipeline telemetry ready for UIs or audits.

Typical flow:
1. User creates a Workspace and optional Subjects from the sidebar in the web app.
2. POST `/summary-jobs` with files + optional `subject_id`.
3. FastAPI immediately stores uploads in `apps/api/uploads`, creates DB rows, and schedules `run_ai_processing` as a background task.
4. The background worker calls `run_ai_pipeline`, waits for files in `apps/ai/output/<job_id>` and backfills transcripts + summaries into the database.
5. UI polls `/summary-jobs/{id}` until the job is `COMPLETED`, then enables downloads (summary markdown, transcripts, artifacts directories).

Refer to [`docs/api/openapi.yaml`](docs/api/openapi.yaml) for full request/response schemas.

## Local Directories
- `apps/api/uploads/` - raw user uploads, named with UUIDs per job.
- `apps/ai/output/` - AI artifacts grouped by sanitized `job_id` (summary.txt, speaker-attributed.txt, diarization.json, chunk audio, etc.).
- `apps/projects/` - placeholder for exported bundles or future collaboration features.
- `logs/` - uvicorn/stdout logs when running in `--prod`.
- `tmp/` - PID files, requirement hashes, PostgreSQL permission markers.
- `summary/` - manually curated summaries that the team wants to version-control.

## Useful Commands
| Purpose | Command |
| --- | --- |
| Bootstrap AI config/models | `python -m apps.ai.bootstrap.manager` |
| Run the FastAPI stack | `python run.py` |
| Background server with logging | `python run.py --prod --keep-logs 10` |
| Direct pipeline dry-run | `python -m apps.ai.main path/to/audio.wav` |
| Open API docs locally | `uvicorn apps.api.main:app --reload` then visit `/docs` |
| Inspect queued jobs | `sqlite3 apps/api/test.db` (for local-only smoke tests) or connect to PostgreSQL with `psql` |

## Troubleshooting
- **`ffmpeg` not found:** install it (`brew install ffmpeg`, `choco install ffmpeg`, or download from ffmpeg.org) and ensure it is on `PATH`.
- **Pyannote authorization errors:** set `HUGGINGFACE_TOKEN` to a token that can access `pyannote/speaker-diarization-3.1`. Restart the app so the pipeline reloads.
- **GPU OOM in Whisper/llama.cpp:** the pipeline automatically retries on CPU, but you can lower model sizes in `apps/ai/ai.config.json` and rerun the bootstrapper.
- **PostgreSQL permission denied:** either provide `POSTGRES_PASSWORD` so `run.py` can grant privileges, or manually run the `GRANT/ALTER ROLE` statements.
- **Stale artifacts after deleting jobs:** use the `/summary-jobs/{id}` DELETE endpoint which also cleans `apps/ai/output` and uploaded files; manual deletes may orphan files.

For deeper architectural context, check the diagrams under `docs/architecture/*.png`.
