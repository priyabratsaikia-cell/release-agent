from __future__ import annotations

from pydantic import BaseModel, Field


class SetApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1)
    model: str = Field(default="gemini-3.1-pro-preview")


class ConnectOrgRequest(BaseModel):
    alias: str = Field(default="release-agent-org")
    instance_url: str = Field(default="https://login.salesforce.com")
    sandbox: bool = False


class RunAnalysisRequest(BaseModel):
    release_name: str = Field(..., min_length=1)


class AnalysisProgress(BaseModel):
    step: int
    total_steps: int
    step_name: str
    message: str
    percent: int = 0


class ReleaseChange(BaseModel):
    category: str = ""
    title: str = ""
    description: str = ""
    impact_area: str = ""
    change_type: str = ""  # New Feature, Changed, Retired, etc.


class OrgMetadataItem(BaseModel):
    metadata_type: str
    full_name: str
    last_modified: str = ""


class ImpactItem(BaseModel):
    severity: str  # Critical, High, Medium, Low, Info
    category: str
    release_change: str
    affected_components: list[str] = []
    description: str = ""
    remediation: str = ""


class AnalysisReport(BaseModel):
    release_name: str
    org_username: str = ""
    org_instance: str = ""
    generated_at: str = ""
    summary: str = ""
    total_changes_analyzed: int = 0
    total_metadata_components: int = 0
    impacts: list[ImpactItem] = []
    statistics: dict = {}
