import { basePath } from '../lib/paths';

export function initDownloads() {
  const labels = JSON.parse(document.getElementById("install-messages").textContent);
  // ── Download + Install Modal ──
  const REPO = "luochang212/skill-zoo";
  const DL_BTN = document.getElementById("dl-btn");
  const MODAL = document.getElementById("install-modal");
  const MODAL_CLOSE = document.getElementById("modal-close");
  const OS_TABS = document.getElementById("os-tabs");
  const DL_FILENAME = document.getElementById("dl-filename");
  const DL_MANUAL = document.getElementById("dl-manual");
  const MODAL_STEPS = document.getElementById("modal-steps");
  const MODAL_ALT = document.getElementById("modal-alt");
  const PLATFORM_SPAN = document.getElementById("dl-platform");

  let cachedVersion = null;
  let downloadURL = null;

  function detectOS() {
    const ua = navigator.userAgent || "";
    if (ua.includes("Mac") || ua.includes("macOS")) return "macos";
    if (ua.includes("Windows") || ua.includes("Win")) return "windows";
    if (ua.includes("Linux") || ua.includes("X11")) return "linux";
    return "macos";
  }

  function detectLinuxArch() {
    const ua = `${navigator.userAgent || ""} ${navigator.platform || ""}`;
    return /aarch64|arm64/i.test(ua) ? "aarch64" : "x86_64";
  }

  async function fetchVersion() {
    try {
      const res = await fetch(basePath + "version.json");
      if (!res.ok) return null;
      const data = await res.json();
      return data.version || null;
    } catch (_) {
      return null;
    }
  }

  const RELEASES_URL = `https://github.com/${REPO}/releases`;

  function getDownloadUrl(os, version) {
    const v = version || cachedVersion;
    // Never fabricate an asset URL for an unknown version; send the user
    // to the releases list instead.
    if (!v) return RELEASES_URL;
    const base = `https://github.com/${REPO}/releases/download/${v}`;
    if (os === "macos") return `${base}/Skill-Zoo-${v}-macOS.dmg`;
    if (os === "linux")
      return `${base}/Skill-Zoo-${v}-Linux-${detectLinuxArch()}.AppImage`;
    return `${base}/Skill-Zoo-${v}-Windows.exe`;
  }

  function getPortableUrl(version) {
    const v = version || cachedVersion;
    if (!v) return RELEASES_URL;
    return `https://github.com/${REPO}/releases/download/${v}/Skill-Zoo-${v}-Windows-Portable.zip`;
  }

  function getFilename(os, version) {
    const v = version || cachedVersion;
    const tag = v ? `${v}-` : "";
    if (os === "macos") return `Skill-Zoo-${tag}macOS.dmg`;
    if (os === "linux")
      return `Skill-Zoo-${tag}Linux-${detectLinuxArch()}.AppImage`;
    return `Skill-Zoo-${tag}Windows.exe`;
  }

  function getLinuxPackageUrl(version, arch, ext) {
    const v = version || cachedVersion;
    if (!v) return RELEASES_URL;
    return `https://github.com/${REPO}/releases/download/${v}/Skill-Zoo-${v}-Linux-${arch}.${ext}`;
  }


  function buildStepsHTML(os) {
    if (os === "macos") {
      return [
        { key: "install-mac-step1" },
        { key: "install-mac-step2" },
        { key: "install-mac-step3" },
      ]
        .map((s, i) => {
          const text = labels[s.key] || s.key;
          return `<div class="modal-step"><div class="modal-step-num">${i + 1}</div><p>${text}</p></div>`;
        })
        .join("");
    }
    if (os === "linux") {
      return [
        { key: "install-linux-step1" },
        { key: "install-linux-step2" },
        { key: "install-linux-step3" },
      ]
        .map((s, i) => {
          const text = labels[s.key] || s.key;
          return `<div class="modal-step"><div class="modal-step-num">${i + 1}</div><p>${text}</p></div>`;
        })
        .join("");
    }
    // Windows
    return [
      { key: "install-win-step1" },
      { key: "install-win-step2" },
      { key: "install-win-step3" },
    ]
      .map((s, i) => {
        const text = labels[s.key] || s.key;
        return `<div class="modal-step"><div class="modal-step-num">${i + 1}</div><p>${text}</p></div>`;
      })
      .join("");
  }

  function buildAltHTML(os) {
    if (os === "macos") {
      const title =
        labels["install-mac-alt-title"] ||
        "Or install via Homebrew";
      return `<h4>${title}</h4><pre class="no-copy"><code>brew tap luochang212/tap && brew install --cask skill-zoo</code></pre>`;
    }
    if (os === "linux") {
      const title =
        labels["install-linux-alt-title"] ||
        "Linux download options";
      const desc =
        labels["install-linux-alt-desc"] ||
        "";
      return `<h4>${title}</h4><p style="margin:0 0 8px;">${desc}</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:13px;"><a href="${getLinuxPackageUrl(cachedVersion, "x86_64", "AppImage")}" style="color:var(--copper);">x86_64 AppImage</a><a href="${getLinuxPackageUrl(cachedVersion, "x86_64", "deb")}" style="color:var(--copper);">x86_64 .deb</a><a href="${getLinuxPackageUrl(cachedVersion, "aarch64", "AppImage")}" style="color:var(--copper);">ARM64 AppImage</a><a href="${getLinuxPackageUrl(cachedVersion, "aarch64", "deb")}" style="color:var(--copper);">ARM64 .deb</a></div>`;
    }
    const title =
      labels["install-win-alt-title"] ||
      "Or use the portable version";
    const desc =
      labels["install-win-alt-desc"] || "";
    const portableUrl = getPortableUrl(cachedVersion);
    return `<h4>${title}</h4><p style="margin:0 0 8px;">${desc}</p><a href="${portableUrl}" style="font-size:13px;color:var(--copper);">${getFilename("windows", cachedVersion).replace(".exe", "-Portable.zip")}</a>`;
  }

  function refreshModal(os) {
    // Tabs
    OS_TABS.querySelectorAll(".modal-os-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.os === os);
    });
    // Filename row
    DL_FILENAME.textContent = getFilename(os, cachedVersion);
    downloadURL = getDownloadUrl(os, cachedVersion);
    DL_MANUAL.href = downloadURL;
    // Steps
    MODAL_STEPS.innerHTML = buildStepsHTML(os);
    // Alt
    MODAL_ALT.innerHTML = buildAltHTML(os);
  }

  function openModal(os) {
    refreshModal(os);
    MODAL.removeAttribute("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    MODAL.setAttribute("hidden", "");
    document.body.style.overflow = "";
  }

  // OS tab clicks
  OS_TABS.addEventListener("click", (e) => {
    const tab = e.target.closest(".modal-os-tab");
    if (!tab) return;
    refreshModal(tab.dataset.os);
  });

  // Close on overlay click or close button
  MODAL.addEventListener("click", (e) => {
    if (e.target === MODAL) closeModal();
  });
  MODAL_CLOSE.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !MODAL.hasAttribute("hidden")) closeModal();
  });

  // Init: detect OS, pre-fetch version, update button label
  (async () => {
    const os = detectOS();
    PLATFORM_SPAN.textContent =
      os === "macos" ? "macOS" : os === "linux" ? "Linux" : "Windows";

    const v = await fetchVersion();
    if (v) cachedVersion = v;
  })();

  // Download button click
  DL_BTN.addEventListener("click", async (e) => {
    e.preventDefault();
    const os = detectOS();

    if (!cachedVersion) cachedVersion = await fetchVersion();

    downloadURL = getDownloadUrl(os, cachedVersion);
    openModal(os);

    // Auto-download only with a known version; an unknown version leaves
    // the modal's manual link on the releases list instead.
    if (downloadURL && cachedVersion) {
      const a = document.createElement("a");
      a.href = downloadURL;
      a.download = "";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });

}
