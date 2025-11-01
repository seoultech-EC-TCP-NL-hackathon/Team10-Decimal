"""
Speaker diarisation stage.

This stage identifies when different speakers are talking within each
audio chunk. It uses the ``pyannote.audio`` library when available.
If the library is not installed or the diarisation model cannot be
loaded, the stage assigns a single default speaker label to each
chunk. The diarisation results are stored in ``context.data`` under
the key ``"diarization"`` as a list of dictionaries with
``start``, ``end`` and ``speaker`` keys.
"""

from __future__ import annotations

from typing import List, Dict

import soundfile as sf
import torch

from ..base import BaseStage, StageContext, StageResult


class DiarizeStage(BaseStage):
    name = "diarize"

    def run(self, context: StageContext) -> StageResult:
        chunks = context.data.get("chunks") or []
        diarization: List[Dict[str, float | str]] = []
        pipeline = context.resources.diarization_pipeline
        print(f"    [DiarizeStage] Starting diarisation over {len(chunks)} chunk(s).")
        if pipeline is None:
            # Fallback: assign single speaker per chunk
            speaker_id = 0
            for chunk in chunks:
                diarization.append({
                    "start": chunk.start,
                    "end": chunk.end,
                    "speaker": f"SPEAKER_{speaker_id:02d}",
                })
                speaker_id += 1
            context.data["diarization"] = diarization
            print("    [DiarizeStage] No diarisation pipeline available. Generated placeholder speaker turns.")
            return StageResult(name=self.name, success=True, data=diarization)
        # Use real diarisation pipeline
        try:
            for chunk in chunks:
                print(f"    [DiarizeStage] Processing chunk {chunk.id} ({chunk.file_path.name}).")
                data, sr = sf.read(chunk.file_path, always_2d=True)
                waveform = torch.from_numpy(data.T).float().contiguous()
                diar_output = pipeline({"waveform": waveform, "sample_rate": sr, "uri": chunk.id})

                annotation = None
                if hasattr(diar_output, "exclusive_speaker_diarization"):
                    annotation = diar_output.exclusive_speaker_diarization
                    print(f"    [DiarizeStage] Using exclusive diarization for chunk {chunk.id}.")
                elif hasattr(diar_output, "speaker_diarization"):
                    annotation = diar_output.speaker_diarization
                elif hasattr(diar_output, "itertracks"):
                    annotation = diar_output

                if annotation is not None and hasattr(annotation, "itertracks"):
                    for turn, _, speaker in annotation.itertracks(yield_label=True):
                        diarization.append({
                            "start": chunk.start + float(turn.start),
                            "end": chunk.start + float(turn.end),
                            "speaker": str(speaker),
                        })
                    continue

                serialized: Dict[str, List[Dict[str, float | str]]] | None = None
                if hasattr(diar_output, "serialize"):
                    serialized = diar_output.serialize()
                elif isinstance(diar_output, dict):
                    serialized = diar_output  # type: ignore[assignment]

                if serialized is not None:
                    entries = serialized.get("exclusive_diarization") or serialized.get("diarization") or []
                    for entry in entries:
                        diarization.append({
                            "start": chunk.start + float(entry.get("start", 0.0)),
                            "end": chunk.start + float(entry.get("end", 0.0)),
                            "speaker": str(entry.get("speaker", "UNKNOWN")),
                        })
                    continue

                raise AttributeError(
                    f"Unsupported diarization output type: {type(diar_output).__name__}"
                )

            context.data["diarization"] = diarization
            print(f"    [DiarizeStage] Completed diarisation with {len(diarization)} speaker turns.")
            return StageResult(name=self.name, success=True, data=diarization)
        except Exception as e:
            # On failure, fallback to single label but continue the pipeline.
            fallback = []
            speaker_id = 0
            for chunk in chunks:
                fallback.append({
                    "start": chunk.start,
                    "end": chunk.end,
                    "speaker": f"SPEAKER_{speaker_id:02d}",
                })
                speaker_id += 1
            context.data["diarization"] = fallback
            print(f"    [DiarizeStage] Diarisation failed; fallback to default speakers. Error: {e}")
            return StageResult(
                name=self.name,
                success=True,
                data=fallback,
                message=f"Falling back to default speaker labels: {e}",
            )
