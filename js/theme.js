/* ProductSnap Studio — Late Night Mode (theme toggle)
 * Dependency-free. The pre-paint inline head script already set the initial
 * data-theme on <html> (from localStorage, else system preference) so there
 * is no flash. This module wires up the toggle buttons, keeps aria-pressed +
 * the meta theme-color in sync, and persists the choice to localStorage.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "psnap-theme";
  var COLOR_LIGHT = "#f6efe1";
  var COLOR_DARK = "#1f1b16";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  }

  function syncMeta(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? COLOR_DARK : COLOR_LIGHT);
  }

  function syncToggles(theme) {
    var isDark = theme === "dark";
    var btns = document.querySelectorAll(".theme-toggle");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.setAttribute("aria-pressed", isDark ? "true" : "false");
      b.setAttribute(
        "aria-label",
        isDark ? "Late Night Mode is on. Switch to day mode." : "Switch to Late Night Mode."
      );
      var label = b.querySelector(".tt-label");
      if (label) label.textContent = isDark ? "Day Mode" : "Late Night Mode";
    }
  }

  function apply(theme, persist) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    syncMeta(theme);
    syncToggles(theme);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {}
    }
  }

  function init() {
    // Reflect the pre-paint state into the controls.
    syncToggles(currentTheme());
    syncMeta(currentTheme());

    var btns = document.querySelectorAll(".theme-toggle");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        apply(currentTheme() === "dark" ? "light" : "dark", true);
      });
    }

    // If the user has not made an explicit choice, follow system changes live.
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function (ev) {
        var stored = null;
        try {
          stored = localStorage.getItem(STORAGE_KEY);
        } catch (e) {}
        if (stored !== "dark" && stored !== "light") {
          apply(ev.matches ? "dark" : "light", false);
        }
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
