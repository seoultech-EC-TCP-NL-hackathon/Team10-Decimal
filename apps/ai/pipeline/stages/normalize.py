"""
Audio normalisation and segmentation stage.

This stage performs basic preprocessing on the input audio file. It
converts the audio to a mono, 16 kHz PCM WAV file using ``ffmpeg``
and optionally splits long recordings into smaller chunks. The
resulting chunks are recorded in the context's data under the
``"chunks"`` key.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import List

from ..base import BaseStage, StageContext, StageResult
from ...types import AudioChunk


class NormalizeStage(BaseStage):
    """Convert input audio to mono 16 kHz and create audio chunks."""

    name = "normalize"

    # maximum segment length in seconds (30 minutes)
    SEGMENT_LENGTH = 30 * 60  # 1800 seconds

    def _run_ffmpeg(self, cmd: List[str]) -> None:
        """Helper to run an ffmpeg command and raise on failure."""
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg command failed: {' '.join(cmd)}\n{proc.stderr}")

    def _get_duration(self, file_path: Path) -> float:
        """Return duration of audio file in seconds using ffprobe."""
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ]
        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            return float(result.stdout.strip())
        except Exception:
            return 0.0

    def run(self, context: StageContext) -> StageResult:
        input_file = context.input_file
        run_dir = context.base_dir / self.name
        run_dir.mkdir(parents=True, exist_ok=True)
        normalized_path = run_dir / "normalized.wav"
        print(f"[NormalizeStage] Normalising '{input_file.name}' to {normalized_path}.")
        # Convert to mono 16 kHz PCM WAV when ffmpeg is available.
        import shutil
        from shutil import which

        ffmpeg_path = which("ffmpeg")
        if ffmpeg_path:
            try:
                ffmpeg_cmd = [
                    ffmpeg_path,
                    "-y",  # overwrite
                    "-i", str(input_file),
                    "-ac", "1",
                    "-ar", "16000",
                    "-c:a", "pcm_s16le",
                    str(normalized_path),
                ]
                self._run_ffmpeg(ffmpeg_cmd)
            except Exception as e:
                print(f"[NormalizeStage] ffmpeg conversion failed: {e}")
                return StageResult(name=self.name, success=False, message=str(e))
            duration = self._get_duration(normalized_path)
            print(f"[NormalizeStage] Normalised audio duration: {duration:.2f}s.")
        else:
            # ffmpeg not available; simply copy the input as is
            try:
                shutil.copy(input_file, normalized_path)
            except Exception as e:
                return StageResult(name=self.name, success=False, message=f"Failed to copy input file: {e}")
            # Without ffmpeg we cannot determine the duration reliably; set to 0.0
            duration = 0.0
            print("[NormalizeStage] ffmpeg not found; copied input without resampling.")
        # Decide if segmentation is needed
        chunks: List[AudioChunk] = []
        if duration > self.SEGMENT_LENGTH:
            # Use ffmpeg segmenter to split evenly sized parts
            segments_dir = run_dir / "segments"
            segments_dir.mkdir(exist_ok=True)
            segment_pattern = segments_dir / "chunk_%03d.wav"
            seg_cmd = [
                "ffmpeg",
                "-y",
                "-i", str(normalized_path),
                "-f", "segment",
                "-segment_time", str(self.SEGMENT_LENGTH),
                "-c", "copy",
                str(segment_pattern),
            ]
            try:
                self._run_ffmpeg(seg_cmd)
                # enumerate created files
                for i, seg in enumerate(sorted(segments_dir.glob("chunk_*.wav"))):
                    # start/end relative to entire recording
                    start = i * self.SEGMENT_LENGTH
                    end = min((i + 1) * self.SEGMENT_LENGTH, duration)
                    chunks.append(AudioChunk(id=f"chunk{i}", file_path=seg, start=start, end=end))
            except Exception as e:
                # if segmentation fails fall back to single chunk
                chunks = []
                print(f"[NormalizeStage] Segmentation failed: {e}. Using single chunk.")
        if not chunks:
            # single chunk covering entire file
            chunks = [AudioChunk(id="chunk0", file_path=normalized_path, start=0.0, end=duration)]
            print(f"[NormalizeStage] Produced single chunk covering {duration:.2f}s.")
        else:
            print(f"[NormalizeStage] Produced {len(chunks)} chunk(s).")
        # Record chunks in context
        context.data["chunks"] = chunks
        # Record path of the normalised file for later use
        context.data["normalized_path"] = normalized_path
        return StageResult(name=self.name, success=True, data=[c.__dict__ for c in chunks])
