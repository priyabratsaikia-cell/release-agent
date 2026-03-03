"""LangGraph workflow definition for the release impact analysis agent."""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from app.agent.state import AgentState
from app.agent.nodes import (
    scrape_release_notes_node,
    retrieve_metadata_node,
    analyse_impact_node,
    generate_report_node,
    error_node,
)

logger = logging.getLogger(__name__)


def _route_after_scrape(state: AgentState) -> str:
    if state.get("error"):
        return "error"
    return "retrieve_metadata"


def _route_after_metadata(state: AgentState) -> str:
    if state.get("error"):
        return "error"
    return "analyse_impact"


def _route_after_analysis(state: AgentState) -> str:
    if state.get("error"):
        return "error"
    return "generate_report"


def _route_after_report(state: AgentState) -> str:
    return END


def build_analysis_graph() -> StateGraph:
    """Construct and compile the LangGraph workflow."""

    graph = StateGraph(AgentState)

    graph.add_node("scrape_release_notes", scrape_release_notes_node)
    graph.add_node("retrieve_metadata", retrieve_metadata_node)
    graph.add_node("analyse_impact", analyse_impact_node)
    graph.add_node("generate_report", generate_report_node)
    graph.add_node("error", error_node)

    graph.set_entry_point("scrape_release_notes")

    graph.add_conditional_edges("scrape_release_notes", _route_after_scrape, {
        "retrieve_metadata": "retrieve_metadata",
        "error": "error",
    })
    graph.add_conditional_edges("retrieve_metadata", _route_after_metadata, {
        "analyse_impact": "analyse_impact",
        "error": "error",
    })
    graph.add_conditional_edges("analyse_impact", _route_after_analysis, {
        "generate_report": "generate_report",
        "error": "error",
    })
    graph.add_edge("generate_report", END)
    graph.add_edge("error", END)

    return graph.compile()


async def run_analysis(
    gemini_api_key: str,
    gemini_model: str,
    release_name: str,
    release_url: str,
    target_org: str,
    progress_callback=None,
) -> dict[str, Any]:
    """Run the full analysis pipeline and return the final report."""

    from app.agent.nodes import set_progress_callback
    set_progress_callback(progress_callback)

    workflow = build_analysis_graph()

    initial_state: AgentState = {
        "gemini_api_key": gemini_api_key,
        "gemini_model": gemini_model,
        "release_name": release_name,
        "release_url": release_url,
        "target_org": target_org,
        "release_changes": [],
        "release_changes_text": "",
        "org_metadata": {},
        "org_metadata_summary": "",
        "impact_report": {},
        "error": None,
        "current_step": "starting",
        "messages": [],
    }

    final_state = await workflow.ainvoke(initial_state)

    set_progress_callback(None)

    if final_state.get("error"):
        raise RuntimeError(final_state["error"])

    return final_state.get("impact_report", {})
