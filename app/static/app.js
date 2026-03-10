/* ═══════════════════════════════════════════════════════════════════
   PwC Release Impact Analyser — Frontend SPA
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

  let ws = null;
  let currentScanId = null;
  let sevChart = null;
  let catChart = null;

  /* ── DOM cache ───────────────────────────────────────────────── */
  const el = {};
  function cacheEls() {
    [
      "tb-model", "tb-org", "sidebar-status",
      "dash-stats", "dash-recent-scans", "dash-new-scan-btn",
      "qa-new-scan", "qa-connect-org", "qa-settings",
      "scans-list", "scans-new-btn",
      "scan-release-select", "start-scan-btn", "scan-progress",
      "scan-progress-fill", "scan-progress-pct", "scan-log", "pipeline",
      "detail-back-btn", "detail-stats", "detail-subtitle",
      "detail-summary", "inv-tbody", "inv-footer", "inv-search",
      "filter-severity", "filter-unresolved", "export-report-btn",
      "detail-progress-wrap", "detail-report-wrap",
      "s-api-key", "s-model", "s-api-hint", "s-save-key-btn",
      "s-remove-key-btn", "s-org-list", "s-org-alias", "s-sandbox", "s-connect-btn",
      "toast-container",
    ].forEach((id) => {
      el[id.replace(/-/g, "_")] = document.getElementById(id);
    });
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  function toast(msg, type = "info") {
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.toast_container.appendChild(t);
    setTimeout(() => { t.style.animation = "tOut .25s ease forwards"; setTimeout(() => t.remove(), 250); }, 4500);
  }

  /* ── API helper ──────────────────────────────────────────────── */
  async function api(method, path, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(e.detail || e.message || "Request failed");
    }
    return r.status === 204 ? null : r.json();
  }

  /* ── Navigation ──────────────────────────────────────────────── */
  const pages = {};
  function initNav() {
    $$(".page").forEach((p) => { pages[p.id.replace("page-", "")] = p; });
    $$(".nav-item[data-page]").forEach((n) => {
      n.addEventListener("click", () => navigate(n.dataset.page));
    });
  }

  function navigate(page, opts) {
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.page === page));
    Object.values(pages).forEach((p) => p.classList.remove("active"));
    const target = pages[page];
    if (target) target.classList.add("active");

    const crumbs = {
      dashboard: [["Dashboard"]],
      scans: [["Dashboard", "dashboard"], ["Analysis & Reports"]],
      "new-scan": [["Dashboard", "dashboard"], ["Analysis", "scans"], ["New Analysis"]],
      "scan-detail": [["Dashboard", "dashboard"], ["Analysis", "scans"], ["Impact Report"]],
      settings: [["Configuration"]],
    };
    const bc = document.getElementById("topbar-breadcrumb");
    if (bc) {
      const parts = crumbs[page] || [[page]];
      bc.innerHTML = parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        const sep = i > 0 ? '<span class="tb-crumb-sep">/</span>' : "";
        if (isLast) return `${sep}<span class="tb-crumb tb-crumb-current">${p[0]}</span>`;
        return `${sep}<span class="tb-crumb tb-crumb-root tb-crumb-link" data-nav="${p[1]}">${p[0]}</span>`;
      }).join("");
      $$(".tb-crumb-link", bc).forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => navigate(el.dataset.nav));
      });
    }

    if (page === "dashboard") loadDashboard();
    if (page === "scans") loadScans();
    if (page === "settings") loadSettings();
    if (page === "new-scan") loadNewScan();
    if (page === "scan-detail" && opts?.scanId) loadScanDetail(opts.scanId);
  }

  /* ── Dashboard ───────────────────────────────────────────────── */
  async function loadDashboard() {
    try {
      const d = await api("GET", "/api/dashboard");
      const s = d.stats;
      const totalImpacts = s.total_impacts || 0;
      const resolved = s.resolved_impacts || 0;
      const resolveRate = totalImpacts > 0 ? Math.round((resolved / totalImpacts) * 100) : 0;
      const hoursSaved = Math.round((s.completed_scans || 0) * 3.5 + (resolved) * 0.8);
      const critOpen = s.critical_unresolved || 0;
      const highOpen = s.high_unresolved || 0;

      const avgImpactsPerScan = s.completed_scans > 0 ? Math.round(totalImpacts / s.completed_scans) : 0;
      const releasesCovered = s.completed_scans || 0;

      el.dash_stats.innerHTML = [
        kpiCard({
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
          value: `${hoursSaved}h`,
          label: "Estimated Hours Saved",
          sub: `~3.5h per analysis + 0.8h per remediation`,
          theme: "orange",
        }),
        kpiCard({
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
          value: fmtNum(totalImpacts),
          label: "Impacts Identified",
          sub: `Avg. ${avgImpactsPerScan} impacts per release analysis`,
          theme: "blue",
        }),
        kpiCard({
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
          value: fmtNum(s.total_components_scanned || 0),
          label: "Metadata Components Scanned",
          sub: `Across ${s.connected_orgs || 0} connected org${(s.connected_orgs || 0) !== 1 ? "s" : ""}`,
          theme: "green",
        }),
        kpiCard({
          icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>`,
          value: fmtNum(releasesCovered),
          label: "Releases Analysed",
          sub: `${fmtNum(s.total_changes_analysed || 0)} total release changes processed`,
          theme: "slate",
        }),
      ].join("");

      if (d.recent_scans.length === 0) {
        el.dash_recent_scans.innerHTML = '<div class="empty-state"><p>No analyses yet. Launch your first impact assessment.</p></div>';
      } else {
        el.dash_recent_scans.innerHTML = buildScanTable(d.recent_scans);
        bindScanTableClicks(el.dash_recent_scans);
      }
    } catch (e) { toast("Failed to load dashboard: " + e.message, "error"); }
  }

  function kpiCard({ icon, value, label, sub, theme, ring, pulse }) {
    const ringHtml = ring != null
      ? `<div class="kpi-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,.06)" stroke-width="2.5"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="${ring} ${100 - ring}" stroke-dashoffset="25" stroke-linecap="round"/></svg></div>`
      : "";
    return `<div class="kpi-card kpi-${theme}${pulse ? " kpi-pulse" : ""}">
      <div class="kpi-icon-wrap">${icon}</div>
      <div class="kpi-body">
        <div class="kpi-value">${value}${ringHtml}</div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-sub">${sub}</div>
      </div>
    </div>`;
  }

  function buildScanTable(scans) {
    const rows = scans.map((s) => {
      const date = s.started_at ? new Date(s.started_at + "Z").toLocaleString() : "—";
      return `<tr data-scan-id="${s.id}">
        <td><strong>${esc(s.release_name)}</strong><br><span style="color:var(--text-3);font-size:.7rem">${esc(s.org_alias)}</span></td>
        <td>${date}</td>
        <td><span class="status-pill ${s.status}">${s.status}</span></td>
        <td><div class="sev-dots">${sevDots(s)}</div></td>
      </tr>`;
    }).join("");
    return `<table class="dash-table"><thead><tr><th>Release</th><th>Date</th><th>Status</th><th>Severity</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function sevDots(s) {
    let d = "";
    for (let i = 0; i < (s.critical_count || 0); i++) d += '<span class="sev-dot c"></span>';
    for (let i = 0; i < (s.high_count || 0); i++) d += '<span class="sev-dot h"></span>';
    for (let i = 0; i < Math.min(s.medium_count || 0, 5); i++) d += '<span class="sev-dot m"></span>';
    if (!d) d = '<span style="color:var(--text-3);font-size:.7rem">—</span>';
    return d;
  }

  function bindScanTableClicks(container) {
    $$("tr[data-scan-id]", container).forEach((row) => {
      row.addEventListener("click", () => navigate("scan-detail", { scanId: row.dataset.scanId }));
    });
  }

  /* ── Scans list ──────────────────────────────────────────────── */
  async function loadScans() {
    try {
      const d = await api("GET", "/api/scans");
      if (d.scans.length === 0) {
        el.scans_list.innerHTML = '<div class="empty-state"><p>No scans found.</p></div>';
        return;
      }
      el.scans_list.innerHTML = d.scans.map((s) => {
        const date = s.started_at ? new Date(s.started_at + "Z").toLocaleString() : "—";
        return `<div class="scan-row" data-scan-id="${s.id}">
          <div><div class="scan-row-title">${esc(s.release_name)}</div><div class="scan-row-sub">${esc(s.org_alias)} · ${esc(s.org_username || "")}</div></div>
          <div class="scan-row-cell">${date}</div>
          <div class="scan-row-cell">${s.total_impacts || 0} impacts</div>
          <div><span class="status-pill ${s.status}">${s.status}</span></div>
          <div class="scan-row-actions"><button class="btn-icon btn-delete-scan" data-id="${s.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button></div>
        </div>`;
      }).join("");

      $$(".scan-row[data-scan-id]", el.scans_list).forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".btn-delete-scan")) return;
          navigate("scan-detail", { scanId: row.dataset.scanId });
        });
      });
      $$(".btn-delete-scan", el.scans_list).forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this scan?")) return;
          try { await api("DELETE", `/api/scans/${btn.dataset.id}`); loadScans(); toast("Scan deleted", "info"); } catch (err) { toast(err.message, "error"); }
        });
      });
    } catch (e) { toast("Failed to load scans: " + e.message, "error"); }
  }

  /* ── New Scan ────────────────────────────────────────────────── */
  async function loadNewScan() {
    try {
      const d = await api("GET", "/api/releases");
      const sel = el.scan_release_select;
      sel.innerHTML = '<option value="">Choose release…</option>';
      d.releases.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.name;
        opt.textContent = `${r.name} (API v${r.api_version})`;
        sel.appendChild(opt);
      });
    } catch (e) { toast(e.message, "error"); }
    el.scan_progress.classList.add("hidden");
    resetPipeline();
  }

  function resetPipeline() {
    $$(".pipeline-step", el.pipeline).forEach((s) => { s.className = "pipeline-step"; $(".step-sub", s).textContent = ""; });
    $$(".pipeline-connector", el.pipeline).forEach((c) => { c.className = "pipeline-connector"; });
    el.scan_progress_fill.style.width = "0%";
    el.scan_progress_pct.textContent = "0%";
    el.scan_log.innerHTML = "";
  }

  function setPipelineStep(step, status, sub) {
    const steps = $$(".pipeline-step", el.pipeline);
    const connectors = $$(".pipeline-connector", el.pipeline);
    steps.forEach((s, i) => {
      const n = i + 1;
      s.classList.remove("active", "done", "error");
      if (n < step) s.classList.add("done");
      else if (n === step) s.classList.add(status === "error" ? "error" : "active");
    });
    connectors.forEach((c, i) => {
      c.classList.remove("done", "active");
      if (i + 1 < step) c.classList.add("done");
      else if (i + 1 === step) c.classList.add("active");
    });
    if (sub && steps[step - 1]) $(".step-sub", steps[step - 1]).textContent = sub;
  }

  function addLog(text, level = "info") {
    const d = document.createElement("div");
    d.className = `log-line ${level}`;
    const ts = new Date().toLocaleTimeString();
    d.innerHTML = `<span class="log-ts">[${ts}]</span> ${esc(text)}`;
    el.scan_log.appendChild(d);
    el.scan_log.scrollTop = el.scan_log.scrollHeight;
  }

  /* ── Analysis WebSocket ──────────────────────────────────────── */
  function connectWs() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws/analysis`);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("WebSocket failed"));
      ws.onclose = () => { ws = null; };
    });
  }

  async function startAnalysis() {
    const release = el.scan_release_select.value;
    if (!release) { toast("Select a release", "error"); return; }
    el.start_scan_btn.disabled = true;
    el.scan_progress.classList.remove("hidden");
    resetPipeline();
    addLog("Connecting to analysis engine…", "info");
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) await connectWs();
      ws.onmessage = (e) => handleWs(JSON.parse(e.data));
      ws.send(JSON.stringify({ action: "run_analysis", release_name: release }));
    } catch (e) {
      toast("Failed: " + e.message, "error");
      el.start_scan_btn.disabled = false;
    }
  }

  function handleWs(msg) {
    switch (msg.type) {
      case "started":
        currentScanId = msg.scan_id;
        addLog(`Analysis started for ${msg.release}`, "info");
        setPipelineStep(1, "active");
        break;
      case "progress": {
        const { step, percent, message } = msg;
        if (step) setPipelineStep(step, "active", message);
        el.scan_progress_fill.style.width = `${percent}%`;
        el.scan_progress_pct.textContent = `${percent}%`;
        addLog(message, "info");
        break;
      }
      case "complete":
        setPipelineStep(4, "done");
        $$(".pipeline-connector", el.pipeline).forEach((c) => { c.classList.add("done"); c.classList.remove("active"); });
        $$(".pipeline-step", el.pipeline).forEach((s) => { s.classList.remove("active"); s.classList.add("done"); });
        el.scan_progress_fill.style.width = "100%";
        el.scan_progress_pct.textContent = "100%";
        addLog("Analysis complete!", "success");
        el.start_scan_btn.disabled = false;
        toast("Impact analysis complete!", "success");
        setTimeout(() => navigate("scan-detail", { scanId: msg.scan_id }), 1500);
        break;
      case "error":
        addLog(msg.message, "error");
        toast(msg.message, "error");
        el.start_scan_btn.disabled = false;
        break;
    }
  }

  /* ═════════════════════════════════════════════════════════════════
     SCAN DETAIL — mockup-matched rendering
     ═════════════════════════════════════════════════════════════════ */
  let detailData = null;
  let invPage = 1;
  const INV_PER_PAGE = 10;

  async function loadScanDetail(scanId) {
    try {
      const scan = await api("GET", `/api/scans/${scanId}`);
      detailData = scan;
      invPage = 1;

      const progressWrap = document.getElementById("detail-progress-wrap");
      const reportWrap = document.getElementById("detail-report-wrap");

      if (scan.status === "running") {
        progressWrap.classList.remove("hidden");
        reportWrap.classList.add("hidden");
        document.getElementById("detail-progress-title").textContent =
          `Analysing ${esc(scan.release_name)}`;
        document.getElementById("detail-progress-sub").textContent =
          `${esc(scan.org_alias)} — Scan started at ${scan.started_at ? new Date(scan.started_at + "Z").toLocaleTimeString() : "unknown"}`;
        initDetailProgress(scan);
      } else if (scan.status === "failed") {
        progressWrap.classList.remove("hidden");
        reportWrap.classList.add("hidden");
        document.getElementById("detail-progress-title").textContent = "Analysis Failed";
        document.getElementById("detail-progress-sub").textContent =
          `${esc(scan.release_name)} · ${esc(scan.org_alias)} — The analysis encountered an error.`;
        showDetailFailed();
      } else {
        progressWrap.classList.add("hidden");
        reportWrap.classList.remove("hidden");
        renderDetail(scan);
      }
    } catch (e) { toast("Failed to load scan: " + e.message, "error"); }
  }

  function initDetailProgress(scan) {
    const pipelineEl = document.getElementById("detail-pipeline");
    const logEl = document.getElementById("detail-scan-log");
    const fillEl = document.getElementById("detail-progress-fill");
    const pctEl = document.getElementById("detail-progress-pct");

    $$(".pipeline-step", pipelineEl).forEach((s) => { s.className = "pipeline-step"; $(".step-sub", s).textContent = ""; });
    $$(".pipeline-connector", pipelineEl).forEach((c) => { c.className = "pipeline-connector"; });
    fillEl.style.width = "0%";
    pctEl.textContent = "0%";
    logEl.innerHTML = "";

    const addDetailLog = (text, level = "info") => {
      const d = document.createElement("div");
      d.className = `log-line ${level}`;
      const ts = new Date().toLocaleTimeString();
      d.innerHTML = `<span class="log-ts">[${ts}]</span> ${esc(text)}`;
      logEl.appendChild(d);
      logEl.scrollTop = logEl.scrollHeight;
    };

    const setDetailStep = (step, status, sub) => {
      const steps = $$(".pipeline-step", pipelineEl);
      const connectors = $$(".pipeline-connector", pipelineEl);
      steps.forEach((s, i) => {
        const n = i + 1;
        s.classList.remove("active", "done", "error");
        if (n < step) s.classList.add("done");
        else if (n === step) s.classList.add(status === "error" ? "error" : "active");
      });
      connectors.forEach((c, i) => {
        c.classList.remove("done", "active");
        if (i + 1 < step) c.classList.add("done");
        else if (i + 1 === step) c.classList.add("active");
      });
      if (sub && steps[step - 1]) $(".step-sub", steps[step - 1]).textContent = sub;
    };

    addDetailLog(`Monitoring analysis for ${scan.release_name}…`, "info");
    setDetailStep(1, "active", "Waiting for updates…");

    if (ws && ws.readyState === WebSocket.OPEN) {
      addDetailLog("Connected to analysis engine", "info");
      const origHandler = ws.onmessage;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (origHandler) origHandler(e);
        handleDetailWs(msg, scan.id, setDetailStep, addDetailLog, fillEl, pctEl);
      };
    } else {
      addDetailLog("Analysis is running in the background. Will refresh when complete.", "info");
      pollScanStatus(scan.id);
    }
  }

  function handleDetailWs(msg, scanId, setDetailStep, addDetailLog, fillEl, pctEl) {
    switch (msg.type) {
      case "progress": {
        const { step, percent, message } = msg;
        if (step) setDetailStep(step, "active", message);
        fillEl.style.width = `${percent}%`;
        pctEl.textContent = `${percent}%`;
        addDetailLog(message, "info");
        break;
      }
      case "complete":
        setDetailStep(4, "done");
        fillEl.style.width = "100%";
        pctEl.textContent = "100%";
        addDetailLog("Analysis complete! Loading report…", "success");
        setTimeout(() => loadScanDetail(msg.scan_id || scanId), 1500);
        break;
      case "error":
        addDetailLog(msg.message, "error");
        break;
    }
  }

  function showDetailFailed() {
    const pipelineEl = document.getElementById("detail-pipeline");
    const logEl = document.getElementById("detail-scan-log");
    const fillEl = document.getElementById("detail-progress-fill");
    const pctEl = document.getElementById("detail-progress-pct");
    $$(".pipeline-step", pipelineEl).forEach((s) => { s.className = "pipeline-step error"; });
    fillEl.style.width = "100%";
    fillEl.style.background = "#DC2626";
    pctEl.textContent = "Failed";
    pctEl.style.color = "#DC2626";
    logEl.innerHTML = '<div class="log-line error"><span class="log-ts">[Error]</span> The analysis pipeline encountered a failure. Please try running a new scan.</div>';
  }

  async function pollScanStatus(scanId) {
    const check = async () => {
      try {
        const scan = await api("GET", `/api/scans/${scanId}`);
        if (scan.status !== "running") {
          loadScanDetail(scanId);
          return;
        }
        setTimeout(check, 3000);
      } catch { setTimeout(check, 5000); }
    };
    setTimeout(check, 3000);
  }

  function renderDetail(scan) {
    const date = scan.started_at ? new Date(scan.started_at + "Z").toLocaleString() : "—";
    const totalImpacts = (scan.impacts || []).length;
    const resolved = (scan.impacts || []).filter((i) => i.is_resolved).length;
    const inProgress = totalImpacts - resolved;

    el.detail_subtitle.textContent =
      `${esc(scan.release_name)} · ${esc(scan.org_alias)} · ${date} · ${scan.total_changes || 0} release changes analysed`;

    // ── 4 stat cards ──
    el.detail_stats.innerHTML = `
      <div class="rstat accent">
        <div class="rstat-label">Total Components</div>
        <div class="rstat-num">${fmtNum(scan.total_components || 0)}</div>
        <div class="rstat-trend neutral">${scan.total_changes || 0} changes scanned</div>
      </div>
      <div class="rstat success">
        <div class="rstat-label">Remediated</div>
        <div class="rstat-num">${fmtNum(resolved)}</div>
        <div class="rstat-trend ${resolved > 0 ? "up" : "neutral"}">${totalImpacts > 0 ? Math.round(resolved / totalImpacts * 100) : 0}% of impacts</div>
      </div>
      <div class="rstat warning">
        <div class="rstat-label">In Progress</div>
        <div class="rstat-num">${fmtNum(inProgress)}</div>
        <div class="rstat-trend neutral">Awaiting remediation</div>
      </div>
      <div class="rstat danger">
        <div class="rstat-label">Critical Risks</div>
        <div class="rstat-num">${fmtNum(scan.critical_count || 0)}</div>
        <div class="rstat-trend action">${(scan.critical_count || 0) > 0 ? "⚠ Action Required" : "No action needed"}</div>
      </div>`;

    renderCharts(scan);

    el.detail_summary.innerHTML = `<h4>Executive Summary</h4><p>${esc(scan.summary || "No summary available.")}</p>`;

    renderInventoryTable(scan.impacts || []);
  }

  function fmtNum(n) {
    return n >= 1000 ? n.toLocaleString() : String(n);
  }

  /* ── Severity Criteria ────────────────────────────────────────── */
  const SEV_CRITERIA = {
    Critical: "Breaking changes or security exposure",
    High: "Functional degradation likely",
    Medium: "Review and testing required",
    Low: "Non-critical, address post-release",
    Info: "Informational, no action needed",
  };
  const SEV_CRITERIA_LONG = {
    Critical: "Breaking changes, data loss risk, or security vulnerabilities requiring immediate action before release",
    High: "Significant functional impact — features may break or degrade, workaround needed before release",
    Medium: "Moderate impact — behaviour changes that need review and testing, may require configuration updates",
    Low: "Minor impact — cosmetic or non-critical changes, can be addressed post-release",
    Info: "Informational — no action required, awareness only for new features or deprecation notices",
  };

  /* ── Charts ──────────────────────────────────────────────────── */
  function renderCharts(scan) {
    if (sevChart) sevChart.destroy();
    if (catChart) catChart.destroy();

    const sevData = [scan.critical_count || 0, scan.high_count || 0, scan.medium_count || 0, scan.low_count || 0, scan.info_count || 0];
    const sevLabels = ["Critical", "High", "Medium", "Low", "Info"];
    const sevColors = ["#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#4F46E5"];

    const sevFilterMap = { 0: "Critical", 1: "High", 2: "Medium", 3: "Low", 4: "Info" };
    const sevCanvasEl = document.getElementById("chart-severity");

    let sevBubble = document.getElementById("sev-bubble");
    if (!sevBubble) {
      sevBubble = document.createElement("div");
      sevBubble.id = "sev-bubble";
      sevBubble.className = "sev-bubble";
      document.body.appendChild(sevBubble);
    }
    let bubblePinTimer = null;
    let bubblePinned = false;

    function showSevBubble(sevName, color, barX, barY) {
      const impacts = (detailData?.impacts || []).filter((i) => i.severity === sevName);
      if (!impacts.length) { sevBubble.classList.remove("visible"); return; }
      const maxShow = 8;
      const shown = impacts.slice(0, maxShow);
      const more = impacts.length - maxShow;
      sevBubble.innerHTML =
        `<div class="sev-bubble-head" style="border-left:3px solid ${color}">${sevName} — ${impacts.length} impact${impacts.length > 1 ? "s" : ""}</div>` +
        `<ul class="sev-bubble-list">${shown.map((imp) =>
          `<li class="sev-bubble-item" data-imp-id="${imp.id}"><span class="sev-bubble-id">IMP-${String(imp.id).padStart(4, "0")}</span>${esc((imp.release_change || "Untitled").substring(0, 45))}</li>`
        ).join("")}</ul>` +
        (more > 0 ? `<div class="sev-bubble-more">+${more} more</div>` : "");

      const canvasRect = sevCanvasEl.getBoundingClientRect();
      const bw = 260;
      let left = canvasRect.left + barX - bw / 2;
      if (left < 8) left = 8;
      if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
      let top = canvasRect.top + barY - 10;
      sevBubble.style.left = left + "px";
      sevBubble.style.top = "auto";
      sevBubble.style.bottom = "auto";

      sevBubble.classList.add("visible");
      const bh = sevBubble.offsetHeight;
      const finalTop = top - bh;
      sevBubble.style.top = (finalTop < 4 ? canvasRect.top + barY + 16 : finalTop) + "px";

      sevBubble.querySelectorAll(".sev-bubble-item").forEach((li) => {
        li.onclick = (e) => {
          e.stopPropagation();
          const impId = li.dataset.impId;
          sevBubble.classList.remove("visible");
          bubblePinned = false;
          navigateToImpact(impId);
        };
      });
    }

    function hideSevBubble() {
      if (!bubblePinned) sevBubble.classList.remove("visible");
    }

    function navigateToImpact(impId) {
      const impacts = detailData?.impacts || [];
      el.filter_severity.value = "";
      el.filter_unresolved.checked = false;
      el.inv_search.value = "";
      const idx = impacts.findIndex((i) => String(i.id) === String(impId));
      if (idx >= 0) {
        invPage = Math.floor(idx / INV_PER_PAGE) + 1;
        renderInventoryTable(impacts);
      }
      setTimeout(() => {
        const detailRow = document.getElementById(`inv-detail-${impId}`);
        if (detailRow) {
          $$(".inv-detail-row", el.inv_tbody).forEach((r) => r.classList.remove("open"));
          detailRow.classList.add("open");
          detailRow.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    }

    sevCanvasEl.addEventListener("mouseleave", () => {
      setTimeout(() => { if (!sevBubble.matches(":hover") && !bubblePinned) hideSevBubble(); }, 120);
    });
    sevBubble.addEventListener("mouseleave", () => {
      setTimeout(() => { if (!sevCanvasEl.matches(":hover") && !bubblePinned) hideSevBubble(); }, 120);
    });

    const sevCriteriaShort = [SEV_CRITERIA.Critical, SEV_CRITERIA.High, SEV_CRITERIA.Medium, SEV_CRITERIA.Low, SEV_CRITERIA.Info];
    const sevSubLabelPlugin = {
      id: "sevSubLabels",
      afterDraw(chart) {
        const { ctx } = chart;
        const xAxis = chart.scales.x;
        const yBottom = chart.chartArea.bottom;
        ctx.save();
        ctx.font = "500 8.5px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        xAxis.ticks.forEach((_tick, i) => {
          const x = xAxis.getPixelForValue(i);
          ctx.fillStyle = sevColors[i] || "#9CA3AF";
          ctx.fillText(sevCriteriaShort[i] || "", x, yBottom + 28);
        });
        ctx.restore();
      },
    };

    sevChart = new Chart(sevCanvasEl, {
      type: "bar",
      data: {
        labels: sevLabels,
        datasets: [{
          data: sevData,
          backgroundColor: sevColors.map((c) => c + "30"),
          borderColor: sevColors,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.55,
        }],
      },
      plugins: [sevSubLabelPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { bottom: 26 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#4B5563", font: { size: 11, weight: 600, family: "Inter" } } },
          y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.05)" }, ticks: { color: "#9CA3AF", font: { size: 10 }, stepSize: 1 } },
        },
        onHover: (event, elements) => {
          event.native.target.style.cursor = elements.length ? "pointer" : "default";
          if (bubblePinned) return;
          if (elements.length) {
            const idx = elements[0].index;
            const rect = elements[0].element;
            showSevBubble(sevFilterMap[idx], sevColors[idx], rect.x, rect.y);
          } else {
            hideSevBubble();
          }
        },
        onClick: (_evt, elements) => {
          if (!elements.length || !detailData) return;
          const idx = elements[0].index;
          const rect = elements[0].element;
          bubblePinned = true;
          if (bubblePinTimer) clearTimeout(bubblePinTimer);
          showSevBubble(sevFilterMap[idx], sevColors[idx], rect.x, rect.y);
          bubblePinTimer = setTimeout(() => { bubblePinned = false; hideSevBubble(); }, 6000);
        },
      },
    });

    const criteriaEl = document.getElementById("sev-criteria");
    if (criteriaEl) criteriaEl.innerHTML = "";

    const impacts = scan.impacts || [];
    const catMap = {};
    impacts.forEach((imp) => { const c = imp.category || "Other"; catMap[c] = (catMap[c] || 0) + 1; });
    const catLabels = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]).slice(0, 8);
    const catData = catLabels.map((c) => catMap[c]);

    const topCat = catLabels[0] || "—";
    const topCatTag = document.getElementById("chart-cat-tag");
    if (topCatTag) topCatTag.textContent = `Top: ${topCat}`;

    const catCtx = document.getElementById("chart-category").getContext("2d");
    const catGradient = catCtx.createLinearGradient(0, 0, 0, 200);
    catGradient.addColorStop(0, "rgba(208,74,2,.18)");
    catGradient.addColorStop(1, "rgba(208,74,2,.01)");

    catChart = new Chart(catCtx, {
      type: "line",
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          borderColor: "#D04A02",
          backgroundColor: catGradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: "#D04A02",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#4B5563", font: { size: 10, family: "Inter" }, maxRotation: 30 } },
          y: { beginAtZero: true, grid: { color: "rgba(0,0,0,.05)" }, ticks: { color: "#9CA3AF", font: { size: 10 }, stepSize: 1 } },
        },
      },
    });
  }

  /* ── Inventory table ─────────────────────────────────────────── */
  function getFilteredImpacts(impacts) {
    let list = [...impacts];
    const sevFilter = el.filter_severity.value;
    const unresolvedOnly = el.filter_unresolved.checked;
    const search = (el.inv_search.value || "").toLowerCase().trim();
    if (sevFilter) list = list.filter((i) => i.severity === sevFilter);
    if (unresolvedOnly) list = list.filter((i) => !i.is_resolved);
    if (search) list = list.filter((i) =>
      (i.release_change || "").toLowerCase().includes(search) ||
      (i.category || "").toLowerCase().includes(search) ||
      (i.description || "").toLowerCase().includes(search) ||
      (i.affected_components || []).some((c) => c.toLowerCase().includes(search))
    );
    return list;
  }

  function renderInventoryTable(impacts) {
    const filtered = getFilteredImpacts(impacts);
    const totalPages = Math.max(1, Math.ceil(filtered.length / INV_PER_PAGE));
    if (invPage > totalPages) invPage = totalPages;
    const start = (invPage - 1) * INV_PER_PAGE;
    const pageItems = filtered.slice(start, start + INV_PER_PAGE);

    if (filtered.length === 0) {
      el.inv_tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-3)">No impacts match your filter.</td></tr>`;
      el.inv_footer.innerHTML = "";
      return;
    }

    el.inv_tbody.innerHTML = pageItems.map((imp, idx) => {
      const sev = (imp.severity || "Info").toLowerCase();
      const sevLabel = (imp.severity || "Info").toUpperCase();
      const resolved = imp.is_resolved;
      const globalIdx = start + idx + 1;
      const comps = (imp.affected_components || []);
      const compsHtml = comps.map((c) => `<span class="comp-tag">${esc(c)}</span>`).join("");

      return `
        <tr class="inv-row${resolved ? " resolved-row" : ""}" data-idx="${globalIdx}">
          <td><span class="inv-id">IMP-${String(imp.id).padStart(4, "0")}</span></td>
          <td><span class="inv-name">${esc(imp.release_change || "Untitled")}</span></td>
          <td><span class="sev-text ${sev}">${sevLabel}</span></td>
          <td>
            <div class="status-indicator">
              <div class="status-bar"><div class="status-bar-fill ${resolved ? "resolved" : "open"}"></div></div>
              <span class="status-label ${resolved ? "resolved" : "open"}">${resolved ? "Resolved" : "Open"}</span>
            </div>
          </td>
          <td>${esc(imp.category || "—")}</td>
          <td><button class="inv-details-link" data-imp-id="${imp.id}">Details</button></td>
        </tr>
        <tr class="inv-detail-row" id="inv-detail-${imp.id}">
          <td colspan="6">
            <div class="inv-detail-inner">
              <div class="inv-detail-grid">
                <div class="inv-detail-section">
                  <h5>Detailed Analysis</h5>
                  <p>${esc(imp.description || "No details available.")}</p>
                  ${compsHtml ? `<div style="margin-top:.6rem"><h5>Affected Components</h5><div class="inv-detail-components">${compsHtml}</div></div>` : ""}
                </div>
                <div class="inv-detail-section">
                  <h5>Remediation Steps</h5>
                  <div class="inv-detail-remed">${formatRemediation(imp.remediation)}</div>
                </div>
              </div>
              <div class="inv-detail-actions">
                <button class="btn btn-autofix-primary" disabled title="Coming soon — AI-powered auto-remediation">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z"/><circle cx="12" cy="14" r="2"/></svg>
                  Auto Fix with Agent
                </button>
                <button class="btn btn-sm btn-resolve${resolved ? " resolved" : ""}" data-impact-id="${imp.id}" data-resolved="${resolved ? 1 : 0}">
                  ${resolved ? "✓ Resolved" : "Mark as Resolved"}
                </button>
              </div>
            </div>
          </td>
        </tr>`;
    }).join("");

    // Footer pagination
    const showStart = start + 1;
    const showEnd = Math.min(start + INV_PER_PAGE, filtered.length);
    let paginationBtns = "";
    if (totalPages > 1) {
      paginationBtns += `<button class="inv-page-btn" data-p="prev" ${invPage <= 1 ? "disabled" : ""}>Prev</button>`;
      for (let p = 1; p <= totalPages; p++) {
        paginationBtns += `<button class="inv-page-btn${p === invPage ? " active" : ""}" data-p="${p}">${p}</button>`;
      }
      paginationBtns += `<button class="inv-page-btn" data-p="next" ${invPage >= totalPages ? "disabled" : ""}>Next</button>`;
    }
    el.inv_footer.innerHTML = `
      <span class="inv-page-info">Showing ${showStart} to ${showEnd} of ${filtered.length} entries</span>
      <div class="inv-page-btns">${paginationBtns}</div>`;

    bindInventoryEvents(impacts, totalPages);
  }

  function bindInventoryEvents(impacts, totalPages) {
    const tbody = el.inv_tbody;

    // Details toggle
    $$(".inv-details-link", tbody).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.impId;
        const detailRow = document.getElementById(`inv-detail-${id}`);
        const isOpen = detailRow.classList.contains("open");
        $$(".inv-detail-row", tbody).forEach((r) => r.classList.remove("open"));
        if (!isOpen) detailRow.classList.add("open");
      });
    });

    // Row click also toggles
    $$(".inv-row", tbody).forEach((row) => {
      row.addEventListener("click", () => {
        const link = $(".inv-details-link", row);
        if (link) link.click();
      });
    });

    // Resolve buttons
    $$(".btn-resolve", tbody).forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.impactId;
        const isResolved = btn.dataset.resolved === "1";
        try {
          await api("POST", `/api/impacts/${id}/${isResolved ? "unresolve" : "resolve"}`);
          const scan = await api("GET", `/api/scans/${detailData.id}`);
          detailData = scan;
          renderDetail(scan);
          toast(isResolved ? "Marked as unresolved" : "Marked as resolved", "success");
        } catch (e) { toast(e.message, "error"); }
      });
    });

    // Pagination
    $$(".inv-page-btn", el.inv_footer).forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.p;
        if (p === "prev") invPage = Math.max(1, invPage - 1);
        else if (p === "next") invPage = Math.min(totalPages, invPage + 1);
        else invPage = parseInt(p);
        renderInventoryTable(impacts);
      });
    });
  }

  /* ── Settings ────────────────────────────────────────────────── */
  async function loadSettings() {
    try {
      const s = await api("GET", "/api/settings");
      if (s.api_key_set) {
        el.s_api_hint.textContent = `Current key: ${s.api_key_masked}`;
        el.s_api_hint.style.color = "var(--success)";
      } else {
        el.s_api_hint.textContent = "No API key configured";
        el.s_api_hint.style.color = "var(--text-3)";
      }
      el.s_model.value = s.model;
    } catch {}
    try {
      const o = await api("GET", "/api/orgs");
      if (o.orgs.length === 0) {
        el.s_org_list.innerHTML = '<div class="empty-state" style="padding:1rem"><p>No orgs connected.</p></div>';
      } else {
        el.s_org_list.innerHTML = o.orgs.map((org) => `
          <div class="org-row">
            <div class="org-row-info"><strong>${esc(org.alias)}</strong><span>${esc(org.username || "")} · ${esc(org.instance_url || "")}</span></div>
            <button class="btn btn-ghost btn-sm btn-danger-text btn-remove-org" data-id="${org.id}">Remove</button>
          </div>`).join("");
        $$(".btn-remove-org", el.s_org_list).forEach((btn) => {
          btn.addEventListener("click", async () => {
            try { await api("DELETE", `/api/orgs/${btn.dataset.id}`); toast("Org removed", "info"); loadSettings(); refreshTopbar(); } catch (e) { toast(e.message, "error"); }
          });
        });
      }
    } catch {}
  }

  /* ── Topbar / Sidebar status ─────────────────────────────────── */
  async function refreshTopbar() {
    try {
      const s = await api("GET", "/api/settings");
      const modelLabel = { "gemini-3.1-pro-preview": "Gemini 3.1 Pro", "gemini-3-pro-preview": "Gemini 3 Pro", "gemini-2.5-pro": "Gemini 2.5 Pro" }[s.model] || s.model;
      $("span", el.tb_model).textContent = s.api_key_set ? modelLabel : "No API Key";
    } catch {}
    try {
      const o = await api("GET", "/api/orgs");
      const dot = $(".conn-dot", el.sidebar_status);
      const label = $(".conn-label", el.sidebar_status);
      const tbDot = $(".conn-dot", el.tb_org);
      const tbLabel = $("span:last-child", el.tb_org);
      const envDot = document.getElementById("tb-env-dot");
      const envLabel = document.getElementById("tb-env-label");
      if (o.orgs.length > 0) {
        const org = o.orgs[0];
        dot.className = "conn-dot connected";
        label.textContent = org.username || org.alias;
        tbDot.className = "conn-dot connected";
        tbDot.style.width = "7px"; tbDot.style.height = "7px";
        tbLabel.textContent = org.username || org.alias;
        if (envLabel) envLabel.textContent = org.instance_url?.includes("sandbox") || org.instance_url?.includes("test") ? "Sandbox" : "Production";
      } else {
        dot.className = "conn-dot disconnected";
        label.textContent = "No org connected";
        tbDot.className = "conn-dot disconnected";
        tbDot.style.width = "7px"; tbDot.style.height = "7px";
        tbLabel.textContent = "Not connected";
        if (envLabel) envLabel.textContent = "No Environment";
        if (envDot) envDot.style.background = "var(--text-3)";
      }
    } catch {}
  }

  /* ── Export PDF ─────────────────────────────────────────────── */
  const SEV_COLORS = { Critical: "#DC2626", High: "#EA580C", Medium: "#CA8A04", Low: "#16A34A", Info: "#4F46E5" };
  const PW = { orange: [208, 74, 2], black: [26, 26, 46], gray: [75, 85, 99], light: [156, 163, 175], bg: [244, 245, 247], white: [255, 255, 255], line: [229, 231, 235] };

  function sevColor(sev) { return SEV_COLORS[sev] || "#9CA3AF"; }
  function hexToRgb(hex) { const m = hex.replace("#", "").match(/.{2}/g); return m ? m.map((x) => parseInt(x, 16)) : [0, 0, 0]; }

  window.__exportReport = async function () {
    if (!detailData) return;
    toast("Generating PDF report...", "info");
    try {
      const scan = detailData;
      const impacts = scan.impacts || [];
      const date = scan.started_at ? new Date(scan.started_at + "Z").toLocaleString() : "N/A";
      const totalImpacts = impacts.length;
      const resolved = impacts.filter((i) => i.is_resolved).length;
      const inProgress = totalImpacts - resolved;

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const usable = W - margin * 2;
      let y = 0;

      function addFooter() {
        pdf.setDrawColor(...PW.line);
        pdf.line(margin, H - 14, W - margin, H - 14);
        pdf.setFontSize(7); pdf.setTextColor(...PW.light);
        pdf.text("\u00A9 2026 PwC. All rights reserved. PwC refers to the PwC network and/or one or more of its member firms.", W / 2, H - 9, { align: "center" });
        pdf.text(`Page ${pdf.getNumberOfPages()}`, W - margin, H - 9, { align: "right" });
      }

      function checkPage(need) {
        if (y + need > H - 20) { addFooter(); pdf.addPage(); y = 22; return true; }
        return false;
      }

      /* ── PAGE 1 : Cover ─────────────────────────────────────── */
      pdf.setFillColor(...PW.orange);
      pdf.rect(0, 0, W, 6, "F");

      y = 38;
      pdf.setFillColor(...PW.orange);
      pdf.rect(margin, y, 3, 20, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(28); pdf.setTextColor(...PW.black);
      pdf.text("Impact Summary", margin + 8, y + 9);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(...PW.gray);
      pdf.text("Release Impact Analysis Report", margin + 8, y + 17);

      y += 32;
      pdf.setFontSize(9); pdf.setTextColor(...PW.light);
      pdf.text(`Release:  ${scan.release_name}`, margin, y);
      pdf.text(`Org:  ${scan.org_alias}`, margin, y + 5);
      pdf.text(`Generated:  ${date}`, margin, y + 10);
      pdf.text(`Model:  ${scan.model || "Gemini"}`, margin, y + 15);

      /* ── stat cards ── */
      y += 28;
      const cardW = (usable - 9) / 4;
      const cardH = 22;
      const stats = [
        { label: "Total Components", value: String(scan.total_components || 0), color: PW.orange },
        { label: "Remediated", value: String(resolved), color: [22, 163, 106] },
        { label: "In Progress", value: String(inProgress), color: [202, 138, 4] },
        { label: "Critical Risks", value: String(scan.critical_count || 0), color: [220, 38, 38] },
      ];
      stats.forEach((st, i) => {
        const cx = margin + i * (cardW + 3);
        pdf.setFillColor(250, 250, 252);
        pdf.roundedRect(cx, y, cardW, cardH, 2, 2, "F");
        pdf.setDrawColor(...PW.line); pdf.roundedRect(cx, y, cardW, cardH, 2, 2, "S");
        pdf.setFontSize(7); pdf.setTextColor(...PW.light); pdf.setFont("helvetica", "normal");
        pdf.text(st.label.toUpperCase(), cx + 4, y + 6);
        pdf.setFontSize(16); pdf.setTextColor(...st.color); pdf.setFont("helvetica", "bold");
        pdf.text(st.value, cx + 4, y + 16);
      });

      /* ── Charts (capture from rendered canvases) ── */
      y += cardH + 10;
      const chartSevEl = document.getElementById("chart-severity");
      const chartCatEl = document.getElementById("chart-category");
      if (chartSevEl && chartCatEl) {
        const halfW = (usable - 4) / 2;
        const chartH = 42;

        pdf.setFillColor(250, 250, 252);
        pdf.roundedRect(margin, y, halfW, chartH + 10, 2, 2, "F");
        pdf.setDrawColor(...PW.line); pdf.roundedRect(margin, y, halfW, chartH + 10, 2, 2, "S");
        pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
        pdf.text("Impact by Severity", margin + 4, y + 6);
        const sevImg = chartSevEl.toDataURL("image/png", 1.0);
        pdf.addImage(sevImg, "PNG", margin + 2, y + 9, halfW - 4, chartH);

        const catX = margin + halfW + 4;
        pdf.setFillColor(250, 250, 252);
        pdf.roundedRect(catX, y, halfW, chartH + 10, 2, 2, "F");
        pdf.setDrawColor(...PW.line); pdf.roundedRect(catX, y, halfW, chartH + 10, 2, 2, "S");
        pdf.setFontSize(8); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
        pdf.text("Category Breakdown", catX + 4, y + 6);
        const catImg = chartCatEl.toDataURL("image/png", 1.0);
        pdf.addImage(catImg, "PNG", catX + 2, y + 9, halfW - 4, chartH);

        y += chartH + 14;
      }

      /* ── Executive Summary ── */
      y += 4;
      pdf.setFillColor(...PW.orange);
      pdf.rect(margin, y, 2.5, 6, "F");
      pdf.setFontSize(11); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
      pdf.text("Executive Summary", margin + 6, y + 5);
      y += 10;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(...PW.gray);
      const summaryLines = pdf.splitTextToSize(scan.summary || "No summary available.", usable - 4);
      summaryLines.forEach((line) => {
        checkPage(5);
        pdf.text(line, margin + 2, y);
        y += 4;
      });

      addFooter();

      /* ── PAGE 2+ : Impacts Table ────────────────────────────── */
      pdf.addPage();
      y = 18;
      pdf.setFillColor(...PW.orange);
      pdf.rect(0, 0, W, 4, "F");

      pdf.setFillColor(...PW.orange);
      pdf.rect(margin, y, 2.5, 6, "F");
      pdf.setFontSize(13); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
      pdf.text("Detailed Component Inventory", margin + 6, y + 5);
      y += 12;

      const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
      const sorted = [...impacts].sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5));

      pdf.autoTable({
        startY: y,
        head: [["#", "Component / Change", "Severity", "Category", "Status"]],
        body: sorted.map((imp, i) => [
          `IMP-${String(imp.id).padStart(4, "0")}`,
          (imp.release_change || "Untitled").substring(0, 55),
          (imp.severity || "Info").toUpperCase(),
          imp.category || "—",
          imp.is_resolved ? "Resolved" : "Open",
        ]),
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [229, 231, 235], lineWidth: 0.25, textColor: PW.gray, font: "helvetica" },
        headStyles: { fillColor: PW.orange, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7.5, halign: "left" },
        columnStyles: {
          0: { cellWidth: 18, fontStyle: "bold", textColor: PW.black },
          1: { cellWidth: 62 },
          2: { cellWidth: 18, halign: "center" },
          3: { cellWidth: 35 },
          4: { cellWidth: 18, halign: "center" },
        },
        alternateRowStyles: { fillColor: [250, 250, 252] },
        margin: { left: margin, right: margin },
        didParseCell: function (data) {
          if (data.section === "body" && data.column.index === 2) {
            const sev = data.cell.raw;
            const cmap = { CRITICAL: [220, 38, 38], HIGH: [234, 88, 12], MEDIUM: [202, 138, 4], LOW: [22, 163, 106], INFO: [79, 70, 229] };
            data.cell.styles.textColor = cmap[sev] || PW.gray;
            data.cell.styles.fontStyle = "bold";
          }
          if (data.section === "body" && data.column.index === 4) {
            data.cell.styles.textColor = data.cell.raw === "Resolved" ? [22, 163, 106] : [234, 88, 12];
            data.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: function () { addFooter(); pdf.setFillColor(...PW.orange); pdf.rect(0, 0, W, 4, "F"); },
      });

      /* ── Detailed impact pages ──────────────────────────────── */
      sorted.forEach((imp, idx) => {
        pdf.addPage();
        let iy = 18;
        pdf.setFillColor(...PW.orange); pdf.rect(0, 0, W, 4, "F");

        const impId = `IMP-${String(imp.id).padStart(4, "0")}`;
        const sev = (imp.severity || "Info").toUpperCase();
        const sevRgb = hexToRgb(sevColor(imp.severity));

        pdf.setFillColor(...sevRgb); pdf.roundedRect(margin, iy, 20, 6, 1, 1, "F");
        pdf.setFontSize(7); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.white);
        pdf.text(sev, margin + 10, iy + 4.2, { align: "center" });

        pdf.setFontSize(7); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...PW.light);
        pdf.text(impId, margin + 23, iy + 4.2);

        pdf.setFontSize(7); pdf.setTextColor(imp.is_resolved ? [22, 163, 106] : [234, 88, 12]); pdf.setFont("helvetica", "bold");
        pdf.text(imp.is_resolved ? "\u2713 RESOLVED" : "\u25CF OPEN", W - margin, iy + 4.2, { align: "right" });

        iy += 12;
        pdf.setFontSize(12); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
        const titleLines = pdf.splitTextToSize(imp.release_change || "Untitled", usable);
        titleLines.forEach((l) => { pdf.text(l, margin, iy); iy += 5.5; });

        if (imp.category) {
          pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...PW.light);
          pdf.text(`Category: ${imp.category}`, margin, iy); iy += 5;
        }

        /* Analysis */
        iy += 3;
        pdf.setFillColor(...PW.orange); pdf.rect(margin, iy, 2, 5, "F");
        pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
        pdf.text("Detailed Analysis", margin + 5, iy + 4);
        iy += 9;
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(...PW.gray);
        const descLines = pdf.splitTextToSize(imp.description || "No details available.", usable - 4);
        descLines.forEach((l) => { checkPage(5); pdf.text(l, margin + 2, iy); iy += 4; });

        /* Affected components */
        const comps = imp.affected_components || [];
        if (comps.length) {
          iy += 4; checkPage(14);
          pdf.setFillColor(...PW.orange); pdf.rect(margin, iy, 2, 5, "F");
          pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
          pdf.text("Affected Components", margin + 5, iy + 4);
          iy += 9;
          let cx = margin + 2;
          comps.forEach((c) => {
            const tw = pdf.getStringUnitWidth(c) * 7.5 / pdf.internal.scaleFactor + 6;
            if (cx + tw > W - margin) { cx = margin + 2; iy += 6; checkPage(8); }
            pdf.setFillColor(255, 244, 237); pdf.setDrawColor(208, 74, 2);
            pdf.roundedRect(cx, iy - 2.5, tw, 5.5, 1.2, 1.2, "FD");
            pdf.setFontSize(7.5); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...PW.orange);
            pdf.text(c, cx + 3, iy + 1);
            cx += tw + 2;
          });
          iy += 8;
        }

        /* Remediation steps */
        iy += 4; checkPage(14);
        pdf.setFillColor(...PW.orange); pdf.rect(margin, iy, 2, 5, "F");
        pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.black);
        pdf.text("Remediation Steps", margin + 5, iy + 4);
        iy += 10;

        const remedSteps = parseRemedSteps(imp.remediation || "");
        if (remedSteps.length === 0) {
          pdf.setFont("helvetica", "italic"); pdf.setFontSize(8.5); pdf.setTextColor(...PW.light);
          pdf.text("No remediation steps provided.", margin + 2, iy); iy += 5;
        } else {
          remedSteps.forEach((step, si) => {
            checkPage(12);
            pdf.setFillColor(...PW.orange);
            pdf.circle(margin + 4, iy + 0.8, 2.5, "F");
            pdf.setFontSize(7); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...PW.white);
            pdf.text(String(si + 1), margin + 4, iy + 1.5, { align: "center" });

            pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(...PW.gray);
            const stepLines = pdf.splitTextToSize(step, usable - 14);
            stepLines.forEach((l, li) => {
              pdf.text(l, margin + 10, iy + 1.5);
              iy += 4;
            });
            iy += 2;
          });
        }

        addFooter();
      });

      const filename = `Impact-Report-${scan.release_name.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);
      toast("PDF report downloaded!", "success");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast("Failed to generate PDF: " + err.message, "error");
    }
  };

  function parseRemedSteps(raw) {
    if (!raw) return [];
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const stepPattern = /^(?:\d+[\.\)\:]|Step\s+\d+|[-•])\s*/i;
    const steps = [];
    let current = "";
    for (const line of lines) {
      if (stepPattern.test(line)) {
        if (current) steps.push(current);
        current = line.replace(stepPattern, "").trim();
      } else if (current) {
        current += " " + line;
      } else {
        current = line;
      }
    }
    if (current) steps.push(current);
    if (steps.length <= 1) {
      const fallback = raw.split(/\d+[\.\)]\s*/).filter(Boolean).map((s) => s.trim()).filter(Boolean);
      if (fallback.length > 1) return fallback;
    }
    return steps.length > 0 ? steps : [raw];
  }

  /* ── Utility ─────────────────────────────────────────────────── */
  function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

  function formatRemediation(raw) {
    if (!raw) return '<span style="color:var(--text-3)">No remediation steps provided.</span>';
    const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const stepPattern = /^(?:\d+[\.\)\:]|Step\s+\d+|[-•])\s*/i;
    const steps = [];
    let current = "";
    for (const line of lines) {
      if (stepPattern.test(line)) {
        if (current) steps.push(current);
        current = line.replace(stepPattern, "").trim();
      } else if (current) {
        current += " " + line;
      } else {
        current = line;
      }
    }
    if (current) steps.push(current);
    if (steps.length <= 1) {
      const fallback = raw.split(/\d+[\.\)]\s*/).filter(Boolean).map((s) => s.trim()).filter(Boolean);
      if (fallback.length > 1) return '<ol class="remed-list">' + fallback.map((s) => `<li>${esc(s)}</li>`).join("") + "</ol>";
      return `<p>${esc(raw)}</p>`;
    }
    return '<ol class="remed-list">' + steps.map((s) => `<li>${esc(s)}</li>`).join("") + "</ol>";
  }

  /* ── Event bindings ──────────────────────────────────────────── */
  function bindEvents() {
    el.dash_new_scan_btn.addEventListener("click", () => navigate("new-scan"));
    el.qa_new_scan.addEventListener("click", () => navigate("new-scan"));
    el.qa_connect_org.addEventListener("click", () => navigate("settings"));
    el.qa_settings.addEventListener("click", () => navigate("settings"));
    el.scans_new_btn.addEventListener("click", () => navigate("new-scan"));

    el.scan_release_select.addEventListener("change", () => {
      el.start_scan_btn.disabled = !el.scan_release_select.value;
    });
    el.start_scan_btn.addEventListener("click", startAnalysis);
    el.detail_back_btn.addEventListener("click", () => navigate("scans"));
    el.export_report_btn.addEventListener("click", () => window.__exportReport());

    // Inventory filters — debounced
    let filterTimer;
    const applyFilters = () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        if (detailData) { invPage = 1; renderInventoryTable(detailData.impacts || []); }
      }, 200);
    };
    el.filter_severity.addEventListener("change", applyFilters);
    el.filter_unresolved.addEventListener("change", applyFilters);
    el.inv_search.addEventListener("input", applyFilters);

    el.s_save_key_btn.addEventListener("click", async () => {
      const key = el.s_api_key.value.trim();
      if (!key) { toast("Enter an API key", "error"); return; }
      try {
        el.s_save_key_btn.disabled = true;
        el.s_save_key_btn.innerHTML = '<span class="spinner"></span>';
        await api("POST", "/api/settings/apikey", { api_key: key, model: el.s_model.value });
        toast("API key saved", "success");
        el.s_api_key.value = "";
        loadSettings(); refreshTopbar();
      } catch (e) { toast(e.message, "error"); }
      finally { el.s_save_key_btn.disabled = false; el.s_save_key_btn.textContent = "Save Key"; }
    });

    el.s_remove_key_btn.addEventListener("click", async () => {
      try { await api("DELETE", "/api/settings/apikey"); toast("API key removed", "info"); loadSettings(); refreshTopbar(); } catch (e) { toast(e.message, "error"); }
    });

    el.s_model.addEventListener("change", async () => {
      try { await api("PUT", "/api/settings/model", { model: el.s_model.value }); toast("Model updated", "success"); refreshTopbar(); } catch (e) { toast(e.message, "error"); }
    });

    el.s_connect_btn.addEventListener("click", async () => {
      const alias = el.s_org_alias.value.trim() || "release-agent-org";
      const sandbox = el.s_sandbox.checked;
      try {
        el.s_connect_btn.disabled = true;
        el.s_connect_btn.innerHTML = '<span class="spinner"></span> Connecting…';
        toast("Opening Salesforce login in your browser…", "info");
        await api("POST", "/api/orgs/connect", { alias, instance_url: "https://login.salesforce.com", sandbox });
        toast("Org connected!", "success"); loadSettings(); refreshTopbar();
      } catch (e) { toast("Connection failed: " + e.message, "error"); }
      finally { el.s_connect_btn.disabled = false; el.s_connect_btn.textContent = "Connect New Org"; }
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  function startTopbarClock() {
    const el = document.getElementById("topbar-time");
    if (!el) return;
    const update = () => {
      const now = new Date();
      el.textContent = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) + "  ·  " + now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    };
    update();
    setInterval(update, 30000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    initNav();
    bindEvents();
    refreshTopbar();
    startTopbarClock();
    navigate("dashboard");
  });
})();
