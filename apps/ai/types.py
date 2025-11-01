"""
Shared dataclasses for the AI pipeline.

These dataclasses capture the common structures exchanged between
pipeline stages. They are intentionally simple and serialisable so
that intermediate results can be persisted to JSON if required.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Dict, Any


@dataclass
class AudioChunk:
    """A piece of audio to be processed.

    Parameters
    ----------
    id : str
        A unique identifier for this chunk within a run.
    file_path : Path
        Filesystem location of the audio file for this chunk.
    start : float
        Offset (in seconds) of this chunk relative to the start of
        the original recording.
    end : float
        End time (in seconds) of this chunk relative to the original
        recording.
    """

    id: str
    file_path: Path
    start: float
    end: float
    # Speaker label and transcript may be filled in by later stages
    speaker: Optional[str] = None
    transcript: Optional[str] = None


@dataclass
class SpeakerTurn:
    """Represents a diarised speaker segment.

    Attributes
    ----------
    start : float
        Start time of the segment (seconds from beginning of run).
    end : float
        End time of the segment (seconds from beginning of run).
    speaker : str
        Speaker identifier as returned by the diarisation model.
    """
    start: float
    end: float
    speaker: str


@dataclass
class TranscriptSegment:
    """Represents a chunk of transcribed text.

    Attributes
    ----------
    start : float
        Start time of the utterance (seconds from beginning of run).
    end : float
        End time of the utterance (seconds from beginning of run).
    text : str
        Recognised text for this segment.
    language : Optional[str]
        Detected language code, if available.
    """
    start: float
    end: float
    text: str
    language: Optional[str] = None


@dataclass
class CategoryResult:
    """Output of the categorisation LLM stage.

    Attributes
    ----------
    categories : Dict[str, Any]
        A mapping of category names to arbitrary metadata. The exact
        structure depends on the categoriser; for simple heuristics
        the values may be counts or booleans.
    """
    categories: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SummaryResult:
    """Output of the refinement LLM stage.

    Attributes
    ----------
    summary : str
        A textual summary of the entire run.
    """
    summary: str
