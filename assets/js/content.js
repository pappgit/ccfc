/**
 * Loads editable site content from Supabase (key: site) with local default fallback.
 * Applies to [data-cms], [data-cms-html], [data-cms-src], [data-cms-href].
 */
window.CCFCContent = (function () {
  const CACHE_KEY = "ccfc_site_content_v1";
  let content = null;

  function getByPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  function setByPath(obj, path, value) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function assetPath(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
    const depth = location.pathname.includes("/admin") ? "../" : "";
    if (url.startsWith("assets/")) return depth + url;
    return url;
  }

  function defaultUrl() {
    const depth = location.pathname.includes("/admin") ? "../" : "";
    return depth + "assets/data/site-content.default.json";
  }

  async function loadDefault() {
    const res = await fetch(defaultUrl());
    if (!res.ok) throw new Error("default content missing");
    return res.json();
  }

  async function loadRemote() {
    if (!window.supabase || !window.CCFC_SUPABASE) return null;
    const client = window.supabase.createClient(
      window.CCFC_SUPABASE.url,
      window.CCFC_SUPABASE.anonKey
    );
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", "site")
      .maybeSingle();
    if (error || !data?.value) return null;
    return data.value;
  }

  async function load({ bypassCache = false } = {}) {
    if (content && !bypassCache) return content;
    if (!bypassCache) {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) content = JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }

    try {
      const remote = await loadRemote();
      if (remote) {
        content = remote;
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(remote));
        return content;
      }
    } catch {
      /* ignore */
    }

    if (!content || bypassCache) content = await loadDefault();
    return content;
  }

  function apply(root = document) {
    if (!content) return;

    root.querySelectorAll("[data-cms]").forEach((el) => {
      const path = el.getAttribute("data-cms");
      const val = getByPath(content, path);
      if (val == null || val === "") return;
      el.textContent = String(val);
    });

    root.querySelectorAll("[data-cms-html]").forEach((el) => {
      const path = el.getAttribute("data-cms-html");
      const val = getByPath(content, path);
      if (val == null) return;
      el.innerHTML = String(val);
    });

    root.querySelectorAll("[data-cms-src]").forEach((el) => {
      const path = el.getAttribute("data-cms-src");
      const val = getByPath(content, path);
      if (!val) return;
      el.setAttribute("src", assetPath(String(val)));
    });

    root.querySelectorAll("[data-cms-href]").forEach((el) => {
      const path = el.getAttribute("data-cms-href");
      const val = getByPath(content, path);
      if (!val) return;
      let v = String(val);
      if (el.hasAttribute("data-cms-mailto") && !v.startsWith("mailto:")) v = "mailto:" + v;
      el.setAttribute("href", v);
    });

    const brandName = getByPath(content, "brand.name") || "CCFC";
    const pageTitlePath = document.body?.getAttribute("data-cms-title");
    if (pageTitlePath) {
      const pt = getByPath(content, pageTitlePath);
      if (pt) document.title = `${pt} — ${brandName}`;
    } else if (document.body?.hasAttribute("data-cms-home-title")) {
      const title = getByPath(content, "meta.siteTitle");
      if (title) document.title = title;
      const desc = getByPath(content, "meta.siteDescription");
      const meta = document.querySelector('meta[name="description"]');
      if (desc && meta) meta.setAttribute("content", desc);
    }

    const fav = getByPath(content, "brand.faviconUrl");
    const icon = document.querySelector('link[rel="icon"]');
    if (fav && icon) icon.setAttribute("href", assetPath(fav));

    root.querySelectorAll("[data-nav]").forEach((el) => {
      const key = el.getAttribute("data-nav");
      const visible = getByPath(content, `nav.visible.${key}`);
      el.hidden = visible === false;
    });

    root.querySelectorAll("[data-section]").forEach((el) => {
      const key = el.getAttribute("data-section");
      const visible = getByPath(content, `sections.${key}`);
      el.hidden = visible === false;
    });
  }

  async function init() {
    await load();
    apply();
    document.dispatchEvent(new CustomEvent("ccfc:content-ready", { detail: content }));
    return content;
  }

  function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
    content = null;
  }

  return {
    init,
    load,
    apply,
    getByPath,
    setByPath,
    clearCache,
    assetPath,
    get: () => content,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  if (!location.pathname.includes("/admin")) {
    window.CCFCContent.init().catch(() => {});
  }
});
