"""
Data schema definitions for audio related objects.

These dataclasses can be shared across multiple services (e.g. API
serialisation, storage) without importing the full AI pipeline.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class AudioChunk:
    """A thin representation of an audio chunk.

    This mirrors :class:`apps.ai.types.AudioChunk` so that API and
    storage layers can serialise audio metadata without depending on
    heavy pipeline internals.
    """
    id: str
    file_path: Path
    start: float
    end: float
    speaker: Optional[str] = None
    transcript: Optional[str] = None
