"""
Merge diarisation and transcription outputs.

This stage aligns the diarisation turns with the STT segments so that
each utterance is tagged with the most likely speaker. It also updates
the stored AudioChunk metadata with aggregated transcripts and dominant
speakers to simplify later processing.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Sequence

from ..base import BaseStage, StageContext, StageResult
from ...types import AudioChunk


class MergeStage(BaseStage):
    name = "merge"

    def run(self, context: StageContext) -> StageResult:
        transcripts: List[Dict[str, Any]] = list(context.data.get("stt") or [])
        diarisation: List[Dict[str, Any]] = list(context.data.get("diarization") or [])
        chunks: Iterable[AudioChunk] = context.data.get("chunks") or []

        print(f"    [MergeStage] Merging {len(transcripts)} transcript segment(s) with {len(diarisation)} diarisation turn(s).")

        if not transcripts:
            context.data["merged_transcript"] = []
            message = "No transcripts available to merge."
            print("    [MergeStage] No transcripts to merge; skipping speaker alignment.")
            return StageResult(name=self.name, success=True, data={"segments": [], "speakers": {}}, message=message)

        segments: List[Dict[str, Any]] = []
        for seg in transcripts:
            start = self._to_float(seg.get("start", 0.0))
            end = self._to_float(seg.get("end", start))
            text = seg.get("text", "") or ""
            language = seg.get("language")
            aligned = self._align_segment(start, end, text, language, diarisation)
            segments.extend(aligned)

        segments = self._post_process_segments(segments)

        context.data["merged_transcript"] = segments
        self._store_speaker_transcript(context, segments)
        self._update_chunks(chunks, segments)

        speaker_index = self._speaker_index(segments)
        context.data["speaker_index"] = speaker_index
        print(f"    [MergeStage] Produced {len(segments)} merged segment(s) across {len(speaker_index)} speaker(s).")
        message = None if diarisation else "Diarisation unavailable; speaker labels default to 'UNKNOWN'."

        return StageResult(
            name=self.name,
            success=True,
            data={"segments": segments, "speakers": speaker_index},
            message=message,
        )

    def _align_segment(
        self,
        start: float,
        end: float,
        text: str,
        language: str | None,
        diarisation: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        base_speaker = self._assign_speaker(start, end, diarisation)
        base_segment = [{
            "start": start,
            "end": end,
            "text": text,
            "language": language,
            "speaker": base_speaker,
        }]

        if not text or not diarisation:
            return base_segment

        overlaps = self._overlapping_turns(start, end, diarisation)
        if not overlaps:
            return base_segment

        if len(overlaps) == 1:
            segment = base_segment[0]
            segment["start"], segment["end"], segment["speaker"] = overlaps[0]
            segment["text"] = text
            return [segment]

        pieces = self._split_text_by_overlap(text, overlaps)
        segments: List[Dict[str, Any]] = []
        for (seg_start, seg_end, speaker), piece in zip(overlaps, pieces):
            clean_text = piece.strip()
            if not clean_text:
                continue
            segments.append({
                "start": seg_start,
                "end": seg_end,
                "text": clean_text,
                "language": language,
                "speaker": speaker,
            })

        return segments or base_segment

    def _assign_speaker(self, start: float, end: float, diarisation: Sequence[Dict[str, Any]]) -> str:
        best_speaker = "UNKNOWN"
        best_overlap = 0.0
        closest_speaker = "UNKNOWN"
        closest_gap = float("inf")

        for turn in diarisation:
            turn_start = self._to_float(turn.get("start", 0.0))
            turn_end = self._to_float(turn.get("end", turn_start))
            if turn_end <= turn_start:
                continue

            overlap = min(end, turn_end) - max(start, turn_start)
            if overlap > best_overlap and overlap > 0.0:
                best_overlap = overlap
                speaker = turn.get("speaker")
                best_speaker = str(speaker) if speaker is not None else "UNKNOWN"

            gap = self._temporal_gap(start, end, turn_start, turn_end)
            if gap < closest_gap:
                closest_gap = gap
                speaker = turn.get("speaker")
                closest_speaker = str(speaker) if speaker is not None else "UNKNOWN"

        return best_speaker if best_overlap > 0.0 else closest_speaker

    def _overlapping_turns(
        self,
        start: float,
        end: float,
        diarisation: Sequence[Dict[str, Any]],
    ) -> List[tuple[float, float, str]]:
        overlaps: List[tuple[float, float, str]] = []
        for turn in diarisation:
            turn_start = self._to_float(turn.get("start", 0.0))
            turn_end = self._to_float(turn.get("end", turn_start))
            if turn_end <= turn_start:
                continue

            overlap_start = max(start, turn_start)
            overlap_end = min(end, turn_end)
            if overlap_end <= overlap_start:
                continue

            speaker = turn.get("speaker")
            overlaps.append((overlap_start, overlap_end, str(speaker) if speaker is not None else "UNKNOWN"))
        overlaps.sort(key=lambda item: item[0])
        return overlaps

    def _split_text_by_overlap(
        self,
        text: str,
        overlaps: Sequence[tuple[float, float, str]],
    ) -> List[str]:
        tokens = re.findall(r"\S+\s*", text)
        if not tokens:
            return [text] + [""] * (len(overlaps) - 1)

        total_duration = sum(max(0.0, overlap_end - overlap_start) for overlap_start, overlap_end, _ in overlaps)
        if total_duration <= 0.0:
            return [text] + [""] * (len(overlaps) - 1)

        boundaries = [0]
        accumulated = 0.0
        token_count = len(tokens)
        for idx, (overlap_start, overlap_end, _) in enumerate(overlaps):
            accumulated += max(0.0, overlap_end - overlap_start)
            if idx == len(overlaps) - 1:
                boundaries.append(token_count)
            else:
                ratio = accumulated / total_duration
                boundary = int(round(ratio * token_count))
                boundary = max(boundaries[-1], min(token_count, boundary))
                boundaries.append(boundary)

        pieces: List[str] = []
        for left, right in zip(boundaries, boundaries[1:]):
            left_index = max(0, min(token_count, left))
            right_index = max(left_index, min(token_count, right))
            pieces.append("".join(tokens[left_index:right_index]))
        while len(pieces) < len(overlaps):
            pieces.append("")
        return pieces

    def _post_process_segments(self, segments: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not segments:
            return []

        ordered = sorted(
            (seg.copy() for seg in segments),
            key=lambda seg: (self._to_float(seg.get("start", 0.0)), self._to_float(seg.get("end", 0.0))),
        )

        merged: List[Dict[str, Any]] = []
        tolerance = 0.05  # seconds
        for seg in ordered:
            if not merged:
                merged.append(seg)
                continue

            last = merged[-1]
            same_speaker = seg.get("speaker") == last.get("speaker") and seg.get("speaker") is not None
            gap = self._to_float(seg.get("start", 0.0)) - self._to_float(last.get("end", 0.0))
            if same_speaker and gap <= tolerance:
                last_end = self._to_float(last.get("end", 0.0))
                seg_end = self._to_float(seg.get("end", 0.0))
                last["end"] = max(last_end, seg_end)
                last["text"] = self._combine_text(last.get("text"), seg.get("text"))
                if not last.get("language") and seg.get("language"):
                    last["language"] = seg.get("language")
                continue

            merged.append(seg)

        pruned = [
            seg for seg in merged
            if (self._to_float(seg.get("end", 0.0)) - self._to_float(seg.get("start", 0.0))) >= 1.0
        ]
        return pruned

    @staticmethod
    def _combine_text(left: Any, right: Any) -> str:
        left_text = (left or "").strip()
        right_text = (right or "").strip()
        if left_text and right_text:
            return f"{left_text} {right_text}".strip()
        return left_text or right_text

    def _store_speaker_transcript(self, context: StageContext, segments: Sequence[Dict[str, Any]]) -> None:
        """Persist speaker-attributed transcript to context and disk."""
        lines = self._segments_to_lines(segments)
        if not lines:
            context.data.pop("speaker_attributed_text", None)
            return
        text = "\n".join(lines)
        context.data["speaker_attributed_text"] = text
        try:
            context.base_dir.mkdir(parents=True, exist_ok=True)
            (context.base_dir / "speaker-attributed.txt").write_text(text, encoding="utf-8")
        except Exception as exc:
            print(f"    [MergeStage] Failed to write speaker-attributed.txt: {exc}")

    @staticmethod
    def _segments_to_lines(segments: Sequence[Dict[str, Any]]) -> List[str]:
        """Convert merged segments into `SPEAKER: text` lines."""
        lines: List[str] = []
        for segment in segments:
            text = (segment.get("text") or "").strip()
            if not text:
                continue
            speaker = segment.get("speaker") or "UNKNOWN"
            line = f"{speaker}: {text}"
            if lines and lines[-1] == line:
                continue
            lines.append(line)
        return lines

    def _update_chunks(self, chunks: Iterable[AudioChunk], segments: Sequence[Dict[str, Any]]) -> None:
        for chunk in chunks:
            matching = [
                seg for seg in segments
                if self._ranges_overlap(chunk.start, chunk.end, self._to_float(seg["start"]), self._to_float(seg["end"]))
            ]
            if matching:
                texts = [seg["text"] for seg in matching if seg["text"]]
                if texts:
                    chunk.transcript = " ".join(texts)
                speakers = [seg["speaker"] for seg in matching if seg["speaker"] and seg["speaker"] != "UNKNOWN"]
                if speakers:
                    chunk.speaker = Counter(speakers).most_common(1)[0][0]

    @staticmethod
    def _speaker_index(segments: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, float | int]]:
        index: Dict[str, Dict[str, float | int]] = {}
        for seg in segments:
            speaker = seg.get("speaker") or "UNKNOWN"
            entry = index.setdefault(speaker, {"utterance_count": 0, "total_duration": 0.0})
            entry["utterance_count"] += 1
            entry["total_duration"] += max(0.0, float(seg.get("end", 0.0)) - float(seg.get("start", 0.0)))
        return index

    @staticmethod
    def _ranges_overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> bool:
        return max(a_start, b_start) < min(a_end, b_end)

    @staticmethod
    def _temporal_gap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
        if max(a_start, b_start) < min(a_end, b_end):
            return 0.0
        if b_end <= a_start:
            return a_start - b_end
        if a_end <= b_start:
            return b_start - a_end
        return 0.0

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
