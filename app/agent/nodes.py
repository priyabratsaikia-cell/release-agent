"""LangGraph agent node functions.

Each node performs one step of the analysis pipeline and updates the
shared AgentState.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.agent.state import AgentState
from app.services import scraper, salesforce
from app.services.llm import invoke_llm

logger = logging.getLogger(__name__)

_progress_callback = None


def set_progress_callback(cb):
    global _progress_callback
    _progress_callback = cb


async def _emit(msg: str, step: int = 0, total: int = 4, percent: int = 0):
    if _progress_callback:
        await _progress_callback(msg, step, total, percent)


# ── Node 1: Scrape Release Notes ─────────────────────────────────────

async def scrape_release_notes_node(state: AgentState) -> dict:
    await _emit("Crawling Salesforce release notes…", step=1, total=4, percent=5)

    release_url = state.get("release_url", "")
    release_name = state.get("release_name", "Unknown Release")

    try:
        changes = await scraper.scrape_release_notes(release_url, release_name)
        changes_text = scraper.format_changes_for_llm(changes)

        await _emit(
            f"Extracted {len(changes)} release changes",
            step=1, total=4, percent=20,
        )

        return {
            "release_changes": changes,
            "release_changes_text": changes_text,
            "current_step": "scrape_done",
            "messages": state.get("messages", []) + [
                {"role": "system", "content": f"Scraped {len(changes)} release changes for {release_name}"}
            ],
        }
    except Exception as exc:
        logger.exception("Failed to scrape release notes")
        return {"error": f"Failed to scrape release notes: {exc}", "current_step": "error"}


# ── Node 2: Retrieve Org Metadata ────────────────────────────────────

async def retrieve_metadata_node(state: AgentState) -> dict:
    await _emit("Retrieving org metadata via Salesforce CLI…", step=2, total=4, percent=25)

    target_org = state.get("target_org", "")
    if not target_org:
        return {"error": "No target org specified", "current_step": "error"}

    try:
        async def metadata_progress(msg, percent=0):
            await _emit(msg, step=2, total=4, percent=25 + int(percent * 0.25))

        metadata = await salesforce.retrieve_org_metadata(
            target_org, progress_callback=metadata_progress
        )
        summary = salesforce.summarise_metadata(metadata)
        total_components = sum(len(v) for v in metadata.values())

        await _emit(
            f"Retrieved {total_components} metadata components across {len(metadata)} types",
            step=2, total=4, percent=50,
        )

        return {
            "org_metadata": metadata,
            "org_metadata_summary": summary,
            "current_step": "metadata_done",
            "messages": state.get("messages", []) + [
                {"role": "system", "content": f"Retrieved {total_components} components from org"}
            ],
        }
    except Exception as exc:
        logger.exception("Failed to retrieve metadata")
        return {"error": f"Failed to retrieve org metadata: {exc}", "current_step": "error"}


# ── Node 3: Analyse Impact with Gemini ───────────────────────────────

ANALYSIS_SYSTEM_PROMPT = """\
You are a senior Salesforce architect and release management expert. Your job is
to analyse the impact of a Salesforce seasonal release on a specific org.

You will receive:
1. A list of release changes from the upcoming Salesforce release.
2. A summary of the org's metadata (custom code, objects, configurations).

Produce a thorough impact analysis in **valid JSON** with this schema:

{
  "summary": "<2-3 paragraph executive summary>",
  "impacts": [
    {
      "severity": "Critical|High|Medium|Low|Info",
      "category": "<category name>",
      "release_change": "<title of the release change>",
      "affected_components": ["Component1", "Component2"],
      "description": "<what will happen and why>",
      "remediation": "<specific steps to remediate>"
    }
  ],
  "statistics": {
    "critical": <count>,
    "high": <count>,
    "medium": <count>,
    "low": <count>,
    "info": <count>
  }
}

Rules:
- Be specific about which org components are affected and why.
- For each impact, reference the actual metadata component names from the org.
- Provide actionable remediation steps with Salesforce-specific guidance.
- Rate severity accurately:
  • Critical = will break functionality, data loss risk, or security vulnerability
  • High = significant behavior change requiring code/config updates before release
  • Medium = noticeable change that should be addressed but won't break anything
  • Low = minor change, cosmetic, or opt-in feature
  • Info = informational, no action required
