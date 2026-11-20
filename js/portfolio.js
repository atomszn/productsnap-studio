/* Homepage: keep the Pulse numbers honest (read from data/shelf.json, the same list the shelf uses). */
(function () {
  "use strict";
  fetch("data/shelf.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.books || !d.books.length) return;
    var n = d.books.length, topics = {};
    d.books.forEach(function (b) { topics[b.topic] = 1; });
    document.querySelectorAll("[data-pulse-count]").forEach(function (e) { e.textContent = n; });
    document.querySelectorAll("[data-pulse-shelves]").forEach(function (e) { e.textContent = Object.keys(topics).length; });
  }).catch(function () {});
})();
