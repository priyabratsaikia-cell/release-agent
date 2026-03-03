"""FastAPI application – REST API + WebSocket for the release analysis agent."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import SALESFORCE_RELEASES, app_state
from app.models import ConnectOrgRequest, RunAnalysisRequest, SetApiKeyRequest
from app.services import salesforce

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Salesforce Release Impact Analyser", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


# ── Health ────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


# ── API Key ───────────────────────────────────────────────────────────

@app.post("/api/settings/apikey")
async def set_api_key(req: SetApiKeyRequest):
    app_state.gemini_api_key = req.api_key
    app_state.gemini_model = req.model
    return {"ok": True, "model": req.model}


@app.get("/api/settings/apikey")
async def get_api_key_status():
    return {
        "is_set": bool(app_state.gemini_api_key),
        "model": app_state.gemini_model,
    }


# ── Salesforce Org ────────────────────────────────────────────────────

@app.post("/api/org/connect")
async def connect_org(req: ConnectOrgRequest):
    try:
        instance = req.instance_url
        if req.sandbox:
            instance = "https://test.salesforce.com"
        result = await salesforce.login_web(req.alias, instance)
        app_state.sf_target_org = req.alias
        app_state.is_org_connected = True

        org_info = await salesforce.display_org(req.alias)
        app_state.sf_username = org_info.get("username", "")
        app_state.sf_instance_url = org_info.get("instanceUrl", "")

        return {
            "ok": True,
            "username": app_state.sf_username,
            "instance_url": app_state.sf_instance_url,
            "alias": req.alias,
        }
    except Exception as exc:
        logger.exception("Org connection failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/org/status")
async def org_status():
    if not app_state.is_org_connected:
        return {"connected": False}

    try:
        info = await salesforce.display_org(app_state.sf_target_org)
        return {
            "connected": True,
            "username": info.get("username", app_state.sf_username),
            "instance_url": info.get("instanceUrl", app_state.sf_instance_url),
            "alias": app_state.sf_target_org,
        }
    except Exception:
        app_state.is_org_connected = False
        return {"connected": False}


@app.get("/api/org/list")
async def list_orgs():
    try:
        result = await salesforce.list_orgs()
        return {"ok": True, "orgs": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Releases ──────────────────────────────────────────────────────────

@app.get("/api/releases")
async def list_releases():
    releases = []
    for name, info in SALESFORCE_RELEASES.items():
        releases.append({"name": name, "url": info["url"], "api_version": info["api_version"]})
    return {"releases": releases}


# ── Analysis via WebSocket ────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def send_json(self, ws: WebSocket, data: dict):
        try:
            await ws.send_json(data)
        except Exception:
            pass

manager = ConnectionManager()


@app.websocket("/ws/analysis")
async def analysis_websocket(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_json()
            action = data.get("action")

            if action == "run_analysis":
                await _handle_analysis(ws, data)
            elif action == "ping":
                await manager.send_json(ws, {"type": "pong"})
            else:
                await manager.send_json(ws, {"type": "error", "message": f"Unknown action: {action}"})
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception as exc:
        logger.exception("WebSocket error")
        try:
            await manager.send_json(ws, {"type": "error", "message": str(exc)})
        except Exception:
            pass
        manager.disconnect(ws)


async def _handle_analysis(ws: WebSocket, data: dict):
    from app.agent.graph import run_analysis

    release_name = data.get("release_name", "")
    if not release_name:
        await manager.send_json(ws, {"type": "error", "message": "No release selected"})
        return

    if not app_state.gemini_api_key:
        await manager.send_json(ws, {"type": "error", "message": "Gemini API key not configured"})
        return

    if not app_state.is_org_connected:
        await manager.send_json(ws, {"type": "error", "message": "No Salesforce org connected"})
        return

    if app_state.analysis_running:
        await manager.send_json(ws, {"type": "error", "message": "Analysis already in progress"})
        return

    release_info = SALESFORCE_RELEASES.get(release_name, {})
    release_url = release_info.get("url", "")

    app_state.analysis_running = True

    async def progress_callback(message: str, step: int = 0, total: int = 4, percent: int = 0):
        await manager.send_json(ws, {
            "type": "progress",
            "step": step,
            "total_steps": total,
            "message": message,
            "percent": percent,
        })

    try:
        await manager.send_json(ws, {
            "type": "started",
            "message": "Analysis pipeline started",
            "release": release_name,
        })

        report = await run_analysis(
            gemini_api_key=app_state.gemini_api_key,
            gemini_model=app_state.gemini_model,
            release_name=release_name,
            release_url=release_url,
            target_org=app_state.sf_target_org,
            progress_callback=progress_callback,
        )

        app_state.last_report = report

        await manager.send_json(ws, {
            "type": "complete",
            "report": report,
        })

    except Exception as exc:
        logger.exception("Analysis pipeline failed")
        await manager.send_json(ws, {
            "type": "error",
            "message": f"Analysis failed: {exc}",
        })
    finally:
        app_state.analysis_running = False


# ── Last report (for re-fetching) ────────────────────────────────────

@app.get("/api/report/latest")
async def get_latest_report():
    if not app_state.last_report:
        raise HTTPException(status_code=404, detail="No report available")
    return app_state.last_report
