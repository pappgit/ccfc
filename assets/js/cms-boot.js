/**
 * Early CMS bootstrap — applies cached logo/favicon before the page paints
 * the hardcoded fallback, so a refresh does not flash the old logo.
 */
(function () {
  var CACHE_KEYS = [
    "ccfc_site_content_v7",
    "ccfc_site_content_v6",
    "ccfc_site_content_v5",
    "ccfc_site_content_v4",
    "ccfc_site_content_v3",
  ];

  var content = null;
  for (var i = 0; i < CACHE_KEYS.length; i++) {
    try {
      var raw = sessionStorage.getItem(CACHE_KEYS[i]);
      if (!raw) continue;
      content = JSON.parse(raw);
      if (content && typeof content === "object") break;
      content = null;
    } catch (e) {
      content = null;
    }
  }

  window.__CCFC_BOOT_CONTENT__ = content;

  function assetPath(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) || String(url).indexOf("data:") === 0) return url;
    var depth = location.pathname.indexOf("/admin") !== -1 ? "../" : "";
    if (String(url).indexOf("assets/") === 0) return depth + url;
    return url;
  }

  function bootLogoUrl() {
    var url = content && content.brand && content.brand.logoUrl;
    return url ? assetPath(String(url)) : "";
  }

  function bootFaviconUrl() {
    var url =
      (content && content.brand && content.brand.faviconUrl) ||
      (content && content.brand && content.brand.logoUrl);
    return url ? assetPath(String(url)) : "";
  }

  function applyFavicon() {
    var fav = bootFaviconUrl();
    if (!fav) return;
    var link = document.querySelector('link[rel="icon"]');
    if (link) link.setAttribute("href", fav);
  }

  function markReady(img) {
    img.classList.add("is-cms-ready");
  }

  function applyLogos(root) {
    var url = bootLogoUrl();
    if (!url) return;
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('img[data-cms-src="brand.logoUrl"]').forEach(function (img) {
      if (img.getAttribute("data-cms-boot-url") === url && img.classList.contains("is-cms-ready")) {
        return;
      }
      img.setAttribute("data-cms-boot-url", url);
      var onDone = function () {
        markReady(img);
      };
      img.addEventListener("load", onDone, { once: true });
      img.addEventListener("error", onDone, { once: true });
      if (img.getAttribute("src") !== url) {
        img.setAttribute("src", url);
      } else if (img.complete) {
        markReady(img);
      }
    });
  }

  window.__CCFC_APPLY_BOOT_LOGOS__ = applyLogos;

  applyFavicon();

  if (document.readyState === "loading") {
    var mo = new MutationObserver(function () {
      applyLogos(document);
      applyFavicon();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", function () {
      applyLogos(document);
      applyFavicon();
      mo.disconnect();
    });
  } else {
    applyLogos(document);
    applyFavicon();
  }
})();
