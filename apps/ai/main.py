"""
Entry point for the AI pipeline.

This script orchestrates the bootstrap (ensuring models are installed
and configuration is written), loads the configuration, prepares
resources, initialises the pipeline stages and executes them.

Usage
-----
Run this module as a script with the path to an input audio file:

.. code-block:: bash

   python -m project.apps.ai.ai_main /path/to/audio.wav

The results of the run will be saved under ``/apps/ai/output/<run_id>`` in
the project root and a summary will be printed to stdout.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

# Import here ensures the package is recognised when running as a module.
from .config import Config
from .resources import Resources
from .bootstrap.manager import ensure_models_ready
from .pipeline.base import StageContext
from .pipeline.orchestrator import PipelineOrchestrator
from .pipeline.stages import (
    NormalizeStage,
    DiarizeStage,
    STTStage,
    MergeStage,
    CategorizeLLMStage,
    RefineLLMStage,
)
from .io import storage


def ai_main(argv: list[str] | None = None) -> None:
    # 1) Project root & config path
    project_root = Path(__file__).resolve().parents[2]
    config_path = project_root / "apps" / "ai" / "ai.config.json"

    # 2) Bootstrap (hardware probe ??model select/install ??write ai.config.json)
    ensure_models_ready(models_dir=None, config_json=config_path)

    # 3) Load config
    config = Config.load()

    # 4) Parse CLI
    parser = argparse.ArgumentParser(description="Run the AI audio processing pipeline")
    parser.add_argument("input_file", type=str, help="Path to an input audio or video file")
    args = parser.parse_args(argv)
    input_path = Path(args.input_file)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # 5) Create resources & context
    resources = Resources(config)
    # Create run id and base directory
    run_id = time.strftime("%Y%m%d%H%M%S")
    base_dir = config.runs_dir / run_id
    # Prepare context
    context = StageContext(
        run_id=run_id,
        config=config,
        resources=resources,
        base_dir=base_dir,
        input_file=input_path,
    )

    # 6) Stages & run
    # Initialise stages
    stages = [
        NormalizeStage(),
        DiarizeStage(),
        STTStage(),
        MergeStage(),
        CategorizeLLMStage(),
        RefineLLMStage(),
    ]
    orchestrator = PipelineOrchestrator(stages)
    # Run pipeline
    results = orchestrator.run(context)
    
    # 7) Print summary or final message
    summary = context.data.get("summary")
    if summary:
        print("=== Final Summary ===")
        print(summary)
    else:
        print("Pipeline completed, but no summary was produced.")


# 외부 import 시 자동 실행 방지
if __name__ == "__main__":
    import sys
    ai_main(sys.argv[1:])

def run_ai_pipeline(file_path: str, job_id: str, is_korean_only: bool = False) -> None:
    input_path = Path(file_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    project_root = Path(__file__).resolve().parents[2]
    config_path = project_root / "apps" / "ai" / "ai.config.json"
    ensure_models_ready(models_dir=None, config_json=config_path)

    config = Config.load()
    resources = Resources(config)
    run_id = storage.normalise_run_identifier(job_id)
    base_dir = storage.resolve_run_directory(config.runs_dir, job_id)

    context = StageContext(
        run_id=run_id,
        config=config,
        resources=resources,
        base_dir=base_dir,
        input_file=input_path,
    )

    stages = [
        NormalizeStage(),
        DiarizeStage(),
        STTStage(),
        MergeStage(),
        CategorizeLLMStage(),
        RefineLLMStage(),
    ]
    orchestrator = PipelineOrchestrator(stages)
    results = orchestrator.run(context)

    summary = context.data.get("summary")
    if summary:
        print("=== Final Summary ===")
        print(summary)
    else:
        print("Pipeline completed, but no summary was produced.")
