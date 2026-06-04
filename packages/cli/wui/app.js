const state = {
  token: null,
  data: null,
  kind: "installed",
  selectedRef: null,
  selected: null,
  content: "",
  contentHtml: "",
  inspect: null,
  pendingPlan: null,
  doctorFixResult: null,
};

const els = {
  installedCount: document.querySelector("#installedCount"),
  archivedCount: document.querySelector("#archivedCount"),
  doctorToggle: document.querySelector("#doctorToggle"),
  doctorStatus: document.querySelector("#doctorStatus"),
  doctorLabel: document.querySelector("#doctorLabel"),
  doctorPanel: document.querySelector("#doctorPanel"),
  doctorClose: document.querySelector("#doctorClose"),
  doctorFixPreview: document.querySelector("#doctorFixPreview"),
  doctorFixRun: document.querySelector("#doctorFixRun"),
  doctorFixHost: document.querySelector("#doctorFixHost"),
  doctorChecks: document.querySelector("#doctorChecks"),
  consistencyToggle: document.querySelector("#consistencyToggle"),
  consistencyStatus: document.querySelector("#consistencyStatus"),
  consistencyLabel: document.querySelector("#consistencyLabel"),
  consistencyPanel: document.querySelector("#consistencyPanel"),
  consistencyClose: document.querySelector("#consistencyClose"),
  consistencyIssues: document.querySelector("#consistencyIssues"),
  refreshButton: document.querySelector("#refreshButton"),
  skillRows: document.querySelector("#skillRows"),
  detailPane: document.querySelector("#detailPane"),
  searchInput: document.querySelector("#searchInput"),
  segments: [...document.querySelectorAll(".segment")],
};

boot();

