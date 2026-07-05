(function () {
  try {
    var t = localStorage.getItem("theme") || "system";
    if (
      t === "dark" ||
      (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ) {
      document.documentElement.classList.add("dark");
    }
  } catch {}
})();
