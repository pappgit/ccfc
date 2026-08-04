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
