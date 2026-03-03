/* ── Salesforce Release Impact Analyser – Frontend ─────────────────── */

(function () {
  "use strict";

  // ── DOM references ──────────────────────────────────────────────
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    apiKey:         $("#api-key"),
    modelSelect:    $("#model-select"),
    saveApiKeyBtn:  $("#save-api-key-btn"),
    orgAlias:       $("#org-alias"),
    sandboxToggle:  $("#sandbox-toggle"),
    connectOrgBtn:  $("#connect-org-btn"),
    orgInfo:        $("#org-info"),
    orgBadge:       $("#org-badge"),
    apiBadge:       $("#api-badge"),
    releaseSelect:  $("#release-select"),
    runBtn:         $("#run-analysis-btn"),
    progressSection:$("#progress-section"),
    progressStep:   $("#progress-step"),
    progressPercent:$("#progress-percent"),
    progressFill:   $("#progress-fill"),
    progressMessage:$("#progress-message"),
    progressLog:    $("#progress-log"),
    reportPanel:    $("#report-panel"),
    reportMeta:     $("#report-meta"),
    statsGrid:      $("#stats-grid"),
    reportSummary:  $("#report-summary"),
    impactList:     $("#impact-list"),
    exportBtn:      $("#export-btn"),
  };

  let ws = null;

  // ── Toast notifications ─────────────────────────────────────────
  function toast(message, type = "info") {
    const container = $("#toast-container");
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = "toastOut 0.3s ease forwards";
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // ── API helpers ─────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || err.message || "Request failed");
    }
    return res.json();
  }

  // ── Init ────────────────────────────────────────────────────────
  async function init() {
    await checkApiKeyStatus();
    await checkOrgStatus();
    await loadReleases();
    attachEvents();
  }

  async function checkApiKeyStatus() {
    try {
      const data = await api("GET", "/api/settings/apikey");
      if (data.is_set) {
        els.apiBadge.className = "badge badge-connected";
        els.apiBadge.textContent = `API Key Set (${data.model})`;
        updateRunButton();
      }
    } catch { /* ignore */ }
  }

  async function checkOrgStatus() {
    try {
      const data = await api("GET", "/api/org/status");
      if (data.connected) {
        setOrgConnected(data);
      }
    } catch { /* ignore */ }
  }

  async function loadReleases() {
    try {
      const data = await api("GET", "/api/releases");
      els.releaseSelect.innerHTML = '<option value="">-- Choose a release --</option>';
      data.releases.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.name;
        opt.textContent = `${r.name} (API v${r.api_version})`;
        els.releaseSelect.appendChild(opt);
      });
    } catch (e) {
      toast("Failed to load releases: " + e.message, "error");
    }
  }

  // ── Events ──────────────────────────────────────────────────────
  function attachEvents() {
    els.saveApiKeyBtn.addEventListener("click", saveApiKey);
    els.connectOrgBtn.addEventListener("click", connectOrg);
    els.runBtn.addEventListener("click", runAnalysis);
    els.releaseSelect.addEventListener("change", updateRunButton);
    els.exportBtn.addEventListener("click", exportReport);
  }

  async function saveApiKey() {
    const key = els.apiKey.value.trim();
    if (!key) { toast("Please enter an API key", "error"); return; }
    try {
      els.saveApiKeyBtn.disabled = true;
      els.saveApiKeyBtn.innerHTML = '<span class="spinner"></span> Saving…';
      const data = await api("POST", "/api/settings/apikey", {
        api_key: key,
        model: els.modelSelect.value,
      });
      els.apiBadge.className = "badge badge-connected";
      els.apiBadge.textContent = `API Key Set (${data.model})`;
      toast("API key saved", "success");
      updateRunButton();
    } catch (e) {
      toast("Failed to save API key: " + e.message, "error");
    } finally {
      els.saveApiKeyBtn.disabled = false;
      els.saveApiKeyBtn.textContent = "Save API Key";
    }
  }

  async function connectOrg() {
    const alias = els.orgAlias.value.trim() || "release-agent-org";
    const sandbox = els.sandboxToggle.checked;
    try {
      els.connectOrgBtn.disabled = true;
      els.connectOrgBtn.innerHTML = '<span class="spinner"></span> Connecting…';
      toast("Opening Salesforce login in your browser…", "info");
      const data = await api("POST", "/api/org/connect", {
        alias,
        instance_url: sandbox ? "https://test.salesforce.com" : "https://login.salesforce.com",
        sandbox,
      });
      setOrgConnected(data);
      toast("Org connected successfully!", "success");
    } catch (e) {
      toast("Org connection failed: " + e.message, "error");
    } finally {
      els.connectOrgBtn.disabled = false;
      els.connectOrgBtn.textContent = "Connect Org";
    }
  }

  function setOrgConnected(data) {
    els.orgBadge.className = "badge badge-connected";
    els.orgBadge.textContent = data.username || data.alias || "Connected";
    els.orgInfo.classList.remove("hidden");
    els.orgInfo.innerHTML =
      `<strong>Username:</strong> ${data.username || "N/A"}<br>` +
      `<strong>Instance:</strong> ${data.instance_url || "N/A"}<br>` +
      `<strong>Alias:</strong> ${data.alias || "N/A"}`;
    updateRunButton();
  }

  function updateRunButton() {
    const apiSet = els.apiBadge.classList.contains("badge-connected");
    const orgSet = els.orgBadge.classList.contains("badge-connected");
    const releaseSet = !!els.releaseSelect.value;
    els.runBtn.disabled = !(apiSet && orgSet && releaseSet);
  }

  // ── Analysis via WebSocket ──────────────────────────────────────
  function connectWebSocket() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws/analysis`);
      ws.onopen = () => resolve(ws);
      ws.onerror = (e) => reject(new Error("WebSocket connection failed"));
      ws.onclose = () => { ws = null; };
    });
  }

  async function runAnalysis() {
    const release = els.releaseSelect.value;
    if (!release) { toast("Select a release first", "error"); return; }

    els.runBtn.disabled = true;
    els.reportPanel.classList.add("hidden");
    els.progressSection.classList.remove("hidden");
    resetProgress();
    addLog("Connecting to analysis engine…", "info");

    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await connectWebSocket();
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      };

      ws.send(JSON.stringify({ action: "run_analysis", release_name: release }));
    } catch (e) {
      toast("Failed to start analysis: " + e.message, "error");
      els.runBtn.disabled = false;
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "started":
        addLog(`Analysis started for ${msg.release}`, "info");
        break;
      case "progress":
        updateProgress(msg);
        addLog(msg.message, "info");
        break;
      case "complete":
        addLog("Analysis complete!", "success");
        updateProgress({ step: 4, total_steps: 4, percent: 100, message: "Done!" });
        renderReport(msg.report);
        els.runBtn.disabled = false;
        toast("Impact analysis complete!", "success");
        break;
      case "error":
        addLog(`Error: ${msg.message}`, "error");
        toast(msg.message, "error");
        els.runBtn.disabled = false;
        break;
      case "pong":
        break;
      default:
        console.log("Unknown message:", msg);
    }
  }

  // ── Progress UI ─────────────────────────────────────────────────
  function resetProgress() {
    els.progressStep.textContent = "Step 0/4";
    els.progressPercent.textContent = "0%";
    els.progressFill.style.width = "0%";
    els.progressMessage.textContent = "Initialising…";
    els.progressLog.innerHTML = "";
  }

  function updateProgress(msg) {
    if (msg.step !== undefined) els.progressStep.textContent = `Step ${msg.step}/${msg.total_steps || 4}`;
    if (msg.percent !== undefined) {
      els.progressPercent.textContent = `${msg.percent}%`;
      els.progressFill.style.width = `${msg.percent}%`;
    }
    if (msg.message) els.progressMessage.textContent = msg.message;
  }

  function addLog(text, level = "info") {
    const el = document.createElement("div");
    el.className = `log-entry log-${level}`;
    const ts = new Date().toLocaleTimeString();
    el.textContent = `[${ts}] ${text}`;
    els.progressLog.appendChild(el);
    els.progressLog.scrollTop = els.progressLog.scrollHeight;
  }

  // ── Report Rendering ───────────────────────────────────────────
  function renderReport(report) {
    els.reportPanel.classList.remove("hidden");

    // Meta
    els.reportMeta.innerHTML = [
      metaItem("Release", report.release_name),
      metaItem("Generated", new Date(report.generated_at).toLocaleString()),
      metaItem("Org", report.org_alias || "N/A"),
      metaItem("Changes Analysed", report.total_changes_analyzed),
      metaItem("Components Scanned", report.total_metadata_components),
    ].join("");

    // Statistics
    const stats = report.statistics || {};
    els.statsGrid.innerHTML = ["critical", "high", "medium", "low", "info"]
      .map((sev) =>
        `<div class="stat-card ${sev}">
          <div class="stat-number">${stats[sev] || 0}</div>
          <div class="stat-label">${sev}</div>
        </div>`
      )
      .join("");

    // Summary
    els.reportSummary.innerHTML = `<h3>Executive Summary</h3><p>${escapeHtml(report.summary || "No summary available.")}</p>`;

    // Impacts
    const impacts = report.impacts || [];
    if (impacts.length === 0) {
      els.impactList.innerHTML = '<div class="card"><p>No impacts detected for this release.</p></div>';
    } else {
      const sorted = [...impacts].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity));
      els.impactList.innerHTML = sorted.map(renderImpactItem).join("");

      els.impactList.querySelectorAll(".impact-header").forEach((header) => {
        header.addEventListener("click", () => {
          header.closest(".impact-item").classList.toggle("open");
        });
      });
    }

    els.reportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderImpactItem(impact) {
    const sev = (impact.severity || "info").toLowerCase();
    const components = (impact.affected_components || [])
      .map((c) => `<span class="component-tag">${escapeHtml(c)}</span>`)
      .join("");

    return `
      <div class="impact-item">
        <div class="impact-header">
          <span class="impact-severity ${sev}">${sev}</span>
          <span class="impact-title">${escapeHtml(impact.release_change || "Untitled")}</span>
          <span class="impact-category">${escapeHtml(impact.category || "")}</span>
          <svg class="impact-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="impact-body">
          <div class="impact-section">
            <div class="impact-section-title">Description</div>
            <p>${escapeHtml(impact.description || "No details.")}</p>
          </div>
          ${components ? `
          <div class="impact-section">
            <div class="impact-section-title">Affected Components</div>
            <div class="impact-components">${components}</div>
          </div>` : ""}
          ${impact.remediation ? `
          <div class="impact-section">
            <div class="impact-section-title">Remediation Steps</div>
            <div class="remediation-box">${escapeHtml(impact.remediation)}</div>
          </div>` : ""}
        </div>
      </div>`;
  }

  function metaItem(label, value) {
    return `<div class="report-meta-item"><strong>${label}:</strong> ${escapeHtml(String(value))}</div>`;
  }

  function sevOrder(sev) {
    return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[(sev || "info").toLowerCase()] ?? 5;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Export ──────────────────────────────────────────────────────
  function exportReport() {
    const reportHtml = els.reportPanel.outerHTML;
    const styleLink = document.querySelector('link[rel="stylesheet"]');
    const styles = styleLink ? `<link rel="stylesheet" href="${styleLink.href}">` : "";
    const full = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Impact Report</title>${styles}
      <style>body{background:#0f1117;color:#e8eaed;font-family:Segoe UI,sans-serif;padding:2rem;}
      .hidden{display:block!important;}</style></head><body>${reportHtml}</body></html>`;

    const blob = new Blob([full], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "impact-analysis-report.html";
    a.click();
    URL.revokeObjectURL(url);
    toast("Report exported!", "success");
  }

  // ── Boot ────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();
