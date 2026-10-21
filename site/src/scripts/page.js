import { initCarousel } from './carousel.js';
import { initDownloads } from './downloads.js';

initCarousel();
initDownloads();

// ── Hero: pause animations when off-screen ──
const heroZoo = document.getElementById("hero-zoo");
const heroObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      heroZoo.classList.toggle("paused", !entry.isIntersecting);
    });
  },
  { threshold: 0.3 },
);
heroObserver.observe(heroZoo);

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const href = a.getAttribute("href");
    const t = href.length > 1 ? document.querySelector(href) : null;
    if (t) {
      e.preventDefault();
      t.scrollIntoView({ behavior: "smooth" });
    }
  });
});

// Copy buttons
document.querySelectorAll("pre:not(.no-copy)").forEach((pre) => {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.textContent = "Copy";
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(pre.textContent.trim()).then(() => {
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1800);
    });
  });
  pre.appendChild(btn);
});

// Tab switcher
const tabBtns = document.querySelectorAll("#depTabs .tab-btn");
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    document
      .getElementById("panel-" + btn.dataset.tab)
      .classList.add("active");
  });
});

// Animated counters
const animated = new Set();
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const num = el.querySelector(".stat-num");
      if (!num || animated.has(num)) return;
      animated.add(num);
      const target = parseInt(num.textContent);
      if (isNaN(target)) return;
      const duration = 800;
      const start = performance.now();
      function tick(now) {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        num.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(tick);
        else num.textContent = target;
      }
      requestAnimationFrame(tick);
    });
  },
  { threshold: 0.5 },
);
observer.observe(document.querySelector(".stat-row"));

// ── Top Nav ──
const NAV_TOGGLE = document.getElementById("nav-toggle");
const NAV_DRAWER = document.getElementById("nav-drawer");
const NAV_LINKS = document.querySelectorAll("[data-nav-link]");
const NAV_DL_BTN = document.getElementById("nav-dl-btn");

NAV_TOGGLE.addEventListener("click", () => {
  const open = NAV_TOGGLE.getAttribute("aria-expanded") === "true";
  NAV_TOGGLE.setAttribute("aria-expanded", !open);
  if (open) {
    NAV_DRAWER.setAttribute("hidden", "");
  } else {
    NAV_DRAWER.removeAttribute("hidden");
  }
});

NAV_LINKS.forEach((link) => {
  link.addEventListener("click", () => {
    NAV_TOGGLE.setAttribute("aria-expanded", "false");
    NAV_DRAWER.setAttribute("hidden", "");
  });
});

// Nav download button scrolls to second page
if (NAV_DL_BTN) {
  NAV_DL_BTN.addEventListener("click", () => {
    document
      .getElementById("report")
      .scrollIntoView({ behavior: "smooth" });
  });
}

// Nav color adapts to hero section
const TOP_NAV = document.getElementById("top-nav");
function updateNavTheme() {
  const heroBottom = heroZoo.getBoundingClientRect().bottom;
  TOP_NAV.classList.toggle("nav-hero", heroBottom > 60);
}
window.addEventListener("scroll", updateNavTheme, { passive: true });
updateNavTheme();

// ── Scroll Reveal ──
(function initReveal() {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;

  const reduceMotion = matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const hasIO = typeof IntersectionObserver !== "undefined";

  // Degradation: show everything immediately
  if (reduceMotion || !hasIO) {
    els.forEach((el) => el.classList.add("reveal-visible"));
    return;
  }

  // Hide elements first (JS is running, safe to hide)
  els.forEach((el) => el.classList.add("reveal-init"));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.05, rootMargin: "0px 0px -10% 0px" },
  );

  els.forEach((el) => io.observe(el));
})();

// ── Mock card star randomization: 5 filled, 7 hollow ──
(() => {
  const stars = document.querySelectorAll(".m-card-grid .m-card-star");
  if (!stars.length) return;
  const indices = Array.from({ length: stars.length }, (_, i) => i);
  // Fisher-Yates shuffle, take first 5
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const filled = new Set(indices.slice(0, 5));
  stars.forEach((el, i) => {
    if (filled.has(i)) {
      el.classList.add("filled");
    } else {
      el.textContent = "☆"; // ☆ hollow
    }
  });
})();
