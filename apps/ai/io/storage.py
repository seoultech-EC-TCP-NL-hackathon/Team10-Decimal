"""
Persist pipeline run artifacts to the filesystem.

This module defines simple routines for writing the intermediate and
final results of a pipeline run into structured directories under
``apps/projects/<run_id>``. Stages write their outputs into
``context.data``; here we serialise those outputs into JSON files,
copy the processed audio chunks and write the final summary to a
text file.
"""

from __future__ import annotations

import json
import shutil
from typing import Any, Dict, List

from ..types import AudioChunk, SpeakerTurn, TranscriptSegment, CategoryResult, SummaryResult
from ..pipeline.base import StageContext


def _serialise_audio_chunks(chunks: List[AudioChunk]) -> List[Dict[str, Any]]:
    """Convert a list of AudioChunk instances into serialisable dicts."""
    result = []
    for c in chunks:
        result.append({
            "id": c.id,
            "file_path": str(c.file_path.name),  # store only filename
            "start": c.start,
            "end": c.end,
            "speaker": c.speaker,
            "transcript": c.transcript,
        })
    return result


def persist_run(context: StageContext) -> None:
    """Persist intermediate results and artifacts of a pipeline run.

    Parameters
    ----------
    context : StageContext
        Context containing the run id, base directory and accumulated
        data. This function expects the following keys in
        ``context.data`` (all optional):

        - ``chunks``: list of :class:`AudioChunk`
        - ``diarization``: list of serialisable diarisation results
        - ``stt``: list of serialisable transcript segments
        - ``categories``: serialisable categorisation results
        - ``summary``: string summarising the run

    Side Effects
    ------------
    Creates directories and writes files into ``context.base_dir``.
    """
    run_dir = context.base_dir
    run_dir.mkdir(parents=True, exist_ok=True)
    # Save chunks (copy audio files and write manifest)
    chunks = context.data.get("chunks")
    if chunks:
        chunks_dir = run_dir / "chunks"
        chunks_dir.mkdir(exist_ok=True)
        # Copy audio files and build manifest
        manifest: List[Dict[str, Any]] = []
        for chunk in chunks:
            if not isinstance(chunk, AudioChunk):
                continue
            dest = chunks_dir / chunk.file_path.name
            try:
                if chunk.file_path.exists():
                    shutil.copy(chunk.file_path, dest)
            except Exception:
                # ignore copy failures
                pass
            manifest.append({
                "id": chunk.id,
                "file": dest.name,
                "start": chunk.start,
                "end": chunk.end,
            })
        (run_dir / "chunks_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Save diarisation output
    diar = context.data.get("diarization")
    if diar is not None:
        (run_dir / "diarization.json").write_text(json.dumps(diar, indent=2), encoding="utf-8")

    # Save STT segments
    stt = context.data.get("stt")
    if stt is not None:
        (run_dir / "stt.json").write_text(json.dumps(stt, indent=2), encoding="utf-8")

    # Save categorisation
    categories = context.data.get("categories")
    if categories is not None:
        (run_dir / "categories.json").write_text(json.dumps(categories, indent=2), encoding="utf-8")

    # Save speaker-attributed transcript
    speaker_text = context.data.get("speaker_attributed_text")
    if speaker_text is not None:
        (run_dir / "speaker-attributed.txt").write_text(str(speaker_text), encoding="utf-8")

    # Save summary
    summary = context.data.get("summary")
    if summary is not None:
        (run_dir / "summary.txt").write_text(str(summary), encoding="utf-8")
