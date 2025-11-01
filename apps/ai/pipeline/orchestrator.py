"""
Pipeline orchestrator.

This module coordinates the execution of a sequence of stages. It
creates the run directory, initialises the context and iterates over
each stage, collecting and storing results as appropriate. At the
end of the run it calls into the storage layer to persist the
accumulated results.

Example
-------
>>> from .stages.normalize import NormalizeStage
>>> from .stages.diarize import DiarizeStage
>>> orchestrator = PipelineOrchestrator([NormalizeStage(), DiarizeStage()])
>>> ctx = StageContext(run_id='test', config=config, resources=resources,
...                    base_dir=Path('apps/projects/test'), input_file=Path('audio.wav'))
>>> orchestrator.run(ctx)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, List

from .base import BaseStage, StageContext, StageResult
from ..io import storage


class PipelineOrchestrator:
    """Execute a series of stages on a given context."""

    def __init__(self, stages: Iterable[BaseStage]):
        self.stages: List[BaseStage] = list(stages)

    def run(self, context: StageContext) -> List[StageResult]:
        """Run all stages sequentially and persist the results.

        Parameters
        ----------
        context : StageContext
            The context carrying configuration, resources and mutable
            data for the run.

        Returns
        -------
        list of StageResult
            The results returned by each stage in order. If a stage
            fails (``result.success`` is False) subsequent stages are
            skipped and execution stops.
        """
        results: List[StageResult] = []
        # Ensure run directory exists
        context.base_dir.mkdir(parents=True, exist_ok=True)
        # Iterate through the configured stages
        for stage in self.stages:
            print(f"[Pipeline] Starting stage '{stage.name}'.")
            result = stage.run(context)
            results.append(result)
            status = "success" if result.success else "failure"
            print(f"[Pipeline] Stage '{stage.name}' finished with {status}.")
            if result.message:
                print(f"[Pipeline] Stage '{stage.name}' message: {result.message}")
            # Record result in context for potential downstream use
            context.data[f"{stage.name}_result"] = result.data
            if not result.success:
                # Stop execution on error
                print(f"[Pipeline] Halting pipeline due to failure in stage '{stage.name}'.")
                break
        # Persist run artifacts
        storage.persist_run(context)
        print("[Pipeline] Run complete. Results persisted to storage.")
        return results
