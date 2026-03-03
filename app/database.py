"""SQLite persistence layer – settings, orgs, scans, impacts."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import aiosqlite

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "release_agent.db"

# ── Bootstrap ─────────────────────────────────────────────────────────

async def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with _connect() as db:
        await db.executescript(_SCHEMA)
        await db.commit()
    logger.info("Database initialised at %s", DB_PATH)


def _connect():
    return aiosqlite.connect(str(DB_PATH))


_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orgs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    alias        TEXT NOT NULL UNIQUE,
    username     TEXT,
    instance_url TEXT,
    is_active    INTEGER DEFAULT 1,
    connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scans (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    release_name     TEXT NOT NULL,
    org_alias        TEXT NOT NULL,
    org_username     TEXT,
    status           TEXT DEFAULT 'running',
    total_changes    INTEGER DEFAULT 0,
    total_components INTEGER DEFAULT 0,
    total_impacts    INTEGER DEFAULT 0,
    critical_count   INTEGER DEFAULT 0,
    high_count       INTEGER DEFAULT 0,
    medium_count     INTEGER DEFAULT 0,
    low_count        INTEGER DEFAULT 0,
    info_count       INTEGER DEFAULT 0,
    summary          TEXT,
    report_json      TEXT,
    started_at       TEXT DEFAULT (datetime('now')),
    completed_at     TEXT
);

CREATE TABLE IF NOT EXISTS impacts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id             INTEGER NOT NULL,
    severity            TEXT NOT NULL,
    category            TEXT,
    release_change      TEXT,
    description         TEXT,
    affected_components TEXT,
    remediation         TEXT,
    is_resolved         INTEGER DEFAULT 0,
    resolved_at         TEXT,
    FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
);
"""

# ── Settings ──────────────────────────────────────────────────────────

async def get_setting(key: str) -> str | None:
    async with _connect() as db:
        cur = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row[0] if row else None


async def set_setting(key: str, value: str):
    async with _connect() as db:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            (key, value),
        )
        await db.commit()


async def delete_setting(key: str):
    async with _connect() as db:
        await db.execute("DELETE FROM settings WHERE key = ?", (key,))
        await db.commit()


async def get_all_settings() -> dict[str, str]:
    async with _connect() as db:
        cur = await db.execute("SELECT key, value FROM settings")
        return {r[0]: r[1] for r in await cur.fetchall()}

# ── Orgs ──────────────────────────────────────────────────────────────

async def add_org(alias: str, username: str = "", instance_url: str = "") -> int:
    async with _connect() as db:
        await db.execute(
            """INSERT INTO orgs (alias, username, instance_url, is_active, connected_at)
               VALUES (?, ?, ?, 1, datetime('now'))
               ON CONFLICT(alias) DO UPDATE SET
                 username=excluded.username,
                 instance_url=excluded.instance_url,
                 is_active=1,
                 connected_at=datetime('now')""",
            (alias, username, instance_url),
        )
        await db.commit()
        cur = await db.execute("SELECT id FROM orgs WHERE alias = ?", (alias,))
        row = await cur.fetchone()
        return row[0] if row else 0


async def get_orgs() -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM orgs WHERE is_active = 1 ORDER BY connected_at DESC"
        )
        return [dict(r) for r in await cur.fetchall()]


async def remove_org(org_id: int):
    async with _connect() as db:
        await db.execute("UPDATE orgs SET is_active = 0 WHERE id = ?", (org_id,))
        await db.commit()

# ── Scans ─────────────────────────────────────────────────────────────

async def create_scan(release_name: str, org_alias: str, org_username: str = "") -> int:
    async with _connect() as db:
        cur = await db.execute(
            """INSERT INTO scans (release_name, org_alias, org_username, status, started_at)
               VALUES (?, ?, ?, 'running', datetime('now'))""",
            (release_name, org_alias, org_username),
        )
        await db.commit()
        return cur.lastrowid


async def update_scan(scan_id: int, **kwargs: Any):
    if not kwargs:
        return
    async with _connect() as db:
        cols = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values()) + [scan_id]
        await db.execute(f"UPDATE scans SET {cols} WHERE id = ?", vals)
        await db.commit()


async def get_scan(scan_id: int) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM scans WHERE id = ?", (scan_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_scans() -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM scans ORDER BY started_at DESC")
        return [dict(r) for r in await cur.fetchall()]

# ── Impacts ───────────────────────────────────────────────────────────

async def add_impact(
    scan_id: int,
    severity: str,
    category: str,
    release_change: str,
    description: str,
    affected_components: list[str],
    remediation: str,
) -> int:
    async with _connect() as db:
        cur = await db.execute(
            """INSERT INTO impacts
               (scan_id, severity, category, release_change, description,
                affected_components, remediation)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (scan_id, severity, category, release_change, description,
             json.dumps(affected_components), remediation),
        )
        await db.commit()
        return cur.lastrowid


async def get_impacts(scan_id: int) -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """SELECT * FROM impacts WHERE scan_id = ?
               ORDER BY CASE severity
                 WHEN 'Critical' THEN 0 WHEN 'High' THEN 1
                 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END""",
            (scan_id,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
        for r in rows:
            try:
                r["affected_components"] = json.loads(r["affected_components"] or "[]")
            except (json.JSONDecodeError, TypeError):
                r["affected_components"] = []
        return rows


async def resolve_impact(impact_id: int):
    async with _connect() as db:
        await db.execute(
            "UPDATE impacts SET is_resolved = 1, resolved_at = datetime('now') WHERE id = ?",
            (impact_id,),
        )
        await db.commit()


async def unresolve_impact(impact_id: int):
    async with _connect() as db:
        await db.execute(
            "UPDATE impacts SET is_resolved = 0, resolved_at = NULL WHERE id = ?",
            (impact_id,),
        )
        await db.commit()

# ── Dashboard ─────────────────────────────────────────────────────────

async def get_dashboard_stats() -> dict:
    async with _connect() as db:
        async def _count(sql: str) -> int:
            cur = await db.execute(sql)
            return (await cur.fetchone())[0]

        return {
            "total_scans": await _count("SELECT COUNT(*) FROM scans"),
            "completed_scans": await _count("SELECT COUNT(*) FROM scans WHERE status='completed'"),
            "total_impacts": await _count("SELECT COUNT(*) FROM impacts"),
            "resolved_impacts": await _count("SELECT COUNT(*) FROM impacts WHERE is_resolved=1"),
            "critical_unresolved": await _count(
                "SELECT COUNT(*) FROM impacts WHERE severity='Critical' AND is_resolved=0"
            ),
            "connected_orgs": await _count("SELECT COUNT(*) FROM orgs WHERE is_active=1"),
        }
