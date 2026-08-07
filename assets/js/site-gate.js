/**
 * Sperrer offentlige undersider mens forsiden er «under utvikling».
 * Admin (/admin/) og forsiden selv forblir åpne.
 */
(function () {
  var path = location.pathname || "/";
  if (path.indexOf("/admin") !== -1) return;

  var file = path.split("/").pop() || "";
  if (!file || file === "index.html") return;

  location.replace("index.html");
})();
