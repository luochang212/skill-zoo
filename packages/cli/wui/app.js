const state = {
  token: null,
  data: null,
  kind: "installed",
  selectedRef: null,
  selected: null,
  content: "",
  inspect: null,
  pendingPlan: null,
};

const els = {
  installedCount: document.querySelector("#installedCount"),
  archivedCount: document.querySelector("#archivedCount"),
  doctorToggle: document.querySelector("#doctorToggle"),
  doctorPanel: document.querySelector("#doctorPanel"),
  doctorClose: document.querySelector("#doctorClose"),
  doctorChecks: document.querySelector("#doctorChecks"),
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
  els.doctorPanel.addEventListener("click", (event) => {
    if (event.target === els.doctorPanel) {
      closeDoctorModal();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDoctorModal();
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
  const { status, doctor } = state.data;
  const counts = countDoctorChecks(doctor.checks);
  els.installedCount.textContent = String(status.installedCount);
  els.archivedCount.textContent = String(status.archivedCount);
  els.doctorToggle.textContent = `Doctor: ${status.doctorStatus}${counts.error ? ` (${counts.error})` : counts.warn ? ` (${counts.warn})` : ""}`;
  els.doctorToggle.className = `doctor-pill ${status.doctorStatus}`;
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
      <div class="markdown">${loading ? "<p>Loading content...</p>" : markdownToHtml(state.content || "")}</div>
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

function markdownToHtml(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let inList = false;
  let listType = null;

  if (frontmatter) {
    html.push(renderFrontmatter(frontmatter));
  }

  const closeList = () => {
    if (!inList) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    inList = false;
    listType = null;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeList();
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList || listType !== "ul") {
        closeList();
        html.push("<ul>");
        inList = true;
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList || listType !== "ol") {
        closeList();
        html.push("<ol>");
        inList = true;
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith("# ")) {
      html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (/^---+$/.test(line.trim())) {
      html.push("<hr>");
    } else if (line.startsWith(">")) {
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (line.trim() === "") {
      html.push("");
    } else {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("");
}

function splitFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontmatter: "", body: markdown };
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return { frontmatter: "", body: markdown };
  }
  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").trimStart(),
  };
}

function renderFrontmatter(frontmatter) {
  const rows = frontmatter
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const index = line.indexOf(":");
      if (index === -1) {
        return `<div class="fm-row"><span class="fm-key">meta</span><span>${escapeHtml(line)}</span></div>`;
      }
      return `
        <div class="fm-row">
          <span class="fm-key">${escapeHtml(line.slice(0, index).trim())}</span>
          <span>${inlineMarkdown(line.slice(index + 1).trim() || "-")}</span>
        </div>
      `;
    })
    .join("");
  return `
    <aside class="frontmatter">
      <div class="frontmatter-title">Frontmatter</div>
      ${rows || `<div class="fm-row"><span class="fm-key">empty</span><span>-</span></div>`}
    </aside>
  `;
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const safeHref = safeUrl(href);
    return safeHref ? `<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  return html;
}

function safeUrl(value) {
  const url = String(value).trim();
  if (/^(https?:|mailto:|#)/.test(url)) {
    return escapeAttr(url);
  }
  return "";
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
  els.refreshButton.textContent = label;
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
