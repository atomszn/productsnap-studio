/* One-time sheen on "Things I've built" cards as they first scroll into view. */
(function () {
  var cards = document.querySelectorAll(".pj-card");
  if (!cards.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("pj-seen"); io.unobserve(e.target); } });
  }, { threshold: 0.4 });
  cards.forEach(function (c) { io.observe(c); });
})();
