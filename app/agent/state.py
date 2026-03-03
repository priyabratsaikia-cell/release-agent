"""LangGraph agent state definition."""

from __future__ import annotations

from typing import Any, Literal
from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    # --- inputs ---
    gemini_api_key: str
    gemini_model: str
    release_name: str
    release_url: str
    target_org: str

    # --- intermediate data ---
    release_changes: list[dict[str, str]]
    release_changes_text: str
    org_metadata: dict[str, list[dict]]
    org_metadata_summary: str

    # --- outputs ---
    impact_report: dict[str, Any]
    error: str | None

    # --- control ---
    current_step: str
    messages: list[dict[str, str]]  # progress log
