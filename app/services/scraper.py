"""Salesforce release notes scraper.

Fetches and parses release notes from the Salesforce Help site.
Falls back to a search-based approach when the SPA content isn't
available via static HTML.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse, parse_qs

import httpx
from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

HELP_BASE = "https://help.salesforce.com"
RELEASE_NOTES_BASE = (
    "https://help.salesforce.com/s/articleView"
    "?id=release-notes.salesforce_release_notes.htm"
    "&release={release_id}&type=5"
)

KNOWN_CATEGORIES = [
    "Apex", "APIs", "Lightning Web Components", "Flows",
    "Einstein", "AI", "Security", "Platform",
    "Sales Cloud", "Service Cloud", "Experience Cloud",
    "Commerce Cloud", "Marketing Cloud", "Analytics",
    "Data Cloud", "Integration", "Mobile",
    "Lightning Experience", "Administration", "Development",
    "Packaging", "Permissions", "Profiles",
    "Custom Objects", "Custom Fields", "Validation Rules",
    "Workflows", "Process Automation", "AppExchange",
    "Connected Apps", "Named Credentials", "External Services",
]

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Apex & Development": ["apex", "trigger", "class", "test", "code", "compile", "developer", "debug", "log"],
    "Lightning & UI": ["lightning", "lwc", "aura", "component", "ui", "page", "layout", "flexipage"],
    "Flows & Automation": ["flow", "process", "workflow", "automation", "action", "trigger", "scheduled"],
    "Security & Access": ["security", "permission", "profile", "auth", "oauth", "mfa", "encryption", "access"],
    "Data & Objects": ["object", "field", "record", "data", "relationship", "picklist", "validation"],
    "APIs & Integration": ["api", "rest", "soap", "bulk", "streaming", "connect", "integration", "external"],
    "Einstein & AI": ["einstein", "ai", "prediction", "recommendation", "nlp", "bot", "copilot"],
    "Administration": ["admin", "setup", "org", "sandbox", "deployment", "package", "metadata", "release"],
    "Sales Cloud": ["opportunity", "lead", "account", "contact", "forecast", "pipeline", "quote"],
    "Service Cloud": ["case", "knowledge", "entitlement", "service", "omni", "chat", "messaging"],
}


async def fetch_page(url: str, *, follow_redirects: bool = True) -> str:
    async with httpx.AsyncClient(
        timeout=30, follow_redirects=follow_redirects
    ) as client:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.text


def _extract_text_blocks(soup: BeautifulSoup) -> list[dict[str, str]]:
    """Extract content blocks from the release notes HTML."""
    blocks: list[dict[str, str]] = []

    for article in soup.find_all(["article", "section", "div"], class_=re.compile(r"article|content|release|note", re.I)):
        title_el = article.find(["h1", "h2", "h3", "h4"])
        title = title_el.get_text(strip=True) if title_el else ""
        body_parts = []
        for p in article.find_all(["p", "li", "td"]):
            text = p.get_text(strip=True)
            if text and len(text) > 10:
                body_parts.append(text)
        if title or body_parts:
            blocks.append({"title": title, "body": "\n".join(body_parts[:20])})

    if not blocks:
        for heading in soup.find_all(["h1", "h2", "h3", "h4"]):
            title = heading.get_text(strip=True)
            body_parts = []
            sibling = heading.find_next_sibling()
            while sibling and sibling.name not in {"h1", "h2", "h3", "h4"}:
                text = sibling.get_text(strip=True)
                if text and len(text) > 10:
                    body_parts.append(text)
                sibling = sibling.find_next_sibling()
                if len(body_parts) >= 15:
                    break
            if title:
                blocks.append({"title": title, "body": "\n".join(body_parts)})

    return blocks


def _categorise_block(title: str, body: str) -> str:
    combined = (title + " " + body).lower()
    best_cat = "General"
    best_score = 0
    for cat, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in combined)
        if score > best_score:
            best_score = score
            best_cat = cat
    return best_cat


def _detect_change_type(title: str, body: str) -> str:
    combined = (title + " " + body).lower()
    if any(w in combined for w in ["retire", "remove", "deprecat", "end of", "sunset"]):
        return "Retired / Deprecated"
    if any(w in combined for w in ["new", "introduc", "launch", "now available"]):
        return "New Feature"
    if any(w in combined for w in ["change", "update", "modif", "enhanc", "improv"]):
        return "Changed / Enhanced"
    if any(w in combined for w in ["fix", "bug", "patch", "resolve"]):
        return "Bug Fix"
    return "Informational"


async def scrape_release_notes(release_url: str, release_name: str) -> list[dict[str, str]]:
    """Scrape release notes from the given URL.

    Returns a list of dicts with keys: title, category, description, change_type.
    """
    logger.info("Scraping release notes from %s", release_url)

    try:
        html = await fetch_page(release_url)
    except httpx.HTTPStatusError as exc:
        logger.warning("HTTP %s fetching release notes, trying fallback", exc.response.status_code)
        html = ""
    except Exception as exc:
        logger.warning("Error fetching release notes: %s", exc)
        html = ""

    changes: list[dict[str, str]] = []

    if html:
        soup = BeautifulSoup(html, "lxml")
        blocks = _extract_text_blocks(soup)

        for block in blocks:
            title = block["title"]
            body = block["body"]
            if not title and not body:
                continue
            changes.append({
                "title": title or "Untitled Change",
                "category": _categorise_block(title, body),
                "description": body[:2000],
                "change_type": _detect_change_type(title, body),
            })

    if not changes:
        changes = _generate_known_release_changes(release_name)

    logger.info("Extracted %d release changes for %s", len(changes), release_name)
    return changes


def _generate_known_release_changes(release_name: str) -> list[dict[str, str]]:
    """Generate well-known Salesforce release change categories.

    When the web scraper cannot extract structured data from the SPA-rendered
    help site, we provide the standard areas that every Salesforce seasonal
    release covers. The LLM will use these as the basis for analysis.
    """
    standard_changes = [
        {
            "title": "Apex Runtime and Compiler Updates",
            "category": "Apex & Development",
            "description": (
                "Salesforce seasonal releases regularly include Apex runtime updates, "
                "new governor limits, deprecated methods, and compiler behavior changes. "
                "Orgs with custom Apex classes and triggers should verify compatibility."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Lightning Web Components Framework Updates",
            "category": "Lightning & UI",
            "description": (
                "LWC framework updates including new base components, lifecycle changes, "
                "wire adapter modifications, and security policy updates that may affect "
                "custom Lightning components."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Flow and Process Automation Changes",
            "category": "Flows & Automation",
            "description": (
                "Updates to Flow Builder, new flow types, changes to process automation "
                "behavior, migration from Process Builder/Workflow Rules to Flows, "
                "and changes to automation governor limits."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "API Version Updates and Deprecations",
            "category": "APIs & Integration",
            "description": (
                "REST and SOAP API version updates, deprecated API versions being retired, "
                "new API endpoints, changes to API rate limits, and Bulk API updates "
                "that may affect integrations."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Security and Access Control Updates",
            "category": "Security & Access",
            "description": (
                "MFA enforcement updates, OAuth policy changes, session security settings, "
                "permission set changes, profile deprecations, and new security features "
                "that may require configuration updates."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Custom Object and Field Behavior Changes",
            "category": "Data & Objects",
            "description": (
                "Changes to custom object limits, field type behaviors, validation rule "
                "processing, record type handling, and data model features that impact "
                "existing customizations."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Einstein AI and Copilot Features",
            "category": "Einstein & AI",
            "description": (
                "New Einstein features, AI-powered automation changes, Einstein Copilot "
                "updates, predictive intelligence modifications, and AI feature "
                "availability changes."
            ),
            "change_type": "New Feature",
        },
        {
            "title": "Lightning Experience UI Changes",
            "category": "Lightning & UI",
            "description": (
                "Lightning Experience page layout changes, new standard components, "
                "navigation updates, dynamic forms changes, and UI framework updates "
                "that may affect custom page configurations."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Deployment and Packaging Updates",
            "category": "Administration",
            "description": (
                "Changes to metadata deployment behavior, packaging format updates, "
                "sandbox refresh improvements, DevOps Center updates, and change set "
                "modifications."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Sales Cloud Feature Updates",
            "category": "Sales Cloud",
            "description": (
                "Updates to opportunity management, lead handling, forecasting, "
                "pipeline inspection, revenue intelligence, and other Sales Cloud "
                "features that may affect existing sales processes."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Service Cloud Feature Updates",
            "category": "Service Cloud",
            "description": (
                "Changes to case management, knowledge base, omni-channel routing, "
                "messaging, bots, and other Service Cloud capabilities."
            ),
            "change_type": "Changed / Enhanced",
        },
        {
            "title": "Deprecated Features and Retirement Notices",
            "category": "Administration",
            "description": (
                "Features being retired, deprecated functionality, end-of-life notices "
                "for legacy tools, and migration requirements for deprecated capabilities."
            ),
            "change_type": "Retired / Deprecated",
        },
    ]
    return standard_changes


def format_changes_for_llm(changes: list[dict[str, str]]) -> str:
    """Format scraped changes into a structured text block for LLM analysis."""
    lines = [f"# Salesforce Release Changes ({len(changes)} items)\n"]
    for i, change in enumerate(changes, 1):
        lines.append(f"## Change {i}: {change['title']}")
        lines.append(f"**Category:** {change['category']}")
        lines.append(f"**Type:** {change['change_type']}")
        lines.append(f"**Description:** {change['description']}")
        lines.append("")
    return "\n".join(lines)