- If a release change does NOT affect any component in the org, do NOT include it.
- Only output the JSON object, no markdown fences or extra text.
"""

async def analyse_impact_node(state: AgentState) -> dict:
    await _emit("Analysing release impact with Gemini AI…", step=3, total=4, percent=55)

    api_key = state.get("gemini_api_key", "")
    model = state.get("gemini_model", "gemini-3.1-pro-preview")

    if not api_key:
        return {"error": "Gemini API key not set", "current_step": "error"}

    changes_text = state.get("release_changes_text", "")
    metadata_summary = state.get("org_metadata_summary", "")

    if not changes_text:
        return {"error": "No release changes to analyse", "current_step": "error"}
    if not metadata_summary:
        return {"error": "No org metadata to analyse against", "current_step": "error"}

    user_prompt = (
        f"## Release Changes\n\n{changes_text}\n\n"
        f"## Org Metadata\n\n{metadata_summary}"
    )

    # Truncate if necessary to stay within context limits
    max_chars = 900_000
    if len(user_prompt) > max_chars:
        user_prompt = user_prompt[:max_chars] + "\n\n[Content truncated for length]"

    try:
        await _emit("Waiting for Gemini analysis (this may take 1-2 minutes)…", step=3, total=4, percent=60)

        raw_response = await invoke_llm(
            api_key=api_key,
            model=model,
            system_prompt=ANALYSIS_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.15,
        )

        # Parse JSON from response (strip markdown fences if present)
        json_str = raw_response.strip()
        if json_str.startswith("```"):
            json_str = json_str.split("\n", 1)[-1]
        if json_str.endswith("```"):
            json_str = json_str.rsplit("```", 1)[0]
        json_str = json_str.strip()

        analysis = json.loads(json_str)

        await _emit(
            f"Analysis complete — found {len(analysis.get('impacts', []))} potential impacts",
            step=3, total=4, percent=85,
        )

        return {
            "impact_report": analysis,
            "current_step": "analysis_done",
            "messages": state.get("messages", []) + [
                {"role": "system", "content": f"Analysis found {len(analysis.get('impacts', []))} impacts"}
            ],
        }
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse LLM response as JSON: %s", exc)
        return {
            "impact_report": {
                "summary": raw_response[:5000],
                "impacts": [],
                "statistics": {},
                "parse_error": True,
            },
            "current_step": "analysis_done",
        }
    except Exception as exc:
        logger.exception("LLM analysis failed")
        return {"error": f"Gemini analysis failed: {exc}", "current_step": "error"}


# ── Node 4: Generate Report ──────────────────────────────────────────

async def generate_report_node(state: AgentState) -> dict:
    await _emit("Generating final impact report…", step=4, total=4, percent=90)

    analysis = state.get("impact_report", {})
    release_name = state.get("release_name", "Unknown")
    metadata = state.get("org_metadata", {})
    changes = state.get("release_changes", [])

    total_components = sum(len(v) for v in metadata.values())

    report = {
        "release_name": release_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "org_alias": state.get("target_org", ""),
        "total_changes_analyzed": len(changes),
        "total_metadata_components": total_components,
        "metadata_types_scanned": list(metadata.keys()),
        "summary": analysis.get("summary", "Analysis completed."),
        "impacts": analysis.get("impacts", []),
        "statistics": analysis.get("statistics", {}),
    }

    # Recompute statistics if missing
    if not report["statistics"] and report["impacts"]:
        stats: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        for impact in report["impacts"]:
            sev = impact.get("severity", "info").lower()
            stats[sev] = stats.get(sev, 0) + 1
        report["statistics"] = stats

    await _emit("Report generation complete!", step=4, total=4, percent=100)

    return {
        "impact_report": report,
        "current_step": "done",
        "messages": state.get("messages", []) + [
            {"role": "system", "content": "Impact analysis report generated successfully"}
        ],
    }


# ── Error handler node ───────────────────────────────────────────────

async def error_node(state: AgentState) -> dict:
    error = state.get("error", "Unknown error occurred")
    await _emit(f"Error: {error}", step=0, total=4, percent=0)
    return {"current_step": "error"}
