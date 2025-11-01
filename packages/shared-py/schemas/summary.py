"""
Summary schema for AI outputs.

Provides a dataclass encapsulating both categorical and free form
summaries. Other services (e.g. API responses) can rely on this
schema to return summarised results.
"""

from dataclasses import dataclass, field
from typing import Dict, Any


@dataclass
class Summary:
    """A combined summary result.

    Attributes
    ----------
    categories : Dict[str, Any]
        Mapping from category names to associated metadata. See
        :class:`apps.ai.types.CategoryResult` for more detail.
    summary : str
        Natural language summary of the conversation.
    """
    categories: Dict[str, Any] = field(default_factory=dict)
    summary: str = ""
