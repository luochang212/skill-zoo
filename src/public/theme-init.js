(function () {
  try {
    var t = localStorage.getItem("theme") || "system";
    var isDark =
      t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var scheme = isDark ? "dark" : "light";

    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
    document.documentElement.style.colorScheme = scheme;
    document.querySelector('meta[name="color-scheme"]').content = scheme;
  } catch {}
})();
