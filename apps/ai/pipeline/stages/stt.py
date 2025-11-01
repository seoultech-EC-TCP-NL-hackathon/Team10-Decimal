"""
Speech‑to‑text transcription stage.

This stage transcribes the audio chunks produced by the normalisation
stage. When the openai Whisper package is available the model size
specified in the configuration is loaded via the resource manager
and used to produce time‑aligned transcriptions. Otherwise a
placeholder transcription is produced for each chunk.
"""

from __future__ import annotations

from typing import List, Dict

import torch
from ..base import BaseStage, StageContext, StageResult


class STTStage(BaseStage):
    name = "stt"

    def run(self, context: StageContext) -> StageResult:
        chunks = context.data.get("chunks") or []
        transcripts: List[Dict[str, float | str]] = []
        model = context.resources.whisper_model
        print(f"[STTStage] Starting transcription for {len(chunks)} chunk(s).")
        if model is None:
            # Placeholder transcripts
            print("[STTStage] Whisper model unavailable; returning placeholder transcripts.")
            for chunk in chunks:
                transcripts.append({
                    "start": chunk.start,
                    "end": chunk.end,
                    "text": "",
                    "language": None,
                })
            context.data["stt"] = transcripts
            return StageResult(name=self.name, success=False, data=transcripts, message="Whisper model unavailable")
        try:
            device = next(model.parameters()).device  # type: ignore[attr-defined]
        except (StopIteration, AttributeError):
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[STTStage] Whisper model running on device: {device}.")
        # Use whisper to transcribe each chunk
        try:
            for chunk in chunks:
                fp16 = device.type == "cuda"
                print(f"[STTStage] Transcribing chunk {chunk.id} on {device} (fp16={fp16}).")
                try:
                    result = model.transcribe(str(chunk.file_path), language=None, fp16=fp16)
                except RuntimeError as exc:
                    if device.type == "cuda":
                        print(f"[STTStage] CUDA transcription failed for chunk {chunk.id}: {exc}. Falling back to CPU.")
                        model.to("cpu")  # type: ignore[attr-defined]
                        device = torch.device("cpu")
                        result = model.transcribe(str(chunk.file_path), language=None, fp16=False)
                        print(f"[STTStage] Successfully transcribed chunk {chunk.id} on CPU fallback.")
                    else:
                        raise
                segs = result.get("segments") or []
                chunk_start = getattr(chunk, "start", 0.0)
                chunk_end = getattr(chunk, "end", chunk_start)
                has_bounds = chunk_end > chunk_start
                tolerance = 0.5  # seconds; allow minor drift from ffmpeg/Whisper timing
                for seg in segs:
                    raw_start = float(seg.get("start", 0.0))
                    raw_end = float(seg.get("end", raw_start))
                    if raw_end <= raw_start:
                        continue
                    start = chunk_start + raw_start
                    end = chunk_start + raw_end
                    if has_bounds:
                        if end < chunk_start - tolerance or start > chunk_end + tolerance:
                            print(
                                f"[STTStage] Skipping segment outside chunk '{chunk.id}' bounds: "
                                f"start={start:.2f}, end={end:.2f}, chunk_end={chunk_end:.2f}."
                            )
                            continue
                        start = max(start, chunk_start)
                        end = min(end, chunk_end)
                        if end - start <= 1e-3:
                            continue
                    text = seg.get("text", "").strip()
                    lang = result.get("language")
                    transcripts.append({
                        "start": start,
                        "end": end,
                        "text": text,
                        "language": lang,
                    })
            context.data["stt"] = transcripts
            print(f"[STTStage] Completed transcription with {len(transcripts)} segment(s).")
            return StageResult(name=self.name, success=True, data=transcripts)
        except Exception as e:
            # On failure produce empty transcripts
            print(f"[STTStage] Transcription failed: {e}")
            fallback = []
            for chunk in chunks:
                fallback.append({
                    "start": chunk.start,
                    "end": chunk.end,
                    "text": "",
                    "language": None,
                })
            context.data["stt"] = fallback
            return StageResult(name=self.name, success=False, data=fallback, message=str(e))