function boot() {
  const url = new URL(window.location.href);
  const urlToken = url.searchParams.get("token");
  if (urlToken) {
    sessionStorage.setItem("skill-zoo-wui-token", urlToken);
    url.searchParams.delete("token");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  state.token = sessionStorage.getItem("skill-zoo-wui-token");

  bindEvents();
  if (!state.token) {
    showFatal("Missing session token. Start WUI from `skill-zoo wui` and use the opened URL.");
    return;
  }
  void loadState();
}

function bindEvents() {
  els.refreshButton.addEventListener("click", async () => {
    setRefreshState("Refreshing...", true);
    try {
      await api("/api/refresh", { method: "POST" });
      await loadState();
      setRefreshState("Refreshed", true);
      toast("Refreshed local skill cache.");
      setTimeout(() => setRefreshState("Refresh", false), 1200);
    } catch (error) {
      setRefreshState("Refresh", false);
      throw error;
    }
  });
  els.doctorToggle.addEventListener("click", openDoctorModal);
  els.doctorClose.addEventListener("click", closeDoctorModal);
  els.doctorFixPreview.addEventListener("click", () => runDoctorFix(true));
  els.doctorFixRun.addEventListener("click", () => runDoctorFix(false));
  els.consistencyToggle.addEventListener("click", openConsistencyModal);
  els.consistencyClose.addEventListener("click", closeConsistencyModal);
  els.doctorPanel.addEventListener("click", (event) => {
    if (event.target === els.doctorPanel) {
      closeDoctorModal();
    }
  });
  els.consistencyPanel.addEventListener("click", (event) => {
    if (event.target === els.consistencyPanel) {
      closeConsistencyModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDoctorModal();
      closeConsistencyModal();
    }
  });
  els.searchInput.addEventListener("input", renderRows);
  for (const segment of els.segments) {
    segment.addEventListener("click", () => {
      state.kind = segment.dataset.kind;
      state.selectedRef = null;
      state.selected = null;
      state.pendingPlan = null;
      els.segments.forEach((item) => item.classList.toggle("active", item === segment));
      renderRows();
      renderDetail();
    });
  }
}

async function loadState() {
  const payload = await api("/api/state");
  state.data = payload.data;
  reconcileSelection();
  renderStatus();
  renderRows();
  if (state.selected) {
    await loadDetail(state.selected);
  } else {
    renderDetail();
  }
}

function reconcileSelection() {
  if (!state.selectedRef || !state.data) return;
  const items = currentItems();
  state.selected = items.find((item) => refFor(item) === state.selectedRef) || null;
}

function renderStatus() {
  const { status, doctor, consistency } = state.data;
  const counts = countDoctorChecks(doctor.checks);
  els.installedCount.textContent = String(status.installedCount);
  els.archivedCount.textContent = String(status.archivedCount);
  els.doctorStatus.textContent = status.doctorStatus;
  els.doctorLabel.textContent = counts.error ? `Doctor · ${counts.error} error` : counts.warn ? `Doctor · ${counts.warn} warn` : "Doctor";
  els.doctorToggle.className = `metric metric-button ${status.doctorStatus}`;
  const consistencyTotal = consistency?.summary?.total || 0;
  els.consistencyStatus.textContent = String(consistencyTotal);
  els.consistencyLabel.textContent = "Consistency";
  els.consistencyToggle.className = `metric metric-button ${status.consistencyStatus || consistency?.status || "ok"}`;
  const checks = [...doctor.checks].sort(compareDoctorChecks);
  els.doctorChecks.innerHTML = checks.length
    ? checks.map((check) => `
        <div class="check">
          <strong class="${escapeHtml(check.status)}">${escapeHtml(check.status)}</strong>
          <span>
            ${escapeHtml(check.message)}
            ${check.path ? `<small>${escapeHtml(check.path)}</small>` : ""}
          </span>
        </div>
      `).join("")
    : `<div class="check"><strong>ok</strong><span>No local Skill Zoo state found.</span></div>`;
  const issues = [...(consistency?.issues || [])].sort(compareConsistencyIssues);
  els.consistencyIssues.innerHTML = issues.length
    ? issues.map(renderConsistencyIssue).join("")
    : `<div class="check"><strong class="ok">ok</strong><span>No consistency issues detected.</span></div>`;
  renderDoctorFixResult();
}

function renderRows() {
  if (!state.data) return;
  const query = els.searchInput.value.trim().toLowerCase();
  const rows = currentItems()
    .filter((skill) => matchesSearch(skill, query))
    .map((skill) => {
      const selected = refFor(skill) === state.selectedRef ? "selected" : "";
      return `
        <tr data-row data-ref="${escapeAttr(refFor(skill))}" class="${selected}">
          <td>
            <span class="skill-name">${escapeHtml(skill.name)}</span>
            <span class="skill-desc">${escapeHtml(skill.description || skill.directory || "")}</span>
            ${state.kind === "installed" ? renderIssueBadges(skill) : ""}
          </td>
          <td>
            <span class="skill-desc">${escapeHtml(repoLabel(skill) || "unassigned")}</span>
          </td>
          <td>${renderAgents(skill.apps)}</td>
          <td>${formatDate(skill.archivedAt || skill.updatedAt)}</td>
        </tr>
      `;
    })
    .join("");

  els.skillRows.innerHTML = rows || `<tr><td colspan="4" class="empty">No ${state.kind} skills found.</td></tr>`;
  for (const row of els.skillRows.querySelectorAll("[data-row]")) {
    row.addEventListener("click", async () => {
      const ref = row.dataset.ref;
      const skill = currentItems().find((item) => refFor(item) === ref);
      if (!skill) return;
      state.selectedRef = ref;
      state.selected = skill;
      state.pendingPlan = null;
      renderRows();
      await loadDetail(skill);
    });
  }
}

async function loadDetail(skill) {
  renderDetail(true);
  const kind = state.kind === "archived" ? "archived" : "installed";
  const ref = refFor(skill);
  const [inspect, content] = await Promise.all([
    api(`/api/inspect?kind=${kind}&ref=${encodeURIComponent(ref)}`),
    api(`/api/content?kind=${kind}&ref=${encodeURIComponent(ref)}`),
  ]);
  if (state.kind !== kind || state.selectedRef !== ref) {
    return;
  }
  state.inspect = inspect.data;
  state.content = content.data.content;
  state.contentHtml = content.data.html || "";
  renderDetail();
}

function renderDetail(loading = false) {
  const skill = state.selected;
  if (!skill) {
    els.detailPane.innerHTML = `
      <div class="empty-detail">
        <p class="eyebrow">No selection</p>
        <h2>Select a skill</h2>
        <p>Choose an installed or archived skill to inspect local metadata and SKILL.md.</p>
      </div>
    `;
    return;
  }

  const archived = state.kind === "archived";
  els.detailPane.innerHTML = `
    <div class="detail-header">
      <p class="eyebrow">${archived ? "Archived skill" : "Installed skill"}</p>
      <h2>${escapeHtml(skill.name)}</h2>
      <p class="empty">${escapeHtml(skill.description || "No description.")}</p>
      ${renderAgents(skill.apps)}
      ${!archived ? renderIssueBadges(skill) : ""}
    </div>

    <div class="meta-grid">
      <span class="meta-key">ID</span><span class="meta-value">${escapeHtml(refFor(skill))}</span>
      <span class="meta-key">Directory</span><span class="meta-value">${escapeHtml(skill.directory)}</span>
      <span class="meta-key">Origin</span><span class="meta-value">${escapeHtml(skill.origin || "unknown")}</span>
      <span class="meta-key">Home path</span><span class="meta-value">${escapeHtml(skill.homePath || "-")}</span>
      <span class="meta-key">Source</span><span class="meta-value">${escapeHtml(sourceLabel(skill))}</span>
    </div>

    <div class="action-row">
      ${
        archived
          ? `<button class="button primary" id="planRestore" type="button">Preview restore</button>`
          : `<button class="button danger" id="planArchive" type="button">Preview archive</button>`
      }
    </div>

    <div id="planHost">${renderPlan()}</div>

    <section class="preview">
      <div class="preview-title">
        <span>SKILL.md</span>
        <span>${loading ? "Loading" : contentStats(state.content)}</span>
      </div>
      <div class="markdown">${loading ? "<p>Loading content...</p>" : state.contentHtml || "<p>No content.</p>"}</div>
    </section>
  `;

  const planArchive = document.querySelector("#planArchive");
  const planRestore = document.querySelector("#planRestore");
  planArchive?.addEventListener("click", () => previewArchive(skill));
  planRestore?.addEventListener("click", () => previewRestore(skill));
  bindPlanButtons();
}

function renderPlan() {
  if (!state.pendingPlan) return "";
  const { type, result } = state.pendingPlan;
  const changes = result.changes || result.data?.changes || [];
  const failed = result.data?.failed || [];
  return `
    <div class="plan">
      <h3>${type === "archive" ? "Archive preview" : "Restore preview"}</h3>
      ${
        failed.length
          ? `<p class="empty">${escapeHtml(failed.map((item) => `${item.ref}: ${item.error}`).join("; "))}</p>`
          : `<p class="empty">Review planned filesystem changes before executing.</p>`
      }
      <div class="changes">${changes.length ? changes.map(formatChange).join("<br>") : "No changes."}</div>
      <div class="action-row">
        <button class="button primary" id="executePlan" type="button" ${failed.length ? "disabled" : ""}>Execute</button>
        <button class="button ghost" id="cancelPlan" type="button">Cancel</button>
      </div>
    </div>
  `;
}

function bindPlanButtons() {
  document.querySelector("#cancelPlan")?.addEventListener("click", () => {
    state.pendingPlan = null;
    renderDetail();
  });
  document.querySelector("#executePlan")?.addEventListener("click", executePlan);
}

async function previewArchive(skill) {
  const result = await api("/api/archive", {
    method: "POST",
    body: { refs: [refFor(skill)], dryRun: true },
    allowError: true,
  });
  state.pendingPlan = { type: "archive", result };
  renderDetail();
}

async function previewRestore(skill) {
  const result = await api("/api/restore", {
    method: "POST",
    body: { archiveIds: [refFor(skill)], dryRun: true },
    allowError: true,
  });
  state.pendingPlan = { type: "restore", result };
  renderDetail();
}

async function executePlan() {
  if (!state.pendingPlan || !state.selected) return;
  const type = state.pendingPlan.type;
  if (type === "archive") {
    await api("/api/archive", {
      method: "POST",
      body: { refs: [refFor(state.selected)], dryRun: false },
    });
    state.kind = "archived";
  } else {
    await api("/api/restore", {
      method: "POST",
      body: { archiveIds: [refFor(state.selected)], dryRun: false },
    });
    state.kind = "installed";
  }
  state.selected = null;
  state.selectedRef = null;
  state.pendingPlan = null;
  els.segments.forEach((segment) => segment.classList.toggle("active", segment.dataset.kind === state.kind));
  await loadState();
  toast(`${type === "archive" ? "Archived" : "Restored"} skill.`);
}

async function runDoctorFix(dryRun) {
  els.doctorFixPreview.disabled = true;
  els.doctorFixRun.disabled = true;
  try {
    const result = await api("/api/doctor/fix", {
      method: "POST",
      body: { dryRun },
    });
    state.doctorFixResult = result.data;
    await loadState();
    toast(dryRun ? "Prepared doctor fix preview." : "Ran doctor fix.");
  } finally {
    els.doctorFixPreview.disabled = false;
    els.doctorFixRun.disabled = false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "x-skill-zoo-token": state.token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || (!payload.ok && !options.allowError)) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function currentItems() {
  return state.kind === "archived" ? state.data.archived : state.data.installed;
}

function refFor(skill) {
  return state.kind === "archived" ? skill.archiveId : skill.id;
}

function matchesSearch(skill, query) {
  if (!query) return true;
  return [skill.name, skill.description, skill.directory, skill.repoOwner, skill.repoName, skill.id, skill.archiveId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function repoLabel(skill) {
  if (skill.repoOwner && skill.repoName) return `${skill.repoOwner}/${skill.repoName}`;
  return "";
}

function renderAgents(apps) {
  const agents = Object.entries(apps || {})
    .filter(([, enabled]) => enabled)
    .map(([agent]) => `<span class="badge">${escapeHtml(agent)}</span>`)
    .join("");
  return `<div class="badge-row">${agents || `<span class="badge">no agents</span>`}</div>`;
}

function renderIssueBadges(skill) {
  const issues = consistencyIssuesForSkill(skill);
  if (!issues.length) return "";
  const badges = issues
    .map((issue) => `<span class="badge issue-badge ${escapeAttr(issue.kind)}">${escapeHtml(issue.kind)}</span>`)
    .join("");
  return `<div class="badge-row issue-badges">${badges}</div>`;
}

function consistencyIssuesForSkill(skill) {
  const issues = state.data?.consistency?.issues || [];
  return issues.filter((issue) => issue.skills?.some((item) => item.id === skill.id));
}

function sourceLabel(skill) {
  if (skill.sourceUrl) return skill.sourceUrl;
  if (skill.repoOwner && skill.repoName) return `${skill.repoOwner}/${skill.repoName}`;
  return "-";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleDateString();
}

function formatChange(change) {
  const target = change.target ? ` -> ${change.target}` : "";
  return escapeHtml(`${change.action}: ${change.path}${target}`);
}

function countDoctorChecks(checks) {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    },
    { ok: 0, warn: 0, error: 0 },
  );
}

function compareDoctorChecks(left, right) {
  const rank = { error: 0, warn: 1, ok: 2 };
  return (rank[left.status] ?? 3) - (rank[right.status] ?? 3);
}

function compareConsistencyIssues(left, right) {
  const rank = { conflict: 0, duplicate: 1, mismatch: 2 };
  return (rank[left.kind] ?? 3) - (rank[right.kind] ?? 3) || left.name.localeCompare(right.name);
}

function renderConsistencyIssue(issue) {
  const paths = (issue.skills || [])
    .map((skill) => {
      const source = skill.homePath || skill.directory || skill.id;
      const label = `${skill.origin || "unknown"} · ${skill.id}`;
      return `<span>${escapeHtml(label)}<br>${escapeHtml(source)}</span>`;
    })
    .join("");
  return `
    <article class="issue-card">
      <header>
        <span class="issue-title">${escapeHtml(issue.name)}</span>
        <span class="issue-kind">${escapeHtml(issue.kind)}</span>
      </header>
      <p>${escapeHtml(issue.message)}</p>
      <p>${escapeHtml(issue.recommendation)}</p>
      <div class="issue-paths">${paths || "<span>No paths.</span>"}</div>
    </article>
  `;
}

function renderDoctorFixResult() {
  if (!state.doctorFixResult) {
    els.doctorFixHost.innerHTML = "";
    return;
  }

  const result = state.doctorFixResult;
  const actions = result.actions || [];
  els.doctorFixHost.innerHTML = `
    <div class="fix-result">
      <h3>${result.dryRun ? "Fix preview" : "Fix result"}</h3>
      <p class="empty-text">Before: ${escapeHtml(result.before?.status || "-")} · After: ${escapeHtml(result.after?.status || "-")}</p>
      <div class="fix-actions">
        ${
          actions.length
            ? actions.map((action) => {
                const target = action.target ? ` -> ${action.target}` : "";
                const error = action.error ? ` (${action.error})` : "";
                return `<span>${escapeHtml(`${action.status}: ${action.kind}: ${action.path || "-"}${target}${error}`)}</span>`;
              }).join("")
            : "<span>No low-risk fixes available.</span>"
        }
      </div>
    </div>
  `;
}

function contentStats(content) {
  if (!content) return "Read only";
  const lines = content.split(/\r?\n/).length;
  return `${lines} lines · Read only`;
}

function toast(message) {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function setRefreshState(label, disabled) {
  els.refreshButton.querySelector("span").textContent = disabled ? "…" : "↻";
  els.refreshButton.setAttribute("aria-label", label);
  els.refreshButton.title = label;
  els.refreshButton.disabled = disabled;
  els.refreshButton.classList.toggle("loading", disabled);
}

function openDoctorModal() {
  els.doctorPanel.classList.remove("hidden");
  els.doctorPanel.setAttribute("aria-hidden", "false");
}

function closeDoctorModal() {
  els.doctorPanel.classList.add("hidden");
  els.doctorPanel.setAttribute("aria-hidden", "true");
}

function openConsistencyModal() {
  els.consistencyPanel.classList.remove("hidden");
  els.consistencyPanel.setAttribute("aria-hidden", "false");
}

function closeConsistencyModal() {
  els.consistencyPanel.classList.add("hidden");
  els.consistencyPanel.setAttribute("aria-hidden", "true");
}

function showFatal(message) {
  els.skillRows.innerHTML = `<tr><td colspan="4" class="empty">${escapeHtml(message)}</td></tr>`;
  els.detailPane.innerHTML = `<div class="empty-detail"><h2>Cannot start WUI</h2><p>${escapeHtml(message)}</p></div>`;
}

window.addEventListener("unhandledrejection", (event) => {
  toast(event.reason?.message || String(event.reason));
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
