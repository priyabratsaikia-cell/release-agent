# Fully Autonomous AI Agent for Salesforce Release Impact Analysis

## Objective

Build a fully agentic AI application (using LangChain or LangGraph where
appropriate) in **Python or JavaScript** that analyzes the impact of
Salesforce seasonal releases (3 per year) on a specific Salesforce org.

------------------------------------------------------------------------

## Core Capabilities

For each Salesforce release, the agent must:

1.  Crawl and extract release changes from the official Salesforce
    release website.
2.  Retrieve the target org's metadata using **Salesforce CLI**
    (installed locally).
3.  Compare release changes against the org's metadata.
4.  Identify impacted components.
5.  Generate a detailed impact analysis report including remediation
    steps.

------------------------------------------------------------------------

## Technical Requirements

-   Use **Gemini 3.1 Pro Preview** via Gemini API for processing.
-   Integrate and adapt **OpenCode** to analyze org metadata against
    release changes.
-   Use **Salesforce CLI** for org authentication and metadata
    retrieval.
-   Follow an agentic architecture (multi-step reasoning, tool usage,
    orchestration).

------------------------------------------------------------------------

## Application Requirements

-   Must be a **terminal or desktop application**.
-   On execution, it should:
    -   Start a **localhost server**
    -   Automatically open a browser-based UI
-   UI should allow:
    -   Connecting to a Salesforce org via Salesforce CLI
    -   Running release impact analysis
    -   Viewing a structured impact analysis report
    -   The user will enter the Gemini api key from the UI.

------------------------------------------------------------------------

## Process Flow

Salesforce Release Website\
→ Extract Changes\
→ Retrieve Org Metadata (via Salesforce CLI)\
→ Analyze with OpenCode\
→ Generate Impact Report\
→ Display in UI
