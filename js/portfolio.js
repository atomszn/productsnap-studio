/* "Copy my email" chips: the address is assembled here (not sitting in the HTML),
   copied to the clipboard with a small "Copied!" moment, or opened as mailto if
   the clipboard isn't available. */
(function () {
  "use strict";
  document.querySelectorAll(".pf-mail").forEach(function (a) {
    var addr = a.getAttribute("data-u") + "@" + a.getAttribute("data-d");
    a.href = "mailto:" + addr;
    a.title = addr;
    var live = document.createElement("span"); live.className = "sr-only"; live.setAttribute("role", "status"); a.appendChild(live);
    a.addEventListener("click", function (e) {
      if (!navigator.clipboard || !window.isSecureContext) return; /* fall through to mailto */
      e.preventDefault();
      navigator.clipboard.writeText(addr).then(function () {
        a.classList.remove("is-copied"); void a.offsetWidth; a.classList.add("is-copied");
        live.textContent = "Email address copied: " + addr;
        clearTimeout(a._t); a._t = setTimeout(function () { a.classList.remove("is-copied"); live.textContent = ""; }, 1800);
      }, function () { location.href = "mailto:" + addr; });
    });
  });
})();
