(function () {
  const cfg = window.CCFC_SUPABASE;
  if (!cfg?.url || !window.supabase) {
    console.error("Supabase mangler");
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);

  const $ = (sel) => document.querySelector(sel);
  const loginView = $("#login-view");
  const appView = $("#app-view");
  const loginMsg = $("#login-msg");
  const apiMsg = $("#api-msg");
  const newsMsg = $("#news-msg");
  const signupBtn = $("#signup-btn");

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

  async function adminCount() {
    const { data, error } = await client.rpc("admin_exists");
    if (error) return null;
    return data ? 1 : 0;
  }

  async function ensureAdmin(user) {
    const { data } = await client
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) return true;

    const count = await adminCount();
    if (count === 0) {
      const { error } = await client.from("admins").insert({
        user_id: user.id,
        email: user.email,
      });
      if (error) throw error;
      return true;
    }
    return false;
  }

  async function requireSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function showApp(session) {
    const ok = await ensureAdmin(session.user);
    if (!ok) {
      await client.auth.signOut();
      loginView.hidden = false;
      appView.hidden = true;
      showMsg(loginMsg, "Brukeren er ikke admin. Be en admin legge deg inn i Supabase.", true);
      return;
    }
    loginView.hidden = true;
    appView.hidden = false;
    $("#admin-email").textContent = session.user.email || session.user.id;
    await loadContentEditor();
    await loadApiSettings();
    await loadNews();
  }

  async function showLogin() {
    loginView.hidden = false;
    appView.hidden = true;
    const count = await adminCount();
    // count may be null for anon if RLS blocks — bootstrap insert still works when empty
    signupBtn.hidden = count !== 0 && count !== null;
    if (count === 0) {
      showMsg(loginMsg, "Ingen admin ennå — opprett første bruker her.", false);
    }
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
        { path: "home.matchesStats", label: "Knapp statistikk", type: "text" },
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
      ?.querySelectorAll("#content-fields [name], #logo-url-input, #favicon-url-input")
      .forEach((el) => {
        if (!el.name) return;
        window.CCFCContent.setByPath(contentState, el.name, el.value);
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
  }

  function collectContentForm() {
    flushContentFields();
    return contentState;
  }

  async function loadContentEditor() {
    if (!window.CCFCContent) return;
    window.CCFCContent.clearCache();
    contentState = await window.CCFCContent.load({ bypassCache: true });
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

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /* —— Auth —— */
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    showMsg(loginMsg, "Logger inn…");
    const { data, error } = await client.auth.signInWithPassword({
      email: String(fd.get("email")),
      password: String(fd.get("password")),
    });
    if (error) {
      showMsg(loginMsg, error.message, true);
      return;
    }
    await showApp(data.session);
  });

  signupBtn.addEventListener("click", async () => {
    const form = $("#login-form");
    const fd = new FormData(form);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");
    if (!email || !password) {
      showMsg(loginMsg, "Fyll inn e-post og passord først.", true);
      return;
    }
    showMsg(loginMsg, "Oppretter admin…");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
      showMsg(loginMsg, error.message, true);
      return;
    }
    if (!data.session) {
      showMsg(
        loginMsg,
        "Bruker opprettet. Bekreft e-post hvis påkrevd, deretter logg inn.",
        false
      );
      return;
    }
    await showApp(data.session);
  });

  $("#logout-btn").addEventListener("click", async () => {
    await client.auth.signOut();
    await showLogin();
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
            <button type="button" class="btn btn--ghost" data-delete="${p.id}">Slett</button>
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
        if (!confirm("Slette artikkelen?")) return;
        const { error: delErr } = await client
          .from("news_posts")
          .delete()
          .eq("id", btn.dataset.delete);
        if (delErr) showMsg(newsMsg, delErr.message, true);
        else {
          showMsg(newsMsg, "Slettet.");
          await loadNews();
        }
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
    form.title.focus();
  }

  function resetNewsForm() {
    const form = $("#news-form");
    $("#news-form-title").textContent = "Ny artikkel";
    form.reset();
    form.id.value = "";
    form.show_on_home.checked = true;
  }

  $("#news-reset").addEventListener("click", resetNewsForm);

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
  (async () => {
    const session = await requireSession();
    if (session) await showApp(session);
    else await showLogin();

    client.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") await showLogin();
      if (event === "SIGNED_IN" && session) await showApp(session);
    });
  })();
})();
