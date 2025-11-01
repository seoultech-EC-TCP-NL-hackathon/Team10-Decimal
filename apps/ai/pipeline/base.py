"""
Abstract base classes for pipeline stages.

Stages are small units of computation that perform a single well
defined task (e.g. normalisation, diarisation, transcription). Each
stage receives a :class:`StageContext` which holds run specific
information and a mutable data dictionary. Stages should read their
inputs from ``context.data`` and write their outputs back into it
under agreed keys. This design keeps the stages loosely coupled and
makes it easy to insert or remove stages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

from ..config import Config
from ..resources import Resources


@dataclass
class StageResult:
    """Represents the outcome of a stage.

    A stage should set ``success`` to ``True`` when it completes
    without fatal errors. The ``data`` attribute carries the primary
    output of the stage and may be of any type. In case of partial
    failures a stage may record diagnostic information inside
    ``message`` and still signal success.
    """
    name: str
    success: bool
    data: Any = None
    message: Optional[str] = None


@dataclass
class StageContext:
    """Holds contextual information passed to each stage.

    Attributes
    ----------
    run_id : str
        Identifier for the current pipeline run.
    config : Config
        Loaded configuration.
    resources : Resources
        Lazy loaded resources (models) used across stages.
    base_dir : Path
        Directory where run specific files can be stored. Each stage
        may create its own subdirectory under this path.
    input_file : Path
        Path to the original input file for the run.
    data : Dict[str, Any]
        Mutable mapping storing intermediate results. Keys are agreed
        by convention between stages.
    """
    run_id: str
    config: Config
    resources: Resources
    base_dir: Path
    input_file: Path
    data: Dict[str, Any] = field(default_factory=dict)


class BaseStage:
    """Base class for all pipeline stages.

    Subclasses should implement the :meth:`run` method. They may
    access or modify the ``context.data`` dictionary to pass
    information between stages. If a stage fails it should return a
    :class:`StageResult` with ``success=False`` and set an
    appropriate message.
    """

    name: str = "base"

    def run(self, context: StageContext) -> StageResult:
        raise NotImplementedError
