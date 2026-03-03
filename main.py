#!/usr/bin/env python3
"""Salesforce Release Impact Analyser – entry point.

Starts the FastAPI server and opens the browser UI.
"""

from __future__ import annotations

import logging
import sys
import threading
import time
import webbrowser

import uvicorn

HOST = "127.0.0.1"
PORT = 8501

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("release-agent")


def open_browser():
    """Wait briefly for the server to start, then open the browser."""
    time.sleep(1.5)
    url = f"http://{HOST}:{PORT}"
    logger.info("Opening browser at %s", url)
    webbrowser.open(url)


def main():
    logger.info("Starting Salesforce Release Impact Analyser…")
    logger.info("Server will be available at http://%s:%s", HOST, PORT)

    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(
        "app.server:app",
        host=HOST,
        port=PORT,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
