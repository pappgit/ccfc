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

      await Promise.allSettled([loadContentEditor(), loadApiSettings(), loadNews()]);
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
        { path: "nav.home", label: "Hjem", type: "text" },
        { path: "nav.fixtures", label: "Kamper", type: "text" },
        { path: "nav.stats", label: "Statistikk", type: "text" },
        { path: "nav.news", label: "Nyheter", type: "text" },
        { path: "nav.about", label: "Om oss", type: "text" },
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
        { path: "footer.text", label: "Tekst", type: "textarea" },
        { path: "footer.tagline", label: "Tagline", type: "text" },
        { path: "footer.adminLabel", label: "Admin-lenke", type: "text" },
      ],
    },
  ];

  let contentState = null;
  let activeContentSection = "brand";
  const contentMsg = $("#content-msg");

  function flushContentFields() {
    if (!contentState) return;
    const form = $("#content-form");
    form
      ?.querySelectorAll("#content-fields [name], #logo-url-input, #favicon-url-input, #hero-interval-input")
      .forEach((el) => {
        if (!el.name) return;
        let val = el.value;
        if (el.name === "home.heroSlideInterval") {
          val = Number(val) || 6500;
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
              <input type="url" data-field="url" value="${escapeAttr(s.url || "")}" />
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

    host.innerHTML = `<div class="admin-card"><h2>${section.label}</h2>${section.fields
      .map((f) => {
        const val = window.CCFCContent.getByPath(contentState, f.path) ?? "";
        if (f.type === "textarea") {
          return `<label>${f.label}<textarea name="${f.path}" rows="3">${escapeHtml(val)}</textarea></label>`;
        }
        return `<label>${f.label}<input type="text" name="${f.path}" value="${escapeAttr(val)}" /></label>`;
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
    return contentState;
  }

  async function loadContentEditor() {
    if (!window.CCFCContent) return;
    window.CCFCContent.clearCache();
    contentState = await window.CCFCContent.load({ bypassCache: true });

    // Seed slideshow from defaults if missing in stored CMS (older saves)
    const slides = window.CCFCContent.getByPath(contentState, "home.heroSlides");
    if (!Array.isArray(slides) || !slides.length) {
      try {
        const depth = location.pathname.includes("/admin") ? "../" : "";
        const res = await fetch(depth + "assets/data/site-content.default.json");
        if (res.ok) {
          const defaults = await res.json();
          if (Array.isArray(defaults?.home?.heroSlides)) {
            window.CCFCContent.setByPath(contentState, "home.heroSlides", defaults.home.heroSlides);
          }
          if (window.CCFCContent.getByPath(contentState, "home.heroSlideInterval") == null) {
            window.CCFCContent.setByPath(
              contentState,
              "home.heroSlideInterval",
              defaults?.home?.heroSlideInterval ?? 6500
            );
          }
        }
      } catch {
        /* ignore */
      }
    }

    renderContentTabs();
    renderContentFields();
  }

  $("#content-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = collectContentForm();
    const { data: sessionData } = await client.auth.getSession();
    const { error } = await client.from("site_settings").upsert({
      key: "site",
      value,
      updated_by: sessionData.session?.user?.id || null,
    });
    if (error) showMsg(contentMsg, error.message, true);
    else {
      contentState = value;
      window.CCFCContent.clearCache();
      showMsg(contentMsg, "Innhold lagret. Oppdater forsiden for å se endringene.");
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
        return `<article class="news-admin-item" data-id="${p.id}">
          <div>
            <h3>${escapeHtml(p.title)}</h3>
            <p>${badges}${escapeHtml(p.excerpt || "")}</p>
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
    const form = $("#news-form");
    $("#news-form-title").textContent = "Rediger artikkel";
    form.id.value = post.id;
    form.title.value = post.title;
    form.slug.value = post.slug;
    form.excerpt.value = post.excerpt || "";
    form.body.value = post.body || "";
    form.published.checked = !!post.published;
    form.show_on_home.checked = !!post.show_on_home;
    const delBtn = $("#news-delete");
    if (delBtn) delBtn.hidden = false;
    form.title.focus();
  }

  function resetNewsForm() {
    const form = $("#news-form");
    $("#news-form-title").textContent = "Ny artikkel";
    form.reset();
    form.id.value = "";
    form.show_on_home.checked = true;
    const delBtn = $("#news-delete");
    if (delBtn) delBtn.hidden = true;
  }

  $("#news-reset").addEventListener("click", resetNewsForm);

  $("#news-delete")?.addEventListener("click", async () => {
    const id = $("#news-form")?.id?.value;
    await deleteNewsById(id);
  });

  $("#news-form").title.addEventListener("input", (e) => {
    const form = $("#news-form");
    if (!form.id.value) form.slug.value = slugify(e.target.value);
  });

  $("#news-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { data: sessionData } = await client.auth.getSession();
    const id = String(fd.get("id") || "");
    const published = !!fd.get("published");
    const payload = {
      title: String(fd.get("title")),
      slug: String(fd.get("slug")),
      excerpt: String(fd.get("excerpt")),
      body: String(fd.get("body")),
      published,
      show_on_home: !!fd.get("show_on_home"),
      published_at: published ? new Date().toISOString() : null,
      author_id: sessionData.session?.user?.id || null,
    };

    let error;
    if (id) {
      ({ error } = await client.from("news_posts").update(payload).eq("id", id));
    } else {
      ({ error } = await client.from("news_posts").insert(payload));
    }

    if (error) showMsg(newsMsg, error.message, true);
    else {
      showMsg(newsMsg, "Lagret.");
      resetNewsForm();
      await loadNews();
    }
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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

