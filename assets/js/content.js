/**
 * Loads editable site content from Supabase (key: site) with local default fallback.
 * Applies to [data-cms], [data-cms-html], [data-cms-src], [data-cms-href].
 *
 * === Regler for alle CMS-tekstfelter ===
 * 1. Manglende verdi (null/undefined): bruk standard fra site-content.default.json
 * 2. Eksplisitt tom streng ("" / bare mellomrom): beholdes tom — feltet skjules på siden
 * 3. Annen tekst: vises som lagret (admin trimmer ytterkanter ved lagring)
 * 4. Avkrysning (bool): lagret true/false brukes; mangler → standard
 * 5. Lister/objekter: lagret verdi brukes; mangler → standard
 * 6. data-nav / data-section: skjules også når tilknyttet CMS-tekst er tom
 */
window.CCFCContent = (function () {
  const CACHE_KEY = "ccfc_site_content_v4";
  let content = null;

  /** Elements that should not leave empty visual shells when CMS text is blank. */
  const HIDE_WHEN_BLANK = new Set([
    "P",
    "DIV",
    "SPAN",
    "STRONG",
    "A",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BUTTON",
    "LABEL",
    "LI",
  ]);

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

  /** True when a CMS string should be treated as intentionally empty. */
  function isBlankText(val) {
    return typeof val === "string" && val.trim() === "";
  }

  /**
   * Normalize text from admin inputs before save.
   * Whitespace-only becomes ""; other strings are trim()'ed.
   */
  function normalizeCmsString(val) {
    if (typeof val !== "string") return val;
    return val.trim();
  }

  /** Merge remote CMS over defaults. Empty strings stay empty; only missing keys use defaults. */
  function mergeDefaults(defaults, remote) {
    if (remote == null) return defaults;
    if (Array.isArray(defaults)) {
      return Array.isArray(remote) ? remote : defaults;
    }
    if (defaults && typeof defaults === "object") {
      if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
        return { ...defaults };
      }
      const out = { ...defaults };
      for (const key of Object.keys(defaults)) {
        out[key] = mergeDefaults(defaults[key], remote[key]);
      }
      for (const key of Object.keys(remote)) {
        if (!(key in out)) out[key] = remote[key];
      }
      return out;
    }
    return remote;
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

    const defaults = await loadDefault();

    try {
      const remote = await loadRemote();
      if (remote) {
        content = mergeDefaults(defaults, remote);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(content));
        return content;
      }
    } catch {
      /* ignore */
    }

    if (!content || bypassCache) content = defaults;
    else content = mergeDefaults(defaults, content);
    return content;
  }

  function applyCmsVisibility(el, blank) {
    if (!HIDE_WHEN_BLANK.has(el.tagName)) return;
    el.hidden = blank;
  }

  function cmsPathOn(el) {
    return el.getAttribute("data-cms") || el.getAttribute("data-cms-html");
  }

  function isCmsTextBlank(el) {
    const path = cmsPathOn(el);
    if (!path || !content) return false;
    const val = getByPath(content, path);
    if (val == null) return false;
    return isBlankText(String(val));
  }

  function apply(root = document) {
    if (!content) return;

    root.querySelectorAll("[data-cms]").forEach((el) => {
      const path = el.getAttribute("data-cms");
      const val = getByPath(content, path);
      if (val == null) return;
      const text = String(val);
      el.textContent = text;
      applyCmsVisibility(el, isBlankText(text));
    });

    root.querySelectorAll("[data-cms-html]").forEach((el) => {
      const path = el.getAttribute("data-cms-html");
      const val = getByPath(content, path);
      if (val == null) return;
      const html = String(val);
      el.innerHTML = html;
      applyCmsVisibility(el, isBlankText(html));
    });

    root.querySelectorAll("[data-cms-src]").forEach((el) => {
      const path = el.getAttribute("data-cms-src");
      const val = getByPath(content, path);
      if (val == null || isBlankText(String(val))) return;
      el.setAttribute("src", assetPath(String(val)));
    });

    root.querySelectorAll("[data-cms-href]").forEach((el) => {
      const path = el.getAttribute("data-cms-href");
      const val = getByPath(content, path);
      if (val == null) return;
      if (isBlankText(String(val))) {
        el.removeAttribute("href");
        return;
      }
      let v = String(val).trim();
      if (el.hasAttribute("data-cms-mailto") && !v.startsWith("mailto:")) v = "mailto:" + v;
      el.setAttribute("href", v);
    });

    const brandName = getByPath(content, "brand.name") || "CCFC";
    const pageTitlePath = document.body?.getAttribute("data-cms-title");
    if (pageTitlePath) {
      const pt = getByPath(content, pageTitlePath);
      if (pt && !isBlankText(String(pt))) document.title = `${pt} — ${brandName}`;
    } else if (document.body?.hasAttribute("data-cms-home-title")) {
      const title = getByPath(content, "meta.siteTitle");
      if (title && !isBlankText(String(title))) document.title = title;
      const desc = getByPath(content, "meta.siteDescription");
      const meta = document.querySelector('meta[name="description"]');
      if (desc && !isBlankText(String(desc)) && meta) meta.setAttribute("content", desc);
    }

    const fav = getByPath(content, "brand.faviconUrl");
    const icon = document.querySelector('link[rel="icon"]');
    if (fav && !isBlankText(String(fav)) && icon) icon.setAttribute("href", assetPath(fav));

    // Visibility toggles must respect empty CMS labels on the same element
    root.querySelectorAll("[data-nav]").forEach((el) => {
      const key = el.getAttribute("data-nav");
      const visible = getByPath(content, `nav.visible.${key}`);
      el.hidden = visible === false || isCmsTextBlank(el);
    });

    root.querySelectorAll("[data-section]").forEach((el) => {
      const key = el.getAttribute("data-section");
      const visible = getByPath(content, `sections.${key}`);
      el.hidden = visible === false || isCmsTextBlank(el);
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
    sessionStorage.removeItem("ccfc_site_content_v1");
    sessionStorage.removeItem("ccfc_site_content_v2");
    sessionStorage.removeItem("ccfc_site_content_v3");
    content = null;
  }

  return {
    init,
    load,
    apply,
    getByPath,
    setByPath,
    mergeDefaults,
    isBlankText,
    normalizeCmsString,
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
