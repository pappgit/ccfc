/**
 * Sperrer offentlige undersider når «under utvikling»-forsiden er aktiv.
 * Styres via CMS: sections.comingSoon (admin → Innhold → Seksjoner).
 * Admin (/admin/) og forsiden selv forblir åpne.
 */
(function () {
  var CACHE_KEYS = [
    "ccfc_site_content_v7",
    "ccfc_site_content_v6",
    "ccfc_site_content_v5",
    "ccfc_site_content_v4",
  ];
  var FLAG_KEY = "ccfc_coming_soon";
  var path = location.pathname || "/";
  if (path.indexOf("/admin") !== -1) return;

  var file = path.split("/").pop() || "";
  if (!file || file === "index.html") return;

  function enabledFromCache() {
    try {
      var flag = sessionStorage.getItem(FLAG_KEY);
      if (flag === "1") return true;
      if (flag === "0") return false;
      for (var i = 0; i < CACHE_KEYS.length; i++) {
        var raw = sessionStorage.getItem(CACHE_KEYS[i]);
        if (!raw) continue;
        var content = JSON.parse(raw);
        if (content && content.sections && typeof content.sections.comingSoon === "boolean") {
          return content.sections.comingSoon;
        }
      }
    } catch (e) {
      /* ignore */
    }
    // Default: stengt (matcher site-content.default.json)
    return true;
  }

  if (enabledFromCache()) {
    location.replace("index.html");
  }
})();
