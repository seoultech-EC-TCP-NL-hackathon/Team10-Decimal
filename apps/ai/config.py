"""
Application configuration utilities.

This module defines a small helper class that is responsible for
loading and exposing configuration values needed by the AI
pipeline. Configuration is primarily read from the JSON file
generated during the bootstrap phase (see `bootstrap/manager.py`).
Fallback values are provided for local development. The class also
exposes a few convenience properties for common paths.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class Config:
    """Holds configuration loaded from the bootstrap JSON.

    Attributes
    ----------
    root_dir: Path
        Root of the project. All other relative paths are resolved from here.
    config_path: Path
        Location of the ai.config.json file. This file records the
        hardware probe result and the model selection produced at
        bootstrap time.
    payload: Dict[str, Any]
        Raw JSON data loaded from the config file. This includes the
        hardware description (``payload['hardware']``) and the selected
        models (``payload['selected']``).
    runs_dir: Path
        Base directory where pipeline runs will be stored. Each run
        creates a subdirectory under this path (``apps/ai/output/<run_id>``).
    """

    root_dir: Path
    config_path: Path
    payload: Dict[str, Any]
    runs_dir: Path

    @classmethod
    def load(cls, root_dir: Optional[Path] = None, *, config_path: Optional[Path] = None) -> "Config":
        """Load configuration from the JSON file and return a Config instance.

        Parameters
        ----------
        root_dir : Optional[Path]
            The project root. Defaults to the parent of this file
            (i.e. the ``project/apps/ai`` directory's grandparent).
        config_path : Optional[Path]
            Explicit path to a config JSON file. If omitted the default
            location ``root_dir/apps/ai/ai.config.json`` is used.

        Returns
        -------
        Config
            A populated configuration object.
        """
        # Determine project root: two levels up from this file (project/apps/ai)
        base = root_dir or Path(__file__).resolve().parents[2]
        # Determine config file location
        cfg = config_path or (base / "apps" / "ai" / "ai.config.json")
        if not cfg.exists():
            raise FileNotFoundError(
                f"Configuration file '{cfg}' not found. Did you run the bootstrap/manager?"
            )
        payload = json.loads(cfg.read_text(encoding="utf-8"))
        runs_dir = base / "apps" / "ai" / "output"
        return cls(root_dir=base, config_path=cfg, payload=payload, runs_dir=runs_dir)

    # Convenience properties
    @property
    def selected_models(self) -> Dict[str, Any]:
        """Return the model selection dictionary from the payload."""
        return self.payload.get("selected", {})

    @property
    def hardware(self) -> Dict[str, Any]:
        """Return the hardware description dictionary from the payload."""
        return self.payload.get("hardware", {})


