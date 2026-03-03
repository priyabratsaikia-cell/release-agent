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
      "page-title", "tb-model", "tb-org", "sidebar-status",
      "dash-stats", "dash-recent-scans", "dash-new-scan-btn",
      "qa-new-scan", "qa-connect-org", "qa-settings",
      "scans-list", "scans-new-btn",
      "scan-release-select", "start-scan-btn", "scan-progress",
      "scan-progress-fill", "scan-progress-pct", "scan-log", "pipeline",
      "detail-back-btn", "detail-header", "detail-stats",
      "detail-summary", "detail-impacts", "impacts-title",
      "filter-severity", "filter-unresolved",
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

    const titles = { dashboard: "Dashboard", scans: "Scans & Reports", "new-scan": "New Scan", "scan-detail": "Scan Detail", settings: "Settings" };
    el.page_title.textContent = titles[page] || page;

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
      el.dash_stats.innerHTML = [
        statCard(s.total_scans, "Total Scans", "accent"),
        statCard(s.completed_scans, "Completed", "success"),
        statCard(s.total_impacts, "Total Impacts", "info"),
        statCard(s.critical_unresolved, "Critical Open", "danger"),
        statCard(s.resolved_impacts, "Resolved", "success"),
        statCard(s.connected_orgs, "Connected Orgs", "accent"),
      ].join("");

      if (d.recent_scans.length === 0) {
        el.dash_recent_scans.innerHTML = '<div class="empty-state"><p>No scans yet. Run your first analysis!</p></div>';
      } else {
        el.dash_recent_scans.innerHTML = buildScanTable(d.recent_scans);
        bindScanTableClicks(el.dash_recent_scans);
      }
    } catch (e) { toast("Failed to load dashboard: " + e.message, "error"); }
  }

  function statCard(n, label, cls) {
    return `<div class="stat-card ${cls}"><div class="stat-number">${n}</div><div class="stat-label">${label}</div></div>`;
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
      if (n < step) { s.classList.add("done"); }
      else if (n === step) { s.classList.add(status === "error" ? "error" : "active"); }
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

  /* ── Scan Detail ─────────────────────────────────────────────── */
  let detailData = null;

  async function loadScanDetail(scanId) {
    try {
      const scan = await api("GET", `/api/scans/${scanId}`);
      detailData = scan;
      renderDetail(scan);
    } catch (e) { toast("Failed to load scan: " + e.message, "error"); }
  }

  function renderDetail(scan) {
    const date = scan.started_at ? new Date(scan.started_at + "Z").toLocaleString() : "—";
    el.detail_header.innerHTML = `
      <div>
        <div class="detail-title">${esc(scan.release_name)}</div>
        <div class="detail-meta">
          <span class="detail-tag"><span class="status-pill ${scan.status}" style="margin:0">${scan.status}</span></span>
          <span class="detail-tag">Org: ${esc(scan.org_alias)}</span>
          <span class="detail-tag">${date}</span>
          <span class="detail-tag">${scan.total_changes || 0} changes · ${scan.total_components || 0} components</span>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="window.__exportReport()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>`;

    el.detail_stats.innerHTML = [
      dsCard(scan.critical_count, "Critical", "critical"),
      dsCard(scan.high_count, "High", "high"),
      dsCard(scan.medium_count, "Medium", "medium"),
      dsCard(scan.low_count, "Low", "low"),
      dsCard(scan.info_count, "Info", "info"),
    ].join("");

    renderCharts(scan);

    el.detail_summary.innerHTML = `<h4>Executive Summary</h4>${esc(scan.summary || "No summary available.")}`;

    el.impacts_title.textContent = `Impacts (${(scan.impacts || []).length})`;
    renderImpacts(scan.impacts || []);
  }

  function dsCard(n, label, cls) {
    return `<div class="ds-card ${cls}"><div class="ds-num">${n || 0}</div><div class="ds-lbl">${label}</div></div>`;
  }

  function renderCharts(scan) {
    if (sevChart) sevChart.destroy();
    if (catChart) catChart.destroy();

    const sevData = [scan.critical_count || 0, scan.high_count || 0, scan.medium_count || 0, scan.low_count || 0, scan.info_count || 0];
    const sevLabels = ["Critical", "High", "Medium", "Low", "Info"];
    const sevColors = ["#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#4F46E5"];

    sevChart = new Chart(document.getElementById("chart-severity"), {
      type: "doughnut",
      data: { labels: sevLabels, datasets: [{ data: sevData, backgroundColor: sevColors, borderWidth: 2, borderColor: "#FFFFFF", hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { color: "#4B5563", font: { size: 11, family: "Inter" }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } },
        },
        cutout: "65%",
      },
    });

    const impacts = scan.impacts || [];
    const catMap = {};
    impacts.forEach((imp) => { const c = imp.category || "Other"; catMap[c] = (catMap[c] || 0) + 1; });
    const catLabels = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]);
    const catData = catLabels.map((c) => catMap[c]);

    catChart = new Chart(document.getElementById("chart-category"), {
      type: "bar",
      data: {
        labels: catLabels,
        datasets: [{ data: catData, backgroundColor: "rgba(208,74,2,.65)", borderRadius: 4, barThickness: 18 }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "rgba(0,0,0,.05)" }, ticks: { color: "#9CA3AF", font: { size: 10 } } },
          y: { grid: { display: false }, ticks: { color: "#4B5563", font: { size: 11, family: "Inter" } } },
        },
      },
    });
  }

  function renderImpacts(impacts) {
    const sevFilter = el.filter_severity.value;
    const unresolvedOnly = el.filter_unresolved.checked;

    let filtered = impacts;
    if (sevFilter) filtered = filtered.filter((i) => i.severity === sevFilter);
    if (unresolvedOnly) filtered = filtered.filter((i) => !i.is_resolved);

    if (filtered.length === 0) {
      el.detail_impacts.innerHTML = '<div class="empty-state"><p>No impacts match your filter.</p></div>';
      return;
    }

    el.detail_impacts.innerHTML = filtered.map((imp) => {
      const sev = (imp.severity || "info").toLowerCase();
      const comps = (imp.affected_components || []).map((c) => `<span class="comp-tag">${esc(c)}</span>`).join("");
      const resolved = imp.is_resolved;
      return `<div class="impact-item${resolved ? " resolved-item" : ""}" data-impact-id="${imp.id}">
        <div class="impact-head">
          <span class="sev-badge ${sev}">${sev}</span>
          <span class="impact-title">${esc(imp.release_change || "Untitled")}</span>
          <span class="impact-cat">${esc(imp.category || "")}</span>
          <svg class="impact-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="impact-body">
          <div class="ib-section"><div class="ib-label">Description</div><div class="ib-text">${esc(imp.description || "—")}</div></div>
          ${comps ? `<div class="ib-section"><div class="ib-label">Affected Components</div><div class="comp-tags">${comps}</div></div>` : ""}
          ${imp.remediation ? `<div class="ib-section"><div class="ib-label">Remediation Steps</div><div class="remed-box">${esc(imp.remediation)}</div></div>` : ""}
          <div class="impact-actions">
            <button class="btn btn-sm btn-autofix" disabled title="Coming soon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z"/></svg>
              Auto Fix with Agent
            </button>
            <button class="btn btn-sm btn-resolve${resolved ? " resolved" : ""}" data-impact-id="${imp.id}" data-resolved="${resolved ? 1 : 0}">
              ${resolved ? "✓ Resolved" : "Mark as Resolved"}
            </button>
          </div>
        </div>
      </div>`;
    }).join("");

    $$(".impact-head", el.detail_impacts).forEach((h) => {
      h.addEventListener("click", () => h.closest(".impact-item").classList.toggle("open"));
    });

    $$(".btn-resolve", el.detail_impacts).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.impactId;
        const isResolved = btn.dataset.resolved === "1";
        try {
          await api("POST", `/api/impacts/${id}/${isResolved ? "unresolve" : "resolve"}`);
          const scan = await api("GET", `/api/scans/${detailData.id}`);
          detailData = scan;
          renderImpacts(scan.impacts || []);
          toast(isResolved ? "Marked as unresolved" : "Marked as resolved", "success");
        } catch (e) { toast(e.message, "error"); }
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
            <div class="org-row-info">
              <strong>${esc(org.alias)}</strong>
              <span>${esc(org.username || "")} · ${esc(org.instance_url || "")}</span>
            </div>
            <button class="btn btn-ghost btn-sm btn-danger-text btn-remove-org" data-id="${org.id}">Remove</button>
          </div>`).join("");
        $$(".btn-remove-org", el.s_org_list).forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await api("DELETE", `/api/orgs/${btn.dataset.id}`);
              toast("Org removed", "info");
              loadSettings();
              refreshTopbar();
            } catch (e) { toast(e.message, "error"); }
          });
        });
      }
    } catch {}
  }

  /* ── Topbar / Sidebar status refresh ─────────────────────────── */
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
      if (o.orgs.length > 0) {
        const org = o.orgs[0];
        dot.className = "conn-dot connected";
        label.textContent = org.username || org.alias;
        tbDot.className = "conn-dot connected";
        tbDot.style.width = "7px"; tbDot.style.height = "7px";
        tbLabel.textContent = org.username || org.alias;
      } else {
        dot.className = "conn-dot disconnected";
        label.textContent = "No org connected";
        tbDot.className = "conn-dot disconnected";
        tbDot.style.width = "7px"; tbDot.style.height = "7px";
        tbLabel.textContent = "Not connected";
      }
    } catch {}
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.__exportReport = function () {
    const panel = document.getElementById("page-scan-detail");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Impact Report — PwC Release Agent</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      <style>body{background:#F4F5F7;color:#1A1A2E;font-family:Inter,sans-serif;padding:2rem;max-width:1000px;margin:0 auto}
      .hidden{display:block!important}.page{display:block!important}.btn-back,.impact-actions,.impact-filters,.topbar,.sidebar,.btn{display:none!important}
      .detail-charts{display:none}.impact-item{border:1px solid #E5E7EB;border-radius:8px;margin-bottom:8px;padding:12px;background:#fff}
      .impact-body{display:block!important;border-top:none!important}.impact-head{cursor:default}
      .sev-badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
      .sev-badge.critical{background:rgba(220,38,38,.08);color:#DC2626}
      .sev-badge.high{background:rgba(234,88,12,.08);color:#EA580C}
      .sev-badge.medium{background:rgba(202,138,4,.08);color:#CA8A04}
      .sev-badge.low{background:rgba(22,163,74,.08);color:#16A34A}
      .sev-badge.info{background:rgba(79,70,229,.08);color:#4F46E5}
      .comp-tag{background:rgba(208,74,2,.06);color:#D04A02;padding:2px 6px;border-radius:4px;font-size:11px;margin:2px;border:1px solid rgba(208,74,2,.1)}
      .remed-box{background:#F7F8FA;border:1px solid #E5E7EB;border-left:3px solid #D04A02;border-radius:6px;padding:10px;font-size:13px;white-space:pre-wrap;color:#4B5563}
      h4{font-size:13px;font-weight:700;margin-bottom:8px;color:#1A1A2E}
      </style></head><body>${panel.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `impact-report-${detailData?.id || "export"}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Report exported!", "success");
  };

  /* ── Utility ─────────────────────────────────────────────────── */
  function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

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

    el.filter_severity.addEventListener("change", () => { if (detailData) renderImpacts(detailData.impacts || []); });
    el.filter_unresolved.addEventListener("change", () => { if (detailData) renderImpacts(detailData.impacts || []); });

    el.s_save_key_btn.addEventListener("click", async () => {
      const key = el.s_api_key.value.trim();
      if (!key) { toast("Enter an API key", "error"); return; }
      try {
        el.s_save_key_btn.disabled = true;
        el.s_save_key_btn.innerHTML = '<span class="spinner"></span>';
        await api("POST", "/api/settings/apikey", { api_key: key, model: el.s_model.value });
        toast("API key saved", "success");
        el.s_api_key.value = "";
        loadSettings();
        refreshTopbar();
      } catch (e) { toast(e.message, "error"); }
      finally { el.s_save_key_btn.disabled = false; el.s_save_key_btn.textContent = "Save Key"; }
    });

    el.s_remove_key_btn.addEventListener("click", async () => {
      try {
        await api("DELETE", "/api/settings/apikey");
        toast("API key removed", "info");
        loadSettings();
        refreshTopbar();
      } catch (e) { toast(e.message, "error"); }
    });

    el.s_model.addEventListener("change", async () => {
      try {
        await api("PUT", "/api/settings/model", { model: el.s_model.value });
        toast("Model updated", "success");
        refreshTopbar();
      } catch (e) { toast(e.message, "error"); }
    });

    el.s_connect_btn.addEventListener("click", async () => {
      const alias = el.s_org_alias.value.trim() || "release-agent-org";
      const sandbox = el.s_sandbox.checked;
      try {
        el.s_connect_btn.disabled = true;
        el.s_connect_btn.innerHTML = '<span class="spinner"></span> Connecting…';
        toast("Opening Salesforce login in your browser…", "info");
        await api("POST", "/api/orgs/connect", { alias, instance_url: "https://login.salesforce.com", sandbox });
        toast("Org connected!", "success");
        loadSettings();
        refreshTopbar();
      } catch (e) { toast("Connection failed: " + e.message, "error"); }
      finally { el.s_connect_btn.disabled = false; el.s_connect_btn.textContent = "Connect New Org"; }
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    initNav();
    bindEvents();
    refreshTopbar();
    navigate("dashboard");
  });
})();
