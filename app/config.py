from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

SALESFORCE_RELEASES: dict[str, dict] = {
    "Spring '26": {
        "api_version": "59.0",
        "url": "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=252&type=5",
        "search_query": "Salesforce Spring 26 release notes site:help.salesforce.com",
    },
    "Winter '26": {
        "api_version": "58.0",
        "url": "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=250&type=5",
        "search_query": "Salesforce Winter 26 release notes site:help.salesforce.com",
    },
    "Summer '25": {
        "api_version": "57.0",
        "url": "https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm&release=248&type=5",
        "search_query": "Salesforce Summer 25 release notes site:help.salesforce.com",
    },
}

METADATA_TYPES_TO_RETRIEVE: list[str] = [
    "ApexClass",
    "ApexTrigger",
    "ApexPage",
    "ApexComponent",
    "CustomObject",
    "Flow",
    "FlowDefinition",
    "LightningComponentBundle",
    "AuraDefinitionBundle",
    "Profile",
    "PermissionSet",
    "CustomApplication",
    "CustomTab",
    "Layout",
    "ValidationRule",
    "WorkflowRule",
    "ConnectedApp",
    "CustomField",
    "CustomMetadata",
    "PlatformEventChannel",
    "ExternalDataSource",
    "NamedCredential",
]


@dataclass
class AppState:
    """Mutable application-level runtime state (not persisted)."""

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-pro-preview"
    sf_target_org: str = ""
    sf_instance_url: str = ""
    sf_username: str = ""
    is_org_connected: bool = False
    analysis_running: bool = False
    last_report: dict = field(default_factory=dict)


app_state = AppState()
