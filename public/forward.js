// Runs before the landing page renders. Sends app traffic that still points at "/" to "/app":
// Shortcut links (?log=, ?capture=, ?add, ?smart), old tab links (#finances) and Home Screen installs.
(function () {
  var q = location.search, h = location.hash;
  var action = /[?&](log|capture|add|smart)(=|&|$)/.test(q);
  var tab = /^#(finances|plan|inbox)$/.test(h);
  var standalone = window.matchMedia && matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (action || tab || standalone) location.replace("/app" + q + h);
})();
