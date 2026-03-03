# Salesforce Release Impact Analyser

A fully autonomous AI agent that analyses the impact of Salesforce seasonal releases on your specific Salesforce org. Built with **LangGraph**, **Gemini AI**, and **FastAPI**.

## Features

- **Release Notes Crawling** — Automatically extracts changes from Salesforce seasonal releases.
- **Org Metadata Retrieval** — Uses the Salesforce CLI to pull your org's metadata inventory.
- **AI-Powered Impact Analysis** — Gemini compares release changes against your metadata to identify affected components.
- **Detailed Report** — Generates severity-rated findings with specific remediation steps.
- **Modern Web UI** — Real-time progress tracking, collapsible impact cards, and HTML export.

## Prerequisites

| Requirement | Details |
|---|---|
| **Python** | 3.11 or later |
| **Salesforce CLI** | `sf` v2 — [install guide](https://developer.salesforce.com/tools/salesforcecli) |
| **Gemini API Key** | From [Google AI Studio](https://aistudio.google.com/apikey) |

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the application
python main.py
```

The browser will open automatically at **http://127.0.0.1:8501**.

## Usage

1. **Enter your Gemini API Key** in the Setup panel and click *Save API Key*.
2. **Connect your Salesforce Org** — enter an alias and click *Connect Org*. The Salesforce login page will open in your browser.
3. **Select a Release** from the dropdown (Spring '26, Winter '26, or Summer '25).
4. **Click "Run Impact Analysis"** — the agent will:
   - Crawl release notes
   - Retrieve your org's metadata via SF CLI
   - Analyse impact with Gemini AI
   - Generate a detailed report
5. **Review the report** — expand each impact item for details and remediation steps.
6. **Export** the report as a standalone HTML file.

## Architecture

```
main.py                     Entry point — starts server, opens browser
app/
├── server.py               FastAPI app (REST + WebSocket)
├── config.py               Configuration and runtime state
├── models.py               Pydantic request/response models
├── agent/
│   ├── state.py            LangGraph state definition
│   ├── nodes.py            Agent processing nodes
│   └── graph.py            LangGraph workflow orchestration
├── services/
│   ├── llm.py              Gemini LLM integration
│   ├── salesforce.py       Salesforce CLI wrapper
│   └── scraper.py          Release notes crawler
└── static/
    ├── index.html           Web UI
    ├── styles.css           Styles
    └── app.js               Frontend logic
```

### Pipeline Flow

```
Salesforce Release Website
  → Scrape & Extract Changes (Node 1)
  → Retrieve Org Metadata via SF CLI (Node 2)
  → Analyse Impact with Gemini AI (Node 3)
  → Generate Structured Report (Node 4)
  → Display in Browser UI
```

## Configuration

| Setting | Where | Default |
|---|---|---|
| Gemini API Key | UI → Setup panel | — |
| Gemini Model | UI → Setup panel | `gemini-2.5-pro-preview-05-06` |
| Server Port | `main.py` → `PORT` | `8501` |
| Metadata Types | `app/config.py` | 22 common types |

## Troubleshooting

- **"sf not found"** — Install the Salesforce CLI and ensure it's on your PATH.
- **Org login timeout** — The browser login window has a 5-minute timeout. Complete the login promptly.
- **Gemini API errors** — Verify your API key is valid and has quota. Try a different model in the dropdown.
