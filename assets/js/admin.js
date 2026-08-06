(function () {
  const cfg = window.CCFC_SUPABASE;
  const sb = window.supabase;
  if (!cfg?.url || !sb?.createClient) {
    console.error("Supabase mangler", { cfg, sb });
    const msg = document.getElementById("login-msg");
    if (msg) {
      msg.hidden = false;
      msg.classList.add("is-error");
      msg.textContent = "Kunne ikke laste Supabase-klienten. Hard refresh (Cmd+Shift+R) og prøv igjen.";
    }
    return;
  }

  const PROJECT_REF = "zzqhgqcwuztbqgkvpxjg";
  const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
  const CACHE_BUST = "20260804-changelog2";

  // Drop corrupted/half-written sessions that can freeze auth-js.
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed?.access_token || !parsed?.refresh_token) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  const client = sb.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
      storageKey: AUTH_STORAGE_KEY,
      // Bypass navigator.locks entirely (known hang on older/stuck tabs).
      lock: async (_name, _acquireTimeout, fn) => fn(),
    },
  });

  const $ = (sel) => document.querySelector(sel);
  const loginView = $("#login-view");
  const appView = $("#app-view");
  const loginMsg = $("#login-msg");
  const apiMsg = $("#api-msg");
  const newsMsg = $("#news-msg");
  const rumorMsg = $("#rumor-msg");
  const rumorKeywordsMsg = $("#rumor-keywords-msg");
  const rumorSourcesMsg = $("#rumor-sources-msg");

  function showMsg(el, text, isError) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function slugify(title) {
    return title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/æ/g, "ae")
      .replace(/ø/g, "o")
      .replace(/å/g, "a")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }

  const loginBtn = $("#login-form")?.querySelector('button[type="submit"]');
  let authBusy = false;
  let enteredAppForUser = null;
  let bootDone = false;

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`${label || "Forespørsel"} tok for lang tid (${ms / 1000}s).`)),
        ms
      );
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  function setLoginBusy(busy) {
    authBusy = busy;
    if (loginBtn) loginBtn.disabled = busy;
  }

  /** Password login via raw Auth API — avoids auth-js hang after 200 OK. */
  async function signInRaw(email, password) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
        },
        body: JSON.stringify({ email, password }),
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Innlogging tok for lang tid (15s). Sjekk nettverk/VPN.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.msg || body.error_description || body.error || "Innlogging feilet");
      err.status = res.status;
      throw err;
    }
    if (!body.access_token || !body.refresh_token) {
      throw new Error("Innlogging lyktes ikke (mangler tokens).");
    }

    const session = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: body.expires_in,
      expires_at: body.expires_at,
      token_type: body.token_type || "bearer",
      user: body.user,
    };

    // Persist for supabase-js, then try setSession (non-fatal if it hangs).
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } catch (err) {
      console.warn(err);
    }

    try {
      await withTimeout(
        client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
        4000,
        "Lagre sesjon"
      );
    } catch (err) {
      console.warn("setSession skipped:", err);
    }

    return session;
  }

  async function isAdminUser(userId, accessToken) {
    const headers = {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${accessToken || cfg.anonKey}`,
      Accept: "application/json",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}`,
        { headers, signal: controller.signal }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Admin-sjekk feilet (${res.status})`);
      }
      const data = await res.json();
      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Admin-sjekk tok for lang tid (12s).");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function showApp(session) {
    if (!session?.user?.id) {
      await showLogin();
      return;
    }
    if (enteredAppForUser === session.user.id && !appView.hidden) return;

    try {
      showMsg(loginMsg, "Sjekker admin-tilgang…");
      const ok = await isAdminUser(session.user.id, session.access_token);
      if (!ok) {
        enteredAppForUser = null;
        loginView.hidden = false;
        appView.hidden = true;
        showMsg(
          loginMsg,
          "Brukeren er ikke admin. Legg til e-posten i Supabase (Auth-bruker + rad i tabellen admins).",
          true
        );
        setLoginBusy(false);
        clearLocalSession();
        return;
      }

      enteredAppForUser = session.user.id;
      loginView.hidden = true;
      appView.hidden = false;
      showMsg(loginMsg, "");
      $("#admin-email").textContent = session.user.email || session.user.id;

      await Promise.allSettled([
        loadContentEditor(),
        loadApiSettings(),
        loadNews(),
        loadRumors(),
        loadRumorKeywords(),
        loadRumorSources(),
        loadChangelog(),
        loadFeedback(),
        loadMembers(),
        loadMailOutbox(),
        loadMemberTemplates(),
      ]);
    } catch (err) {
      console.error(err);
      enteredAppForUser = null;
      loginView.hidden = false;
      appView.hidden = true;
      showMsg(loginMsg, formatAuthError(err), true);
    } finally {
      setLoginBusy(false);
    }
  }

  function clearLocalSession() {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    client.auth.signOut({ scope: "local" }).catch(() => {});
  }

  function formatAuthError(err) {
    const msg = (err && (err.message || err.error_description || String(err))) || "Ukjent feil";
    if (/invalid login credentials|invalid_credentials/i.test(msg)) {
      return "Feil e-post eller passord.";
    }
    if (/load failed|failed to fetch|networkerror|network request failed|abort/i.test(msg)) {
      return "Nettverksfeil: nettleseren når ikke Supabase (brannmur/VPN/adblock). Prøv et annet nettverk, eller skru av VPN/adblock for supabase.co.";
    }
    if (/tok for lang tid/i.test(msg)) {
      return msg + " Sjekk nettverk/VPN og prøv igjen.";
    }
    return msg;
  }

  async function showLogin() {
    enteredAppForUser = null;
    loginView.hidden = false;
    appView.hidden = true;
    setLoginBusy(false);
  }

  function afterAuthLock(fn) {
    setTimeout(() => {
      Promise.resolve()
        .then(fn)
        .catch((err) => console.error(err));
    }, 0);
  }

  /* —— Nav —— */
  document.querySelectorAll("[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-panel]").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const panel = document.getElementById(`panel-${btn.dataset.panel}`);
      if (panel) panel.classList.add("is-active");
      if (btn.dataset.panel === "changelog") loadChangelog();
      if (btn.dataset.panel === "feedback") loadFeedback();
      if (btn.dataset.panel === "members") {
        loadMembers();
        loadMailOutbox();
        loadMemberTemplates();
      }
    });
  });

  /* —— Site content CMS —— */
  const CONTENT_SECTIONS = [
    {
      id: "brand",
      label: "Merkevare",
      fields: [
        { path: "brand.name", label: "Navn (linje 1)", type: "text" },
        { path: "brand.sub", label: "Undertittel", type: "text" },
        { path: "meta.siteTitle", label: "Sidetittel (browser)", type: "text" },
        { path: "meta.siteDescription", label: "Meta-beskrivelse", type: "textarea" },
      ],
    },
    {
      id: "nav",
      label: "Meny",
      fields: [
        { path: "nav.home", label: "Hjem · tekst", type: "text" },
        { path: "nav.visible.home", label: "Vis Hjem i menyen", type: "check" },
        { path: "nav.fixtures", label: "Kamper · tekst", type: "text" },
        { path: "nav.visible.fixtures", label: "Vis Kamper i menyen", type: "check" },
        { path: "nav.stats", label: "Statistikk · tekst", type: "text" },
        { path: "nav.visible.stats", label: "Vis Statistikk i menyen", type: "check" },
        { path: "nav.news", label: "Nyheter · tekst", type: "text" },
        { path: "nav.visible.news", label: "Vis Nyheter i menyen", type: "check" },
        { path: "nav.rumors", label: "Ryktebørsen · tekst", type: "text" },
        { path: "nav.visible.rumors", label: "Vis Ryktebørsen i menyen", type: "check" },
        { path: "nav.members", label: "Medlem · tekst", type: "text" },
        { path: "nav.visible.members", label: "Vis Medlem i menyen", type: "check" },
        { path: "nav.about", label: "Om oss · tekst", type: "text" },
        { path: "nav.visible.about", label: "Vis Om oss i menyen", type: "check" },
      ],
    },
    {
      id: "membersPage",
      label: "Medlem-side",
      fields: [
        { path: "members.title", label: "Tittel", type: "text" },
        { path: "members.lead", label: "Ingress", type: "textarea" },
        { path: "members.tag", label: "Tag", type: "text" },
        { path: "members.heading", label: "Overskrift", type: "text" },
        { path: "members.p1", label: "Tekst 1", type: "textarea" },
        { path: "members.p2", label: "Tekst 2", type: "textarea" },
        { path: "members.consentPrivacy", label: "Samtykke personvern", type: "textarea" },
        { path: "members.consentMarketing", label: "Samtykke markedsføring", type: "textarea" },
      ],
    },
    {
      id: "sections",
      label: "Seksjoner",
      fields: [
        { path: "sections.homeMatches", label: "Forside: vis kampprogram", type: "check" },
        { path: "sections.homeNews", label: "Forside: vis nyheter", type: "check" },
        { path: "sections.homeAbout", label: "Forside: vis om-blokk", type: "check" },
        { path: "sections.homeNote", label: "Forside: vis infostripe", type: "check" },
        { path: "sections.footerAdmin", label: "Footer: vis admin-lenke", type: "check" },
      ],
    },
    {
      id: "home",
      label: "Forside",
      fields: [
        { path: "home.heroLine1", label: "Hero linje 1", type: "text" },
        { path: "home.heroLine2", label: "Hero linje 2", type: "text" },
        { path: "home.heroLead", label: "Hero ingress", type: "textarea" },
        { path: "home.ctaFixtures", label: "CTA kamper", type: "text" },
        { path: "home.ctaNews", label: "CTA nyheter", type: "text" },
        { path: "home.matchesTag", label: "Kamper · tag", type: "text" },
        { path: "home.matchesTitle", label: "Kamper · tittel", type: "text" },
        { path: "home.matchesLead", label: "Kamper · tekst", type: "textarea" },
        { path: "home.matchesAll", label: "Knapp alle kamper", type: "text" },
        { path: "home.newsTag", label: "Nyheter · tag", type: "text" },
        { path: "home.newsTitle", label: "Nyheter · tittel", type: "text" },
        { path: "home.newsLead", label: "Nyheter · tekst", type: "textarea" },
        { path: "home.aboutTag", label: "Om-blokk · tag", type: "text" },
        { path: "home.aboutTitle", label: "Om-blokk · tittel", type: "text" },
        { path: "home.aboutP1", label: "Om-blokk · avsnitt 1", type: "textarea" },
        { path: "home.aboutP2", label: "Om-blokk · avsnitt 2", type: "textarea" },
        { path: "home.aboutCta", label: "Om-blokk · knapp", type: "text" },
        { path: "home.note", label: "Infostripe under forsiden", type: "textarea" },
      ],
    },
    {
      id: "fixtures",
      label: "Kamper-side",
      fields: [
        { path: "fixtures.title", label: "Tittel", type: "text" },
        { path: "fixtures.lead", label: "Ingress", type: "textarea" },
        { path: "fixtures.note", label: "Infostripe", type: "textarea" },
      ],
    },
    {
      id: "stats",
      label: "Statistikk-side",
      fields: [
        { path: "stats.title", label: "Tittel", type: "text" },
        { path: "stats.lead", label: "Ingress", type: "textarea" },
        { path: "stats.note", label: "Infostripe", type: "textarea" },
      ],
    },
    {
      id: "newsPage",
      label: "Nyheter-side",
      fields: [
        { path: "newsPage.title", label: "Tittel", type: "text" },
        { path: "newsPage.lead", label: "Ingress", type: "textarea" },
      ],
    },
    {
      id: "rumorsPage",
      label: "Ryktebørsen-side",
      fields: [
        { path: "rumorsPage.title", label: "Tittel", type: "text" },
        { path: "rumorsPage.lead", label: "Ingress", type: "textarea" },
        { path: "rumorsPage.disclaimer", label: "Disclaimer", type: "textarea" },
        { path: "rumorsPage.empty", label: "Tom liste · tekst", type: "text" },
      ],
    },
    {
      id: "about",
      label: "Om oss",
      fields: [
        { path: "about.title", label: "Tittel", type: "text" },
        { path: "about.lead", label: "Ingress", type: "textarea" },
        { path: "about.tag", label: "Tag", type: "text" },
        { path: "about.heading", label: "Overskrift", type: "text" },
        { path: "about.p1", label: "Avsnitt 1", type: "textarea" },
        { path: "about.p2", label: "Avsnitt 2", type: "textarea" },
        { path: "about.p3", label: "Avsnitt 3", type: "textarea" },
        { path: "about.p4", label: "Avsnitt 4", type: "textarea" },
        { path: "about.contactLabel", label: "Kontakt-knapp", type: "text" },
        { path: "about.contactEmail", label: "Kontakt-e-post", type: "text" },
        { path: "about.footerText", label: "Footer-tekst (om-siden)", type: "text" },
      ],
    },
    {
      id: "footer",
      label: "Footer",
      fields: [
        { path: "footer.title", label: "Tittel", type: "text" },
        {
          path: "footer.text",
          label: "Tekst under tittel",
          type: "textarea",
        },
        { path: "footer.tagline", label: "Tagline (f.eks. Play Up Sky Blues)", type: "text" },
        { path: "footer.adminLabel", label: "Admin-lenke", type: "text" },
      ],
    },
  ];

  let contentState = null;
  let activeContentSection = "brand";
  const contentMsg = $("#content-msg");

  /** Shared rules for every CMS text/textarea field (see CCFCContent). */
  const CMS_TEXT_RULES_HELP =
    "La feltet stå helt tomt for å skjule teksten på nettsiden. Det lagres som tomt og fylles ikke med standardtekst igjen. Felt som aldri er lagret får standardtekst.";

  function flushContentFields() {
    if (!contentState) return;
    const form = $("#content-form");
    const nodes = form
      ? form.querySelectorAll(
          "#content-fields [name], #logo-url-input, #favicon-url-input, #hero-interval-input"
        )
      : [];
    nodes.forEach((el) => {
      if (!el.name) return;
      let val;
      if (el.type === "checkbox") {
        val = el.checked;
      } else if (el.name === "home.heroSlideInterval") {
        val = Number(el.value) || 6500;
      } else if (el.type === "number") {
        val = el.value === "" ? null : Number(el.value);
      } else {
        // Text / textarea: trim; whitespace-only → "" (intentional empty)
        val = window.CCFCContent.normalizeCmsString(String(el.value ?? ""));
      }
      window.CCFCContent.setByPath(contentState, el.name, val);
    });

    // Persist slide URL/alt edits from the list
    const slides = ensureHeroSlides();
    $("#hero-slides-list")
      ?.querySelectorAll("[data-slide-index]")
      .forEach((row) => {
        const i = Number(row.getAttribute("data-slide-index"));
        if (!slides[i]) return;
        const urlInput = row.querySelector('[data-field="url"]');
        const altInput = row.querySelector('[data-field="alt"]');
        if (urlInput) slides[i].url = urlInput.value.trim();
        if (altInput) slides[i].alt = altInput.value.trim();
      });
    window.CCFCContent.setByPath(contentState, "home.heroSlides", slides.filter((s) => s.url));
  }

  function ensureHeroSlides() {
    let slides = window.CCFCContent.getByPath(contentState, "home.heroSlides");
    if (!Array.isArray(slides)) {
      slides = [];
      window.CCFCContent.setByPath(contentState, "home.heroSlides", slides);
    }
    return slides;
  }

  function renderHeroSlidesEditor() {
    const card = $("#hero-slides-card");
    const list = $("#hero-slides-list");
    if (!card || !list || !contentState) return;

    const show = activeContentSection === "home";
    card.hidden = !show;
    if (!show) return;

    const interval = window.CCFCContent.getByPath(contentState, "home.heroSlideInterval") ?? 6500;
    const intervalInput = $("#hero-interval-input");
    if (intervalInput) intervalInput.value = interval;

    const slides = ensureHeroSlides();
    if (!slides.length) {
      list.innerHTML = `<p class="empty-state" style="margin:0.5rem 0">Ingen slideshow-bilder ennå. Last opp eller lim inn en URL.</p>`;
      return;
    }

    list.innerHTML = slides
      .map((s, i) => {
        const src = window.CCFCContent.assetPath(s.url || "") || "";
        return `<div class="hero-slide-row" data-slide-index="${i}">
          <img class="hero-slide-row__thumb" src="${escapeAttr(src)}" alt="" />
          <div class="hero-slide-row__fields">
            <label>Bilde-URL
              <input type="text" data-field="url" inputmode="url" autocomplete="off" value="${escapeAttr(s.url || "")}" />
            </label>
            <label>Alt-tekst
              <input type="text" data-field="alt" value="${escapeAttr(s.alt || "")}" />
            </label>
          </div>
          <div class="hero-slide-row__actions">
            <button type="button" class="btn btn--solid" data-hero-move="-1" ${i === 0 ? "disabled" : ""} title="Flytt opp">↑</button>
            <button type="button" class="btn btn--solid" data-hero-move="1" ${i === slides.length - 1 ? "disabled" : ""} title="Flytt ned">↓</button>
            <button type="button" class="btn btn--danger" data-hero-remove title="Fjern">Fjern</button>
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-hero-move]").forEach((btn) => {
      btn.addEventListener("click", () => {
        flushContentFields();
        const row = btn.closest("[data-slide-index]");
        const i = Number(row.getAttribute("data-slide-index"));
        const dir = Number(btn.getAttribute("data-hero-move"));
        const arr = ensureHeroSlides();
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
        renderHeroSlidesEditor();
      });
    });

    list.querySelectorAll("[data-hero-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        flushContentFields();
        const row = btn.closest("[data-slide-index]");
        const i = Number(row.getAttribute("data-slide-index"));
        ensureHeroSlides().splice(i, 1);
        renderHeroSlidesEditor();
      });
    });
  }

  function renderContentTabs() {
    const tabs = $("#content-tabs");
    if (!tabs) return;
    tabs.innerHTML = CONTENT_SECTIONS.map(
      (s) =>
        `<button type="button" class="filter-btn${s.id === activeContentSection ? " is-active" : ""}" data-content-tab="${s.id}">${s.label}</button>`
    ).join("");
    tabs.querySelectorAll("[data-content-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        flushContentFields();
        activeContentSection = btn.getAttribute("data-content-tab");
        renderContentTabs();
        renderContentFields();
      });
    });
  }

  function renderContentFields() {
    const section = CONTENT_SECTIONS.find((s) => s.id === activeContentSection);
    const host = $("#content-fields");
    if (!section || !host || !contentState) return;

    const sectionHint =
      section.id === "nav"
        ? "Endre menynavn og huk av hvilke sider som skal vises i menyen. Tom menytekst skjuler lenken."
        : section.id === "sections"
          ? "Slå av/på større blokker på nettsiden uten å slette innholdet."
          : CMS_TEXT_RULES_HELP;

    host.innerHTML = `<div class="admin-card"><h2>${section.label}</h2><p style="color:var(--muted);margin-bottom:0.85rem;font-size:0.9rem">${sectionHint}</p>${section.fields
      .map((f) => {
        const raw = window.CCFCContent.getByPath(contentState, f.path);
        if (f.type === "check") {
          const on = raw !== false;
          return `<label class="check"><input type="checkbox" name="${f.path}" ${on ? "checked" : ""} /> ${escapeHtml(f.label)}</label>`;
        }
        // Show exact stored value (including intentional empty)
        const val = raw == null ? "" : String(raw);
        if (f.type === "textarea") {
          return `<label>${escapeHtml(f.label)}<textarea name="${f.path}" rows="3" autocomplete="off">${escapeHtml(val)}</textarea></label>`;
        }
        return `<label>${escapeHtml(f.label)}<input type="text" name="${f.path}" value="${escapeAttr(val)}" autocomplete="off" /></label>`;
      })
      .join("")}</div>`;

    const logoUrl = window.CCFCContent.getByPath(contentState, "brand.logoUrl") || "";
    const favUrl = window.CCFCContent.getByPath(contentState, "brand.faviconUrl") || "";
    $("#logo-url-input").value = logoUrl;
    $("#favicon-url-input").value = favUrl;
    const preview = $("#logo-preview");
    if (preview) preview.src = window.CCFCContent.assetPath(logoUrl) || "";

    const logoCard = $("#logo-card");
    if (logoCard) logoCard.hidden = activeContentSection !== "brand";

    renderHeroSlidesEditor();
  }

  function collectContentForm() {
    flushContentFields();
    // Snapshot so nested empty strings ("") are definitely what we upsert
    return window.CCFCContent.cloneJson
      ? window.CCFCContent.cloneJson(contentState)
      : JSON.parse(JSON.stringify(contentState));
  }

  async function loadContentEditor() {
    if (!window.CCFCContent) return;
    window.CCFCContent.clearCache();
    contentState = await window.CCFCContent.load({ bypassCache: true });

    // Seed slideshow + visibility defaults if missing in stored CMS (older saves)
    try {
      const depth = location.pathname.includes("/admin") ? "../" : "";
      const res = await fetch(depth + "assets/data/site-content.default.json");
      if (res.ok) {
        const defaults = await res.json();
        const slides = window.CCFCContent.getByPath(contentState, "home.heroSlides");
        if (!Array.isArray(slides) || !slides.length) {
          if (Array.isArray(defaults?.home?.heroSlides)) {
            window.CCFCContent.setByPath(contentState, "home.heroSlides", defaults.home.heroSlides);
          }
        }
        if (window.CCFCContent.getByPath(contentState, "home.heroSlideInterval") == null) {
          window.CCFCContent.setByPath(
            contentState,
            "home.heroSlideInterval",
            defaults?.home?.heroSlideInterval ?? 6500
          );
        }
        const navVisible = window.CCFCContent.getByPath(contentState, "nav.visible");
        if (!navVisible || typeof navVisible !== "object") {
          window.CCFCContent.setByPath(
            contentState,
            "nav.visible",
            defaults?.nav?.visible || {
              home: true,
              fixtures: true,
              stats: true,
              news: true,
              rumors: true,
              members: true,
              about: true,
            }
          );
        }
        if (window.CCFCContent.getByPath(contentState, "nav.members") == null) {
          window.CCFCContent.setByPath(
            contentState,
            "nav.members",
            defaults?.nav?.members || "Medlem"
          );
        }
        if (window.CCFCContent.getByPath(contentState, "nav.visible.members") == null) {
          window.CCFCContent.setByPath(contentState, "nav.visible.members", true);
        }
        if (window.CCFCContent.getByPath(contentState, "nav.rumors") == null) {
          window.CCFCContent.setByPath(
            contentState,
            "nav.rumors",
            defaults?.nav?.rumors || "Ryktebørsen"
          );
        }
        if (window.CCFCContent.getByPath(contentState, "nav.visible.rumors") == null) {
          window.CCFCContent.setByPath(contentState, "nav.visible.rumors", true);
        }
        if (!window.CCFCContent.getByPath(contentState, "rumorsPage")) {
          window.CCFCContent.setByPath(
            contentState,
            "rumorsPage",
            defaults?.rumorsPage || {
              title: "Ryktebørsen",
              lead: "Overgangsrykter og spekulasjon — alltid med kilde og lenke til originalen.",
              disclaimer:
                "Rykter er spekulasjon, ikke bekreftede nyheter. Vi publiserer korte utdrag med kildehenvisning og lenke til originalen — ikke fullartikler.",
              empty: "Ingen rykter publisert ennå. Kom tilbake i transfervinduet.",
            }
          );
        }
        if (!window.CCFCContent.getByPath(contentState, "members")) {
          window.CCFCContent.setByPath(
            contentState,
            "members",
            defaults?.members || {
              title: "Bli medlem",
              lead: "Bli en del av Coventry City Scandinavia.",
              tag: "Medlemskap",
              heading: "Sky Blues i Norden",
              p1: "",
              p2: "",
              consentPrivacy: "Jeg godtar at klubben lagrer navn, e-post og mobil for medlemskapet.",
              consentMarketing: "Jeg ønsker e-post om arrangementer (valgfritt).",
            }
          );
        }
        const sections = window.CCFCContent.getByPath(contentState, "sections");
        if (!sections || typeof sections !== "object") {
          window.CCFCContent.setByPath(
            contentState,
            "sections",
            defaults?.sections || {
              homeMatches: true,
              homeNews: true,
              homeAbout: true,
              homeNote: true,
              footerAdmin: true,
            }
          );
        }
      }
    } catch {
      /* ignore */
    }

    renderContentTabs();
    renderContentFields();
  }

  $("#content-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = collectContentForm();
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("site_settings").upsert(
      {
        key: "site",
        value,
        updated_by: sessionData.session?.user?.id || null,
      },
      { onConflict: "key" }
    );
    if (error) showMsg(contentMsg, error.message, true);
    else {
      contentState = value;
      window.CCFCContent.clearCache();
      showMsg(
        contentMsg,
        "Innhold lagret. Tomme felt forblir tomme (ikke standardtekst). Oppdater forsiden for å se endringene."
      );
    }
  });

  $("#content-reload")?.addEventListener("click", async () => {
    showMsg(contentMsg, "Henter…");
    await loadContentEditor();
    showMsg(contentMsg, "Oppdatert fra database.");
  });

  $("#logo-upload-btn")?.addEventListener("click", async () => {
    const fileInput = $("#logo-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      showMsg(contentMsg, "Velg en fil først.", true);
      return;
    }
    showMsg(contentMsg, "Laster opp…");
    const ext = file.name.split(".").pop() || "png";
    const path = `brand/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await client.storage.from("media").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (upErr) {
      showMsg(contentMsg, upErr.message, true);
      return;
    }
    const { data: pub } = client.storage.from("media").getPublicUrl(path);
    const url = pub?.publicUrl;
    if (!url) {
      showMsg(contentMsg, "Fikk ikke public URL.", true);
      return;
    }
    window.CCFCContent.setByPath(contentState, "brand.logoUrl", url);
    window.CCFCContent.setByPath(contentState, "brand.faviconUrl", url);
    $("#logo-url-input").value = url;
    $("#favicon-url-input").value = url;
    $("#logo-preview").src = url;
    showMsg(contentMsg, "Logo lastet opp — husk å trykke Lagre innhold.");
  });

  async function uploadHeroSlide(file) {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `hero/slide-${Date.now()}.${ext}`;
    const { error: upErr } = await client.storage.from("media").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (upErr) throw upErr;
    const { data: pub } = client.storage.from("media").getPublicUrl(path);
    if (!pub?.publicUrl) throw new Error("Fikk ikke public URL.");
    return pub.publicUrl;
  }

  $("#hero-slide-upload-btn")?.addEventListener("click", async () => {
    const fileInput = $("#hero-slide-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      showMsg(contentMsg, "Velg et bilde først.", true);
      return;
    }
    if (!contentState) {
      showMsg(contentMsg, "Innhold er ikke lastet ennå.", true);
      return;
    }
    showMsg(contentMsg, "Laster opp slideshow-bilde…");
    try {
      flushContentFields();
      const url = await uploadHeroSlide(file);
      ensureHeroSlides().push({
        url,
        alt: "Coventry City i aksjon",
      });
      if (fileInput) fileInput.value = "";
      renderHeroSlidesEditor();
      showMsg(contentMsg, "Bilde lastet opp — husk å trykke Lagre innhold.");
    } catch (err) {
      showMsg(contentMsg, err.message || "Opplasting feilet.", true);
    }
  });

  $("#hero-slide-add-url-btn")?.addEventListener("click", () => {
    const input = $("#hero-slide-url-input");
    const url = input?.value?.trim();
    if (!url) {
      showMsg(contentMsg, "Lim inn en bilde-URL først.", true);
      return;
    }
    if (!contentState) {
      showMsg(contentMsg, "Innhold er ikke lastet ennå.", true);
      return;
    }
    flushContentFields();
    ensureHeroSlides().push({ url, alt: "Coventry City i aksjon" });
    if (input) input.value = "";
    renderHeroSlidesEditor();
    showMsg(contentMsg, "Bilde lagt til — husk å trykke Lagre innhold.");
  });

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /* —— Auth —— */
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authBusy) return;
    const fd = new FormData(e.target);
    setLoginBusy(true);
    showMsg(loginMsg, "Logger inn…");
    try {
      const session = await signInRaw(
        String(fd.get("email")).trim(),
        String(fd.get("password"))
      );
      await showApp(session);
    } catch (err) {
      console.error(err);
      setLoginBusy(false);
      showMsg(loginMsg, formatAuthError(err), true);
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    setLoginBusy(true);
    clearLocalSession();
    await showLogin();
    showMsg(loginMsg, "");
  });

  /* —— API settings —— */
  async function loadApiSettings() {
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", "api")
      .maybeSingle();
    if (error) {
      showMsg(apiMsg, error.message, true);
      return;
    }
    const v = data?.value || {};
    const form = $("#api-form");
    form.provider.value = v.provider || "football-data";
    form.season.value = v.season ?? 2026;
    form.team_name.value = v.team_name || "Coventry City";
    form.team_id_api_football.value = v.team_id_api_football ?? 1346;
    form.sync_day.value = v.sync_day || "monday";
    form.notes.value = v.notes || "";
  }

  $("#api-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const value = {
      provider: String(fd.get("provider")),
      season: Number(fd.get("season")),
      team_name: String(fd.get("team_name")),
      team_id_api_football: Number(fd.get("team_id_api_football") || 0) || null,
      sync_day: String(fd.get("sync_day")),
      notes: String(fd.get("notes") || ""),
    };
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("site_settings").upsert({
      key: "api",
      value,
      updated_by: sessionData.session?.user?.id || null,
    });
    if (error) showMsg(apiMsg, error.message, true);
    else showMsg(apiMsg, "Lagret.");
  });

  /* —— News —— */
  async function deleteNewsById(id) {
    if (!id) return false;
    if (!confirm("Slette denne artikkelen? Dette kan ikke angres.")) return false;
    const { error: delErr } = await client.from("news_posts").delete().eq("id", id);
    if (delErr) {
      showMsg(newsMsg, delErr.message, true);
      return false;
    }
    showMsg(newsMsg, "Artikkel slettet.");
    resetNewsForm();
    await loadNews();
    return true;
  }

  async function loadNews() {
    const { data, error } = await client
      .from("news_posts")
      .select("*")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    const list = $("#news-list");
    if (error) {
      list.innerHTML = `<p class="admin-msg is-error">${error.message}</p>`;
      return;
    }
    if (!data?.length) {
      list.innerHTML = `<p class="empty-state">Ingen artikler ennå.</p>`;
      return;
    }
    list.innerHTML = data
      .map((p) => {
        const badges = [
          p.published
            ? `<span class="badge">Publisert</span>`
            : `<span class="badge badge--draft">Utkast</span>`,
          p.show_on_home ? `<span class="badge">Forside</span>` : "",
        ].join("");
        const thumb = p.image_url
          ? `<img class="news-admin-item__thumb" src="${escapeAttr(
              window.CCFCContent?.assetPath
                ? window.CCFCContent.assetPath(p.image_url)
                : p.image_url
            )}" alt="" />`
          : "";
        return `<article class="news-admin-item" data-id="${p.id}">
          <div class="news-admin-item__main">
            ${thumb}
            <div>
              <h3>${escapeHtml(p.title)}</h3>
              <p>${badges}${escapeHtml(p.excerpt || "")}</p>
            </div>
          </div>
          <div class="row">
            <button type="button" class="btn btn--solid" data-edit="${p.id}">Rediger</button>
            <button type="button" class="btn btn--danger" data-delete="${p.id}">Slett</button>
          </div>
        </article>`;
      })
      .join("");

    list.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const post = data.find((p) => p.id === btn.dataset.edit);
        if (post) fillNewsForm(post);
      });
    });
    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteNewsById(btn.dataset.delete);
      });
    });
  }

  function fillNewsForm(post) {
    $("#news-form-title").textContent = "Rediger artikkel";
    $("#news-post-id").value = post.id || "";
    $("#news-title").value = post.title || "";
    $("#news-slug").value = post.slug || slugify(post.title || "");
    $("#news-excerpt").value = post.excerpt || "";
    $("#news-body").value = post.body || "";
    $("#news-published").checked = !!post.published;
    $("#news-show-on-home").checked = !!post.show_on_home;
    setNewsImageUrl(post.image_url || "");
    const delBtn = $("#news-delete");
    if (delBtn) delBtn.hidden = false;
    const saveBtn = $("#news-save-btn");
    if (saveBtn) saveBtn.textContent = "Oppdater artikkel";
    $("#news-title").focus();
    $("#news-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setNewsImageUrl(url) {
    const input = $("#news-image-url");
    const preview = $("#news-image-preview");
    const wrap = $("#news-image-preview-wrap");
    const removeBtn = $("#news-image-remove");
    const fileInput = $("#news-image-file");
    const value = (url || "").trim();
    if (input) input.value = value;
    if (fileInput) fileInput.value = "";
    if (preview) {
      preview.src = value
        ? window.CCFCContent?.assetPath
          ? window.CCFCContent.assetPath(value)
          : value
        : "";
    }
    if (wrap) wrap.hidden = !value;
    if (removeBtn) removeBtn.hidden = !value;
  }

  function resetNewsForm() {
    const form = $("#news-form");
    $("#news-form-title").textContent = "Legg til artikkel";
    form.reset();
    $("#news-post-id").value = "";
    $("#news-slug").value = "";
    $("#news-published").checked = true;
    $("#news-show-on-home").checked = true;
    setNewsImageUrl("");
    const delBtn = $("#news-delete");
    if (delBtn) delBtn.hidden = true;
    const saveBtn = $("#news-save-btn");
    if (saveBtn) saveBtn.textContent = "Lagre artikkel";
  }

  async function uploadNewsImage(file) {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `news/article-${Date.now()}.${ext}`;
    const { error: upErr } = await client.storage.from("media").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (upErr) throw upErr;
    const { data: pub } = client.storage.from("media").getPublicUrl(path);
    if (!pub?.publicUrl) throw new Error("Fikk ikke public URL.");
    return pub.publicUrl;
  }

  $("#news-image-upload-btn")?.addEventListener("click", async () => {
    const fileInput = $("#news-image-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      showMsg(newsMsg, "Velg et bilde først.", true);
      return;
    }
    showMsg(newsMsg, "Laster opp bilde…");
    try {
      const url = await uploadNewsImage(file);
      setNewsImageUrl(url);
      showMsg(newsMsg, "Bilde lastet opp — husk å lagre artikkelen.");
    } catch (err) {
      showMsg(newsMsg, err.message || "Opplasting feilet.", true);
    }
  });

  $("#news-image-remove")?.addEventListener("click", () => {
    setNewsImageUrl("");
    showMsg(newsMsg, "Bilde fjernet — husk å lagre artikkelen.");
  });

  $("#news-image-url")?.addEventListener("input", () => {
    const url = $("#news-image-url")?.value?.trim() || "";
    const preview = $("#news-image-preview");
    const wrap = $("#news-image-preview-wrap");
    const removeBtn = $("#news-image-remove");
    if (preview) {
      preview.src = url
        ? window.CCFCContent?.assetPath
          ? window.CCFCContent.assetPath(url)
          : url
        : "";
    }
    if (wrap) wrap.hidden = !url;
    if (removeBtn) removeBtn.hidden = !url;
  });

  function syncNewsSlugFromTitle() {
    const title = $("#news-title")?.value || "";
    const slugEl = $("#news-slug");
    if (!slugEl) return;
    // Keep existing slug when editing so gamle lenker fortsatt virker;
    // for nye artikler genereres slug alltid fra tittel.
    if ($("#news-post-id")?.value) return;
    slugEl.value = slugify(title) || `artikkel-${Date.now()}`;
  }

  $("#news-reset").addEventListener("click", resetNewsForm);
  $("#news-new-btn")?.addEventListener("click", () => {
    resetNewsForm();
    showMsg(newsMsg, "");
    $("#news-title")?.focus();
    $("#news-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#news-delete")?.addEventListener("click", async () => {
    const id = $("#news-post-id")?.value;
    await deleteNewsById(id);
  });

  $("#news-title")?.addEventListener("input", syncNewsSlugFromTitle);

  $("#news-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { data: sessionData } = await client.auth.getSession();
    const id = String(fd.get("post_id") || "").trim();
    const title = String(fd.get("title") || "").trim();
    let slug = String(fd.get("slug") || "").trim();

    // Always ensure a valid slug automatically — never rely on manual input
    if (!id || !slug) {
      slug = slugify(title) || `artikkel-${Date.now()}`;
      $("#news-slug").value = slug;
    }

    // Upload pending file on save if user selected one without pressing upload
    const pendingFile = $("#news-image-file")?.files?.[0];
    if (pendingFile) {
      showMsg(newsMsg, "Laster opp bilde…");
      try {
        const url = await uploadNewsImage(pendingFile);
        setNewsImageUrl(url);
      } catch (err) {
        showMsg(newsMsg, err.message || "Opplasting feilet.", true);
        return;
      }
    }

    const published = !!fd.get("published");
    const imageUrl = String($("#news-image-url")?.value || fd.get("image_url") || "").trim();
    const payload = {
      title,
      slug,
      excerpt: String(fd.get("excerpt") || ""),
      body: String(fd.get("body") || ""),
      image_url: imageUrl || null,
      published,
      show_on_home: !!fd.get("show_on_home"),
      published_at: published ? new Date().toISOString() : null,
      author_id: sessionData.session?.user?.id || null,
    };

    let error;
    if (id) {
      ({ error } = await client.from("news_posts").update(payload).eq("id", id));
    } else {
      let attempt = slug;
      for (let n = 2; n < 50; n++) {
        ({ error } = await client
          .from("news_posts")
          .insert({ ...payload, slug: attempt }));
        if (!error) {
          payload.slug = attempt;
          break;
        }
        if (!/duplicate|unique|already exists/i.test(error.message || "")) break;
        attempt = `${slug}-${n}`;
      }
    }

    if (error) showMsg(newsMsg, error.message, true);
    else {
      showMsg(newsMsg, "Lagret.");
      resetNewsForm();
      await loadNews();
    }
  });

  /* —— Ryktebørsen —— */
  const RUMOR_TAG_LABELS = {
    rykte: "Rykte",
    bekreftet: "Bekreftet",
    avvist: "Avvist",
  };

  const DEFAULT_RUMOR_KEYWORDS = ["Coventry", "Sky Blues", "CCFC", "CBS Arena"];

  const DEFAULT_RUMOR_SOURCES = [
    {
      name: "Coventry Telegraph",
      url: "https://www.coventrytelegraph.net/sport/football/rss.xml",
    },
    {
      name: "Guardian Transfer",
      url: "https://www.theguardian.com/football/transfer-window/rss",
    },
  ];

  function parseKeywordLines(text) {
    return String(text || "")
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter(Boolean)
      .filter((k, i, arr) => arr.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i);
  }

  function parseSourceLines(text) {
    const lines = String(text || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const sources = [];
    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      let name = "";
      let url = "";
      if (parts.length >= 2) {
        name = parts[0];
        url = parts.slice(1).join("|").trim();
      } else {
        url = parts[0];
      }
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        if (!name) {
          name = u.hostname.replace(/^www\./, "");
        }
        sources.push({ name, url: u.href });
      } catch {
        /* skip invalid */
      }
    }
    return sources.filter(
      (s, i, arr) => arr.findIndex((x) => x.url === s.url) === i
    );
  }

  function formatSourceLines(sources) {
    return (sources || []).map((s) => `${s.name} | ${s.url}`).join("\n");
  }

  async function loadRumorKeywords() {
    const el = $("#rumor-keywords");
    if (!el) return;
    try {
      const remote = await loadSetting("rumor_keywords");
      const keywords = Array.isArray(remote?.keywords) && remote.keywords.length
        ? remote.keywords.map((k) => String(k).trim()).filter(Boolean)
        : DEFAULT_RUMOR_KEYWORDS;
      el.value = keywords.join("\n");
    } catch (err) {
      el.value = DEFAULT_RUMOR_KEYWORDS.join("\n");
      showMsg(rumorKeywordsMsg, err.message || "Kunne ikke hente søkeord.", true);
    }
  }

  async function loadRumorSources() {
    const el = $("#rumor-sources");
    if (!el) return;
    try {
      const remote = await loadSetting("rumor_sources");
      const sources = Array.isArray(remote?.sources) && remote.sources.length
        ? remote.sources
        : DEFAULT_RUMOR_SOURCES;
      el.value = formatSourceLines(sources);
    } catch (err) {
      el.value = formatSourceLines(DEFAULT_RUMOR_SOURCES);
      showMsg(rumorSourcesMsg, err.message || "Kunne ikke hente kilder.", true);
    }
  }

  $("#rumor-keywords-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const keywords = parseKeywordLines($("#rumor-keywords")?.value);
    if (!keywords.length) {
      showMsg(rumorKeywordsMsg, "Legg inn minst ett søkeord.", true);
      return;
    }
    try {
      await saveSetting("rumor_keywords", { keywords });
      $("#rumor-keywords").value = keywords.join("\n");
      showMsg(rumorKeywordsMsg, `Lagret ${keywords.length} søkeord.`);
    } catch (err) {
      showMsg(rumorKeywordsMsg, err.message || "Kunne ikke lagre søkeord.", true);
    }
  });

  $("#rumor-sources-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sources = parseSourceLines($("#rumor-sources")?.value);
    if (!sources.length) {
      showMsg(rumorSourcesMsg, "Legg inn minst én gyldig RSS-URL.", true);
      return;
    }
    try {
      await saveSetting("rumor_sources", { sources });
      $("#rumor-sources").value = formatSourceLines(sources);
      showMsg(rumorSourcesMsg, `Lagret ${sources.length} kilder.`);
    } catch (err) {
      showMsg(rumorSourcesMsg, err.message || "Kunne ikke lagre kilder.", true);
    }
  });

  async function deleteRumorById(id) {
    if (!id) return false;
    if (!confirm("Slette dette ryktet? Dette kan ikke angres.")) return false;
    const { error: delErr } = await client.from("rumor_posts").delete().eq("id", id);
    if (delErr) {
      showMsg(rumorMsg, delErr.message, true);
      return false;
    }
    showMsg(rumorMsg, "Rykte slettet.");
    resetRumorForm();
    await loadRumors();
    return true;
  }

  async function loadRumors() {
    const list = $("#rumor-list");
    if (!list) return;
    const { data, error } = await client
      .from("rumor_posts")
      .select("*")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) {
      list.innerHTML = `<p class="admin-msg is-error">${escapeHtml(error.message)}</p>
        <p class="empty-state">Kjør migrasjonen <code>20260806120000_rumor_posts.sql</code> i Supabase hvis tabellen mangler.</p>`;
      return;
    }
    if (!data?.length) {
      list.innerHTML = `<p class="empty-state">Ingen rykter ennå.</p>`;
      return;
    }
    list.innerHTML = data
      .map((p) => {
        const tagLabel = RUMOR_TAG_LABELS[p.tag] || p.tag || "Rykte";
        const badges = [
          p.published
            ? `<span class="badge">Publisert</span>`
            : `<span class="badge badge--draft">Utkast</span>`,
          `<span class="badge">${escapeHtml(tagLabel)}</span>`,
        ].join("");
        return `<article class="news-admin-item" data-id="${p.id}">
          <div class="news-admin-item__main">
            <div>
              <h3>${escapeHtml(p.title)}</h3>
              <p>${badges}${escapeHtml(p.summary || "")}</p>
              <p style="margin-top:0.35rem">${escapeHtml(p.source_name || "")}</p>
            </div>
          </div>
          <div class="row">
            <button type="button" class="btn btn--solid" data-edit-rumor="${p.id}">Rediger</button>
            <button type="button" class="btn btn--danger" data-delete-rumor="${p.id}">Slett</button>
          </div>
        </article>`;
      })
      .join("");

    list.querySelectorAll("[data-edit-rumor]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const post = data.find((p) => p.id === btn.dataset.editRumor);
        if (post) fillRumorForm(post);
      });
    });
    list.querySelectorAll("[data-delete-rumor]").forEach((btn) => {
      btn.addEventListener("click", () => deleteRumorById(btn.dataset.deleteRumor));
    });
  }

  function fillRumorForm(post) {
    $("#rumor-form-title").textContent = "Rediger rykte";
    $("#rumor-post-id").value = post.id || "";
    $("#rumor-title").value = post.title || "";
    $("#rumor-slug").value = post.slug || slugify(post.title || "");
    $("#rumor-summary").value = post.summary || "";
    $("#rumor-source-name").value = post.source_name || "";
    $("#rumor-source-url").value = post.source_url || "";
    $("#rumor-tag").value = RUMOR_TAG_LABELS[post.tag] ? post.tag : "rykte";
    $("#rumor-published").checked = !!post.published;
    const delBtn = $("#rumor-delete");
    if (delBtn) delBtn.hidden = false;
    const saveBtn = $("#rumor-save-btn");
    if (saveBtn) saveBtn.textContent = "Oppdater rykte";
    $("#rumor-title").focus();
    $("#rumor-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetRumorForm() {
    const form = $("#rumor-form");
    form?.reset();
    $("#rumor-form-title").textContent = "Legg til rykte";
    $("#rumor-post-id").value = "";
    $("#rumor-slug").value = "";
    $("#rumor-published").checked = true;
    $("#rumor-tag").value = "rykte";
    const delBtn = $("#rumor-delete");
    if (delBtn) delBtn.hidden = true;
    const saveBtn = $("#rumor-save-btn");
    if (saveBtn) saveBtn.textContent = "Lagre rykte";
  }

  function syncRumorSlugFromTitle() {
    const title = $("#rumor-title")?.value || "";
    const slugEl = $("#rumor-slug");
    if (!slugEl) return;
    if ($("#rumor-post-id")?.value) return;
    slugEl.value = slugify(title);
  }

  $("#rumor-reset")?.addEventListener("click", resetRumorForm);
  $("#rumor-new-btn")?.addEventListener("click", () => {
    resetRumorForm();
    showMsg(rumorMsg, "");
    $("#rumor-title")?.focus();
    $("#rumor-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#rumor-delete")?.addEventListener("click", async () => {
    const id = $("#rumor-post-id")?.value;
    if (id) await deleteRumorById(id);
  });
  $("#rumor-title")?.addEventListener("input", syncRumorSlugFromTitle);

  $("#rumor-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = String(fd.get("post_id") || "").trim();
    let slug = String(fd.get("slug") || "").trim() || slugify(String(fd.get("title") || ""));
    if (!slug) slug = `rykte-${Date.now()}`;
    $("#rumor-slug").value = slug;

    const tagRaw = String(fd.get("tag") || "rykte");
    const tag = RUMOR_TAG_LABELS[tagRaw] ? tagRaw : "rykte";
    const sourceUrl = String(fd.get("source_url") || "").trim();
    try {
      const u = new URL(sourceUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        showMsg(rumorMsg, "Lenken må starte med http:// eller https://", true);
        return;
      }
    } catch {
      showMsg(rumorMsg, "Ugyldig lenke til original.", true);
      return;
    }

    const published = !!fd.get("published");
    const { data: sessionData } = await client.auth.getSession();
    const payload = {
      slug,
      title: String(fd.get("title") || "").trim(),
      summary: String(fd.get("summary") || "").trim(),
      source_name: String(fd.get("source_name") || "").trim(),
      source_url: sourceUrl,
      tag,
      published,
      published_at: published ? new Date().toISOString() : null,
      author_id: sessionData.session?.user?.id || null,
    };

    let error;
    if (id) {
      ({ error } = await client.from("rumor_posts").update(payload).eq("id", id));
    } else {
      let attempt = slug;
      for (let n = 2; n < 50; n++) {
        ({ error } = await client.from("rumor_posts").insert({ ...payload, slug: attempt }));
        if (!error) break;
        if (!/duplicate|unique|already exists/i.test(error.message || "")) break;
        attempt = `${slug}-${n}`;
      }
    }

    if (error) showMsg(rumorMsg, error.message, true);
    else {
      showMsg(rumorMsg, "Lagret.");
      resetRumorForm();
      await loadRumors();
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function newId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatNbDate(isoOrDate) {
    if (!isoOrDate) return "";
    const d = new Date(isoOrDate.includes("T") ? isoOrDate : isoOrDate + "T12:00:00");
    if (Number.isNaN(d.getTime())) return String(isoOrDate);
    return d.toLocaleDateString("nb-NO", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  async function loadSetting(key) {
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return data?.value || null;
  }

  async function saveSetting(key, value) {
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("site_settings").upsert({
      key,
      value,
      updated_by: sessionData.session?.user?.id || null,
    });
    if (error) throw error;
  }

  /* —— Changelog —— */
  const changelogMsg = $("#changelog-msg");
  let changelogCustom = [];
  let changelogBuiltin = [];

  async function loadBuiltinChangelog() {
    try {
      const res = await fetch(`../assets/data/changelog.json?v=${encodeURIComponent(CACHE_BUST)}`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch {
      return [];
    }
  }

  function mergeChangelogEntries() {
    const custom = (changelogCustom || []).map((e) => ({ ...e, source: "custom" }));
    const builtin = (changelogBuiltin || []).map((e) => ({ ...e, source: "builtin" }));
    return [...custom, ...builtin].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  function renderChangelog() {
    const host = $("#changelog-list");
    if (!host) return;
    const entries = mergeChangelogEntries();
    if (!entries.length) {
      host.innerHTML = `<p class="empty-state">Ingen oppføringer i endringsloggen ennå.</p>`;
      return;
    }
    host.innerHTML = entries
      .map((e) => {
        const items = Array.isArray(e.items) ? e.items : String(e.body || "").split(/\n+/).filter(Boolean);
        const source =
          e.source === "custom"
            ? `<span class="badge">Lagt til</span>`
            : `<span class="badge">System</span>`;
        const remove =
          e.source === "custom"
            ? `<button type="button" class="btn btn--danger" data-changelog-remove="${escapeAttr(e.id || "")}">Fjern</button>`
            : "";
        return `<article class="changelog-entry" data-id="${escapeAttr(e.id || "")}">
          <div class="changelog-entry__meta">
            <span>${escapeHtml(formatNbDate(e.date))}</span>
            <span class="changelog-entry__source">${source}</span>
          </div>
          <h3>${escapeHtml(e.title || "Uten tittel")}</h3>
          <ul>${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>
          ${remove ? `<div class="row" style="margin-top:0.75rem">${remove}</div>` : ""}
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-changelog-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-changelog-remove");
        if (!id || !confirm("Fjerne denne oppføringen fra endringsloggen?")) return;
        changelogCustom = changelogCustom.filter((e) => e.id !== id);
        try {
          await saveSetting("changelog", { entries: changelogCustom });
          renderChangelog();
          showMsg(changelogMsg, "Oppføring fjernet.");
        } catch (err) {
          showMsg(changelogMsg, err.message || "Kunne ikke lagre.", true);
        }
      });
    });
  }

  async function loadChangelog() {
    const dateInput = $("#changelog-form")?.date;
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    try {
      changelogBuiltin = await loadBuiltinChangelog();
      const remote = await loadSetting("changelog");
      changelogCustom = Array.isArray(remote?.entries) ? remote.entries : [];
      renderChangelog();
    } catch (err) {
      const host = $("#changelog-list");
      if (host) host.innerHTML = `<p class="admin-msg is-error">${escapeHtml(err.message)}</p>`;
    }
  }

  $("#changelog-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const items = String(fd.get("items") || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) {
      showMsg(changelogMsg, "Legg inn minst ett punkt.", true);
      return;
    }
    const entry = {
      id: newId(),
      date: String(fd.get("date")),
      title: String(fd.get("title")).trim(),
      items,
      created_at: new Date().toISOString(),
    };
    changelogCustom = [entry, ...changelogCustom];
    try {
      await saveSetting("changelog", { entries: changelogCustom });
      e.target.reset();
      if (e.target.date) e.target.date.value = new Date().toISOString().slice(0, 10);
      renderChangelog();
      showMsg(changelogMsg, "Lagt til i endringsloggen.");
    } catch (err) {
      showMsg(changelogMsg, err.message || "Kunne ikke lagre.", true);
    }
  });

  /* —— Feedback / wishes —— */
  const feedbackMsg = $("#feedback-msg");
  let feedbackItems = [];
  let feedbackFilter = "open";

  function renderFeedback() {
    const host = $("#feedback-list");
    if (!host) return;

    let list = [...feedbackItems];
    if (feedbackFilter === "open") list = list.filter((i) => !i.done);
    else if (feedbackFilter === "done") list = list.filter((i) => i.done);

    list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    if (!list.length) {
      const empty =
        feedbackFilter === "done"
          ? "Ingen gjennomførte ønsker ennå."
          : feedbackFilter === "open"
            ? "Ingen åpne ønsker. Legg inn et forslag over."
            : "Ingen ønsker registrert ennå.";
      host.innerHTML = `<p class="empty-state">${empty}</p>`;
      return;
    }

    host.innerHTML = list
      .map((item) => {
        const author = item.author ? escapeHtml(item.author) : "Uten navn";
        const when = formatNbDate(item.created_at || item.date || "");
        const doneMeta = item.done
          ? ` · Gjennomført ${escapeHtml(formatNbDate(item.done_at || ""))}`
          : "";
        return `<article class="feedback-item${item.done ? " is-done" : ""}" data-id="${escapeAttr(item.id)}">
          <label class="feedback-item__check" title="Marker som gjennomført">
            <input type="checkbox" data-feedback-done ${item.done ? "checked" : ""} aria-label="Gjennomført" />
          </label>
          <div>
            <div class="feedback-item__meta">
              <span>${author}</span>
              <span>${escapeHtml(when)}${doneMeta}</span>
              ${item.done ? `<span class="badge">Gjennomført</span>` : `<span class="badge badge--draft">Åpen</span>`}
            </div>
            <p class="feedback-item__body">${escapeHtml(item.body || "")}</p>
          </div>
          <div class="feedback-item__actions">
            <button type="button" class="btn btn--danger" data-feedback-delete>Slett</button>
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-feedback-done]").forEach((box) => {
      box.addEventListener("change", async () => {
        const id = box.closest("[data-id]")?.getAttribute("data-id");
        const item = feedbackItems.find((i) => i.id === id);
        if (!item) return;
        item.done = box.checked;
        item.done_at = box.checked ? new Date().toISOString() : null;
        try {
          await saveSetting("change_requests", { items: feedbackItems });
          renderFeedback();
          showMsg(
            feedbackMsg,
            box.checked ? "Markert som gjennomført." : "Markert som åpen igjen."
          );
        } catch (err) {
          showMsg(feedbackMsg, err.message || "Kunne ikke lagre.", true);
          await loadFeedback();
        }
      });
    });

    host.querySelectorAll("[data-feedback-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        if (!id || !confirm("Slette dette ønsket?")) return;
        feedbackItems = feedbackItems.filter((i) => i.id !== id);
        try {
          await saveSetting("change_requests", { items: feedbackItems });
          renderFeedback();
          showMsg(feedbackMsg, "Slettet.");
        } catch (err) {
          showMsg(feedbackMsg, err.message || "Kunne ikke slette.", true);
        }
      });
    });
  }

  async function loadFeedback() {
    try {
      const remote = await loadSetting("change_requests");
      feedbackItems = Array.isArray(remote?.items) ? remote.items : [];
      renderFeedback();
    } catch (err) {
      const host = $("#feedback-list");
      if (host) host.innerHTML = `<p class="admin-msg is-error">${escapeHtml(err.message)}</p>`;
    }
  }

  $("#feedback-filters")?.querySelectorAll("[data-feedback-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      feedbackFilter = btn.getAttribute("data-feedback-filter") || "open";
      $("#feedback-filters")
        ?.querySelectorAll("[data-feedback-filter]")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      renderFeedback();
    });
  });

  $("#feedback-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = String(fd.get("body") || "").trim();
    if (!body) {
      showMsg(feedbackMsg, "Skriv inn en kommentar.", true);
      return;
    }
    const { data: sessionData } = await client.auth.getSession();
    const item = {
      id: newId(),
      author: String(fd.get("author") || "").trim() || sessionData.session?.user?.email || "",
      body,
      done: false,
      done_at: null,
      created_at: new Date().toISOString(),
      created_by: sessionData.session?.user?.id || null,
    };
    feedbackItems = [item, ...feedbackItems];
    try {
      await saveSetting("change_requests", { items: feedbackItems });
      e.target.reset();
      feedbackFilter = "open";
      $("#feedback-filters")
        ?.querySelectorAll("[data-feedback-filter]")
        .forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-feedback-filter") === "open")
        );
      renderFeedback();
      showMsg(feedbackMsg, "Ønske lagt inn.");
    } catch (err) {
      showMsg(feedbackMsg, err.message || "Kunne ikke lagre.", true);
    }
  });

  /* —— Members —— */
  const memberAdminMsg = $("#member-admin-msg");
  const mailOutboxMsg = $("#mail-outbox-msg");
  const memberTemplatesMsg = $("#member-templates-msg");
  let membersItems = [];
  let memberFilter = "pending";
  let memberSearch = "";
  let mailOutboxRows = [];

  function statusLabel(status) {
    return (
      {
        pending: "Til godkjenning",
        pending_payment: "Til godkjenning",
        active: "Aktiv",
        cancelled: "Utmeldt",
        lapsed: "Utmeldt",
      }[status] || status
    );
  }

  function normalizeMemberStatus(status) {
    if (status === "pending_payment") return "pending";
    if (status === "lapsed") return "cancelled";
    return status;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("nb-NO");
    } catch {
      return "—";
    }
  }

  function renderMembers() {
    const host = $("#members-list");
    if (!host) return;
    let list = [...membersItems];
    if (memberFilter !== "all") {
      list = list.filter((m) => normalizeMemberStatus(m.status) === memberFilter);
    }
    const q = memberSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const blob = `${m.full_name || ""} ${m.email || ""} ${m.phone || ""}`.toLowerCase();
        return blob.includes(q);
      });
    }
    if (!list.length) {
      host.innerHTML = `<p class="empty-state">Ingen medlemmer i denne listen.</p>`;
      return;
    }
    host.innerHTML = list
      .map((m) => {
        const st = normalizeMemberStatus(m.status);
        const badgeClass =
          st === "active" ? "" : st === "pending" ? " badge--pending" : " badge--draft";
        const actions = [];
        if (st === "pending") {
          actions.push(`<button type="button" class="btn btn--sky" data-member-approve>Godkjenn</button>`);
          actions.push(`<button type="button" class="btn btn--danger" data-member-cancel>Avvis / meld ut</button>`);
        } else if (st === "active") {
          actions.push(`<button type="button" class="btn btn--danger" data-member-cancel>Meld ut</button>`);
        }
        return `<article class="member-admin-item" data-id="${escapeAttr(m.id)}">
          <div>
            <h3>${escapeHtml(m.full_name || "")}</h3>
            <p>
              <span class="badge${badgeClass}">${escapeHtml(statusLabel(m.status))}</span>
              ${escapeHtml(m.email || "")}
              ${m.phone ? ` · ${escapeHtml(m.phone)}` : ""}
              ${m.country ? ` · ${escapeHtml(m.country)}` : ""}
            </p>
            <p class="member-admin-meta">
              Opprettet ${escapeHtml(formatDate(m.created_at))}
              ${m.joined_at ? ` · Godkjent ${escapeHtml(formatDate(m.joined_at))}` : ""}
              ${m.cancelled_at ? ` · Utmeldt ${escapeHtml(formatDate(m.cancelled_at))}` : ""}
              ${m.source ? ` · ${escapeHtml(m.source)}` : ""}
            </p>
          </div>
          <div class="row member-admin-actions">${actions.join("\n")}</div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-member-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        if (!id) return;
        if (!confirm("Godkjenne medlemmet og legge velkomstmail i kø?")) return;
        try {
          const { error } = await client.rpc("approve_member", { p_member_id: id });
          if (error) throw error;
          showMsg(memberAdminMsg, "Godkjent. Velkomstmail ligger i e-postkøen.");
          await loadMembers();
          await loadMailOutbox();
        } catch (err) {
          showMsg(memberAdminMsg, err.message || "Kunne ikke godkjenne.", true);
        }
      });
    });

    host.querySelectorAll("[data-member-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        if (!id) return;
        const member = membersItems.find((m) => m.id === id);
        const st = normalizeMemberStatus(member?.status);
        const ok =
          st === "pending"
            ? confirm("Avvise denne innmeldingen? (ingen mail sendes)")
            : confirm("Melde ut medlemmet? Det får avslutningsmail i køen.");
        if (!ok) return;
        try {
          const { error } = await client.rpc("cancel_member_admin", { p_member_id: id });
          if (error) throw error;
          showMsg(
            memberAdminMsg,
            st === "pending" ? "Innmelding avvist." : "Utmeldt. Avslutningsmail ligger i e-postkøen."
          );
          await loadMembers();
          await loadMailOutbox();
        } catch (err) {
          showMsg(memberAdminMsg, err.message || "Kunne ikke melde ut.", true);
        }
      });
    });
  }

  async function loadMembers() {
    const host = $("#members-list");
    if (!host) return;
    const { data, error } = await client
      .from("members")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      host.innerHTML = `<p class="admin-msg is-error">${escapeHtml(error.message)}</p>`;
      return;
    }
    membersItems = data || [];
    renderMembers();
  }

  $("#member-filters")?.querySelectorAll("[data-member-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      memberFilter = btn.getAttribute("data-member-filter") || "pending";
      $("#member-filters")
        ?.querySelectorAll("[data-member-filter]")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      renderMembers();
    });
  });

  $("#member-search")?.addEventListener("input", (e) => {
    memberSearch = e.target.value || "";
    renderMembers();
  });

  $("#member-admin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fullName = String(fd.get("full_name") || "").trim();
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const phone = String(fd.get("phone") || "").replace(/\s+/g, "");
    const country = String(fd.get("country") || "NO");
    const notes = String(fd.get("notes") || "").trim();
    if (!fullName || !email) {
      showMsg(memberAdminMsg, "Navn og e-post er påkrevd.", true);
      return;
    }
    try {
      const { error } = await client.rpc("admin_create_member", {
        p_full_name: fullName,
        p_email: email,
        p_phone: phone,
        p_country: country,
        p_notes: notes,
      });
      if (error) throw error;
      e.target.reset();
      showMsg(memberAdminMsg, "Medlem lagt inn. Velkomstmail ligger i e-postkøen.");
      memberFilter = "active";
      $("#member-filters")
        ?.querySelectorAll("[data-member-filter]")
        .forEach((b) =>
          b.classList.toggle("is-active", b.getAttribute("data-member-filter") === "active")
        );
      await loadMembers();
      await loadMailOutbox();
    } catch (err) {
      showMsg(memberAdminMsg, err.message || "Kunne ikke lagre medlem.", true);
    }
  });

  async function loadMemberTemplates() {
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", "member_mail_templates")
      .maybeSingle();
    if (error) {
      showMsg(memberTemplatesMsg, error.message, true);
      return;
    }
    const v = data?.value || {};
    const welcome = v.welcome || {};
    const cancelled = v.cancelled || {};
    const ws = $("#tpl-welcome-subject");
    const wh = $("#tpl-welcome-html");
    const cs = $("#tpl-cancelled-subject");
    const ch = $("#tpl-cancelled-html");
    if (ws) ws.value = welcome.subject || "";
    if (wh) wh.value = welcome.html || "";
    if (cs) cs.value = cancelled.subject || "";
    if (ch) ch.value = cancelled.html || "";
  }

  $("#member-templates-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = {
      welcome: {
        subject: String($("#tpl-welcome-subject")?.value || "").trim(),
        html: String($("#tpl-welcome-html")?.value || "").trim(),
      },
      cancelled: {
        subject: String($("#tpl-cancelled-subject")?.value || "").trim(),
        html: String($("#tpl-cancelled-html")?.value || "").trim(),
      },
    };
    if (!value.welcome.subject || !value.welcome.html || !value.cancelled.subject || !value.cancelled.html) {
      showMsg(memberTemplatesMsg, "Fyll inn alle mal-feltene.", true);
      return;
    }
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("site_settings").upsert({
      key: "member_mail_templates",
      value,
      updated_by: sessionData.session?.user?.id || null,
    });
    if (error) showMsg(memberTemplatesMsg, error.message, true);
    else showMsg(memberTemplatesMsg, "Maler lagret.");
  });

  function renderMailOutbox(rows) {
    const host = $("#mail-outbox-list");
    if (!host) return;
    if (!rows?.length) {
      host.innerHTML = `<p class="empty-state">Ingen e-poster i køen.</p>`;
      return;
    }
    host.innerHTML = rows
      .map((r) => {
        const mailto = `mailto:${encodeURIComponent(r.to_email)}?subject=${encodeURIComponent(
          r.subject || ""
        )}&body=${encodeURIComponent(r.body_text || "")}`;
        return `<article class="mail-outbox-item" data-id="${escapeAttr(r.id)}">
          <div>
            <h3>${escapeHtml(r.subject || "")}</h3>
            <p>
              <span class="badge${
                r.status === "pending" ? " badge--pending" : r.status === "sent" ? "" : " badge--draft"
              }">${escapeHtml(r.status)}</span>
              ${escapeHtml(r.to_email)} · ${escapeHtml(r.kind || "")}
            </p>
            <p class="member-admin-meta">${escapeHtml(formatDate(r.created_at))}</p>
          </div>
          <div class="row member-admin-actions">
            ${
              r.status === "pending"
                ? `<a class="btn btn--sky" href="${escapeAttr(mailto)}">Åpne mailto</a>
                   <button type="button" class="btn btn--solid" data-mail-sent>Marker sendt</button>
                   <button type="button" class="btn btn--danger" data-mail-cancel>Avbryt</button>`
                : ""
            }
            ${
              r.body_html
                ? `<button type="button" class="btn btn--solid" data-mail-copy-html>Kopier HTML</button>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-mail-sent]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        if (!id) return;
        const { error } = await client
          .from("member_mail_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", id);
        if (error) showMsg(mailOutboxMsg, error.message, true);
        else {
          showMsg(mailOutboxMsg, "Markert som sendt.");
          await loadMailOutbox();
        }
      });
    });

    host.querySelectorAll("[data-mail-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        if (!id) return;
        const { error } = await client
          .from("member_mail_outbox")
          .update({ status: "cancelled" })
          .eq("id", id);
        if (error) showMsg(mailOutboxMsg, error.message, true);
        else await loadMailOutbox();
      });
    });

    host.querySelectorAll("[data-mail-copy-html]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-id]")?.getAttribute("data-id");
        const row = mailOutboxRows.find((r) => r.id === id);
        if (!row?.body_html) return;
        try {
          await navigator.clipboard.writeText(row.body_html);
          showMsg(mailOutboxMsg, "HTML kopiert.");
        } catch {
          window.prompt("HTML:", row.body_html);
        }
      });
    });
  }

  async function loadMailOutbox() {
    const host = $("#mail-outbox-list");
    if (!host) return;
    const { data, error } = await client
      .from("member_mail_outbox")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      host.innerHTML = `<p class="admin-msg is-error">${escapeHtml(error.message)}</p>`;
      return;
    }
    mailOutboxRows = data || [];
    renderMailOutbox(mailOutboxRows);
  }

  $("#mail-outbox-reload")?.addEventListener("click", () => loadMailOutbox());

  /* —— boot —— */
  loginView.hidden = false;
  appView.hidden = true;

  (async () => {
    try {
      const { data } = await withTimeout(client.auth.getSession(), 5000, "Sesjon");
      bootDone = true;
      if (data?.session) await showApp(data.session);
      else await showLogin();
    } catch (err) {
      console.warn(err);
      bootDone = true;
      clearLocalSession();
      await showLogin();
    }
  })();

  client.auth.onAuthStateChange((event, session) => {
    afterAuthLock(async () => {
      if (!bootDone) return;
      if (event === "SIGNED_OUT") {
        await showLogin();
        return;
      }
      if (event === "TOKEN_REFRESHED") return;
      // SIGNED_IN from our raw login is handled in the form submit path.
      if (event === "INITIAL_SESSION" && session) {
        await showApp(session);
      }
    });
  });
})();

