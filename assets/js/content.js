/**
 * Loads editable site content from Supabase (key: site) with local default fallback.
 * Applies to [data-cms], [data-cms-html], [data-cms-src], [data-cms-href].
 *
 * === Regler for alle CMS-tekstfelter ===
 * 1. Manglende nøkkel (ikke satt i databasen): bruk standard fra site-content.default.json
 * 2. Eksplisitt tom streng "" eller null: beholdes tom — feltet skjules på siden
 * 3. Annen tekst: vises som lagret (admin trimmer ytterkanter ved lagring)
 * 4. Avkrysning (bool): lagret true/false brukes; mangler → standard
 * 5. Lister/objekter: lagret verdi brukes; mangler → standard
 * 6. data-nav / data-section: skjules også når tilknyttet CMS-tekst er tom
 */
window.CCFCContent = (function () {
  const CACHE_KEY = "ccfc_site_content_v5";
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

  /** Section keys that should hide when a related CMS text path is blank. */
  const SECTION_TEXT_PATHS = {
    homeNote: "home.note",
  };

  function isExternalHref(href) {
    return /^https?:\/\//i.test(href || "") || String(href || "").startsWith("//");
  }

  /** Allow only safe URL schemes for CMS hrefs (blocks javascript:, data:, etc.). */
  function safeCmsHref(raw, { mailto = false } = {}) {
    let v = String(raw || "").trim();
    if (!v) return "";

    if (mailto || /^mailto:/i.test(v)) {
      const addr = v.replace(/^mailto:/i, "").trim();
      if (!addr || /[\s<>"]/.test(addr)) return "";
      return "mailto:" + addr;
    }

    if (/^tel:/i.test(v)) {
      const num = v.slice(4).trim();
      if (!/^[+\d][\d\s().-]*$/.test(num)) return "";
      return "tel:" + num.replace(/\s+/g, "");
    }

    // Relative / in-app paths
    if (v.startsWith("#") || v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) {
      if (/[\s<>"]/.test(v) || v.toLowerCase().includes("javascript:")) return "";
      return v;
    }

    // Local HTML pages without scheme
    if (/^[a-z0-9][\w./-]*\.html?(?:[?#][\w./&=%+-]*)?$/i.test(v)) {
      return v;
    }

    // Protocol-relative → https
    if (v.startsWith("//")) v = "https:" + v;

    // Bare domain → https
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      const host = v.split("/")[0].split("?")[0];
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
        v = "https://" + v;
      } else {
        return "";
      }
    }

    try {
      const u = new URL(v);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      /* ignore */
    }
    return "";
  }

  function normalizeNavHref(href) {
    return safeCmsHref(href);
  }

  /** Safe src for images: http(s), relative assets, data:image. */
  function safeCmsSrc(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^data:image\//i.test(raw)) return raw;
    const resolved = assetPath(raw);
    if (/^https?:\/\//i.test(resolved)) return resolved;
    if (
      resolved.startsWith("assets/") ||
      resolved.startsWith("./assets/") ||
      resolved.startsWith("../assets/") ||
      (resolved.startsWith("/") && !resolved.startsWith("//"))
    ) {
      return resolved;
    }
    return "";
  }

  function getByPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  function setByPath(obj, path, value) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cur[key] || typeof cur[key] !== "object" || Array.isArray(cur[key])) {
        cur[key] = {};
      }
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function isPlainObject(val) {
    return !!val && typeof val === "object" && !Array.isArray(val);
  }

  function cloneJson(val) {
    return JSON.parse(JSON.stringify(val));
  }

  /** True when a CMS string should be treated as intentionally empty. */
  function isBlankText(val) {
    return val == null || (typeof val === "string" && val.trim() === "");
  }

  /**
   * Normalize text from admin inputs before save.
   * Whitespace-only becomes ""; other strings are trim()'ed.
   */
  function normalizeCmsString(val) {
    if (typeof val !== "string") return val;
    return val.trim();
  }

  /**
   * Merge remote CMS over defaults.
   * - Missing key (undefined / not own property) → default
   * - null or "" → intentional empty (do NOT restore default)
   * - other values → use remote
   */
  function mergeDefaults(defaults, remote) {
    // Only undefined means "not set". null is intentional clear for scalars.
    if (remote === undefined) return cloneJson(defaults);

    if (Array.isArray(defaults)) {
      return Array.isArray(remote) ? cloneJson(remote) : cloneJson(defaults);
    }

    if (isPlainObject(defaults)) {
      if (!isPlainObject(remote)) return cloneJson(defaults);
      const out = {};
      for (const key of Object.keys(defaults)) {
        if (Object.prototype.hasOwnProperty.call(remote, key)) {
          out[key] = mergeDefaults(defaults[key], remote[key]);
        } else {
          out[key] = cloneJson(defaults[key]);
        }
      }
      for (const key of Object.keys(remote)) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) {
          out[key] = cloneJson(remote[key]);
        }
      }
      return out;
    }

    // Scalar leaf (string, number, boolean, null)
    if (remote === null) {
      return typeof defaults === "string" ? "" : remote;
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
      if (remote && typeof remote === "object") {
        content = mergeDefaults(defaults, remote);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(content));
        return content;
      }
    } catch {
      /* ignore */
    }

    if (!content || bypassCache) content = cloneJson(defaults);
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
    return isBlankText(getByPath(content, path));
  }

  function apply(root = document) {
    if (!content) return;

    root.querySelectorAll("[data-cms]").forEach((el) => {
      const path = el.getAttribute("data-cms");
      const val = getByPath(content, path);
      if (val === undefined) return;
      const text = val == null ? "" : String(val);
      el.textContent = text;
      applyCmsVisibility(el, isBlankText(text));
    });

    root.querySelectorAll("[data-cms-html]").forEach((el) => {
      // Raw HTML from CMS is disabled (XSS). Render as plain text.
      const path = el.getAttribute("data-cms-html");
      const val = getByPath(content, path);
      if (val === undefined) return;
      const text = val == null ? "" : String(val);
      el.textContent = text;
      applyCmsVisibility(el, isBlankText(text));
    });

    root.querySelectorAll("[data-cms-src]").forEach((el) => {
      const path = el.getAttribute("data-cms-src");
      const val = getByPath(content, path);
      if (val === undefined || isBlankText(val)) return;
      const safe = safeCmsSrc(String(val));
      if (!safe) {
        el.removeAttribute("src");
        return;
      }
      el.setAttribute("src", safe);
    });

    root.querySelectorAll("[data-cms-href]").forEach((el) => {
      const path = el.getAttribute("data-cms-href");
      const val = getByPath(content, path);
      if (val === undefined) return;
      if (isBlankText(val)) {
        el.removeAttribute("href");
        return;
      }
      const mailto = el.hasAttribute("data-cms-mailto");
      const safe = safeCmsHref(String(val).trim(), { mailto });
      if (!safe) {
        el.removeAttribute("href");
        return;
      }
      el.setAttribute("href", safe);
    });

    const brandName = getByPath(content, "brand.name") || "CCFC";
    const pageTitlePath = document.body?.getAttribute("data-cms-title");
    if (pageTitlePath) {
      const pt = getByPath(content, pageTitlePath);
      if (pt && !isBlankText(pt)) document.title = `${pt} — ${brandName}`;
    } else if (document.body?.hasAttribute("data-cms-home-title")) {
      const title = getByPath(content, "meta.siteTitle");
      if (title && !isBlankText(title)) document.title = title;
      const desc = getByPath(content, "meta.siteDescription");
      const meta = document.querySelector('meta[name="description"]');
      if (desc && !isBlankText(desc) && meta) meta.setAttribute("content", desc);
    }

    const fav = getByPath(content, "brand.faviconUrl");
    const icon = document.querySelector('link[rel="icon"]');
    if (fav && !isBlankText(fav) && icon) {
      const safeFav = safeCmsSrc(String(fav));
      if (safeFav) icon.setAttribute("href", safeFav);
    }

    root.querySelectorAll("[data-nav]").forEach((el) => {
      const key = el.getAttribute("data-nav");
      const visible = getByPath(content, `nav.visible.${key}`);
      el.hidden = visible === false || isCmsTextBlank(el);
    });

    root.querySelectorAll("[data-section]").forEach((el) => {
      const key = el.getAttribute("data-section");
      const visible = getByPath(content, `sections.${key}`);
      const linkedPath = SECTION_TEXT_PATHS[key];
      const linkedBlank = linkedPath ? isBlankText(getByPath(content, linkedPath)) : false;
      el.hidden = visible === false || isCmsTextBlank(el) || linkedBlank;
    });

    syncComingSoonMode();
    renderCustomNav(root);
  }

  function isComingSoonEnabled() {
    if (!content) return true;
    const val = getByPath(content, "sections.comingSoon");
    return val !== false;
  }

  function syncComingSoonMode() {
    const enabled = isComingSoonEnabled();
    try {
      sessionStorage.setItem("ccfc_coming_soon", enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    document.documentElement.classList.toggle("site-coming-soon", enabled);
    document.documentElement.classList.toggle("site-open", !enabled);

    let robots = document.querySelector('meta[name="robots"]');
    if (enabled) {
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        document.head.appendChild(robots);
      }
      robots.setAttribute("content", "noindex, nofollow");
      document.title = "Coventry City Scandinavian Supporters Club — Under utvikling";
    } else if (robots) {
      robots.remove();
    }
  }

  function renderCustomNav(root = document) {
    const nav = root.querySelector("#site-nav") || root.querySelector("nav.nav");
    if (!nav || !content) return;

    nav.querySelectorAll("[data-nav-custom]").forEach((el) => el.remove());

    const items = getByPath(content, "nav.custom");
    if (!Array.isArray(items) || !items.length) return;

    items.forEach((item, index) => {
      if (!item || item.visible === false) return;
      const label = String(item.label || "").trim();
      const href = normalizeNavHref(item.href);
      if (!label || !href) return;

      const a = document.createElement("a");
      a.textContent = label;
      a.href = href;
      a.setAttribute("data-nav-custom", item.id || String(index));
      if (isExternalHref(href)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.classList.add("nav__external");
      }
      nav.appendChild(a);
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
    sessionStorage.removeItem("ccfc_coming_soon");
    sessionStorage.removeItem("ccfc_site_content_v1");
    sessionStorage.removeItem("ccfc_site_content_v2");
    sessionStorage.removeItem("ccfc_site_content_v3");
    sessionStorage.removeItem("ccfc_site_content_v4");
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
    cloneJson,
    isExternalHref,
    normalizeNavHref,
    safeCmsHref,
    safeCmsSrc,
    isComingSoonEnabled,
    get: () => content,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  if (!location.pathname.includes("/admin")) {
    window.CCFCContent.init().catch(() => {});
  }
});
