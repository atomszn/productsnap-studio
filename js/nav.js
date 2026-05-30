/* ProductSnap Studio — unified mobile navigation
 * Dependency-free. Toggles the mobile nav panel for the shared header.
 * Behavior: opens on button click; closes on link selection, outside click,
 * and Escape; keeps aria-expanded in sync; manages focus and the [hidden] attr.
 */
(function () {
  "use strict";

  function init() {
    var toggle = document.getElementById("nav-toggle");
    var panel = document.getElementById("nav-panel");
    if (!toggle || !panel) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    function open() {
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
      panel.hidden = false;
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("click", onOutsideClick, true);
    }

    function close(returnFocus) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      panel.hidden = true;
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("click", onOutsideClick, true);
      if (returnFocus) toggle.focus();
    }

    function onKeydown(e) {
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        close(true);
      }
    }

    function onOutsideClick(e) {
      if (!panel.contains(e.target) && !toggle.contains(e.target)) {
        close(false);
      }
    }

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isOpen()) {
        close(false);
      } else {
        open();
      }
    });

    // Close when a route is selected.
    panel.addEventListener("click", function (e) {
      var link = e.target.closest("a");
      if (link) close(false);
    });

    // If viewport grows past the mobile breakpoint, reset to a clean state.
    var mq = window.matchMedia("(min-width: 761px)");
    function handleMq(ev) {
      if (ev.matches && isOpen()) close(false);
    }
    if (mq.addEventListener) {
      mq.addEventListener("change", handleMq);
    } else if (mq.addListener) {
      mq.addListener(handleMq);
    }

    // Ensure starting state is closed/hidden.
    close(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
