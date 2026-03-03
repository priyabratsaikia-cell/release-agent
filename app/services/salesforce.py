"""Salesforce CLI wrapper – authenticates orgs and retrieves metadata."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from typing import Any

from app.config import METADATA_TYPES_TO_RETRIEVE

logger = logging.getLogger(__name__)

SF_CLI = "sf"


def _find_sf_cli() -> str:
    path = shutil.which("sf")
    if path:
        return path
    path = shutil.which("sfdx")
    if path:
        return path
    raise EnvironmentError(
        "Salesforce CLI ('sf' or 'sfdx') not found on PATH. "
        "Install it from https://developer.salesforce.com/tools/salesforcecli"
    )


async def _run_cli(args: list[str], timeout: int = 120) -> dict[str, Any]:
    sf = _find_sf_cli()
    cmd = [sf] + args + ["--json"]
    logger.info("Running: %s", " ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise TimeoutError(f"SF CLI command timed out after {timeout}s: {' '.join(cmd)}")

    raw = stdout.decode("utf-8", errors="replace").strip()
    if not raw:
        if proc.returncode != 0:
            err = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"SF CLI error (exit {proc.returncode}): {err}")
        return {}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Non-JSON output from SF CLI: %s", raw[:500])
        return {"raw": raw}

    if data.get("status") != 0 and "result" not in data:
        msg = data.get("message", data.get("name", "Unknown SF CLI error"))
        raise RuntimeError(f"SF CLI error: {msg}")

    return data


async def login_web(alias: str, instance_url: str = "https://login.salesforce.com") -> dict:
    """Initiate browser-based org login. Returns org info on success."""
    result = await _run_cli(
        ["org", "login", "web", "--alias", alias, "--instance-url", instance_url],
        timeout=300,
    )
    return result.get("result", result)


async def login_sandbox(alias: str) -> dict:
    return await login_web(alias, instance_url="https://test.salesforce.com")


async def display_org(target_org: str) -> dict:
    result = await _run_cli(["org", "display", "--target-org", target_org])
    return result.get("result", result)


async def list_orgs() -> dict:
    result = await _run_cli(["org", "list"])
    return result.get("result", result)


async def list_metadata_types(target_org: str) -> list[dict]:
    result = await _run_cli(
        ["org", "list", "metadata-types", "--target-org", target_org]
    )
    metadata_objects = result.get("result", {})
    if isinstance(metadata_objects, dict):
        return metadata_objects.get("metadataObjects", [])
    return []


async def list_metadata(target_org: str, metadata_type: str) -> list[dict]:
    try:
        result = await _run_cli(
            ["org", "list", "metadata", "--metadata-type", metadata_type, "--target-org", target_org],
            timeout=60,
        )
        items = result.get("result", [])
        return items if isinstance(items, list) else []
    except Exception as exc:
        logger.warning("Failed to list %s: %s", metadata_type, exc)
        return []


async def retrieve_org_metadata(
    target_org: str,
    types: list[str] | None = None,
    progress_callback=None,
) -> dict[str, list[dict]]:
    """Retrieve metadata inventory for the given org.

    Returns a dict mapping metadata type names to lists of component dicts.
    """
    types = types or METADATA_TYPES_TO_RETRIEVE
    metadata: dict[str, list[dict]] = {}
    total = len(types)

    for idx, mtype in enumerate(types, 1):
        if progress_callback:
            await progress_callback(
                f"Retrieving {mtype} ({idx}/{total})…",
                percent=int(idx / total * 100),
            )
        items = await list_metadata(target_org, mtype)
        if items:
            metadata[mtype] = items
            logger.info("Retrieved %d %s components", len(items), mtype)

    return metadata


def summarise_metadata(metadata: dict[str, list[dict]]) -> str:
    """Create a concise textual summary of org metadata for LLM consumption."""
    lines: list[str] = []
    total = 0
    for mtype, items in sorted(metadata.items()):
        names = [item.get("fullName", item.get("fileName", "?")) for item in items]
        total += len(names)
        sample = names[:30]
        suffix = f" … and {len(names) - 30} more" if len(names) > 30 else ""
        lines.append(f"## {mtype} ({len(names)} components)")
        lines.append(", ".join(sample) + suffix)
        lines.append("")
    header = f"# Org Metadata Summary — {total} total components\n\n"
    return header + "\n".join(lines)
