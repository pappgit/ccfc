/**
 * Shared Supabase auth for public pages (login, min-side, nav).
 * Reuses the same storage key as admin so one session works across the site.
 */
window.CCFCAuth = (function () {
  const cfg = window.CCFC_SUPABASE;
  const sb = window.supabase;
  const PROJECT_REF = "zzqhgqcwuztbqgkvpxjg";
  const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

  let client = null;
  let bootPromise = null;

  function ensureClient() {
    if (client) return client;
    if (!cfg?.url || !sb?.createClient) {
      throw new Error("Supabase mangler");
    }

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

    client = sb.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: AUTH_STORAGE_KEY,
        lock: async (_name, _acquireTimeout, fn) => fn(),
      },
    });
    return client;
  }

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

  function absoluteUrl(relativePath) {
    const a = document.createElement("a");
    a.href = relativePath;
    return a.href;
  }

  function formatAuthError(err) {
    const msg = err?.message || String(err || "Noe gikk galt");
    if (/invalid login credentials|invalid_credentials/i.test(msg)) {
      return "Feil e-post eller passord.";
    }
    if (/email not confirmed/i.test(msg)) {
      return "E-posten er ikke bekreftet ennå. Sjekk innboksen.";
    }
    if (/rate limit|too many/i.test(msg)) {
      return "For mange forsøk. Vent litt og prøv igjen.";
    }
    if (/user not found/i.test(msg)) {
      return "Fant ingen konto med den e-posten.";
    }
    return msg;
  }

  /** Password login via raw Auth API — same approach as admin.js. */
  async function signInRaw(email, password) {
    const c = ensureClient();
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

    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } catch (_) {
      /* ignore */
    }

    try {
      await withTimeout(
        c.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
        8000,
        "setSession"
      );
    } catch (_) {
      /* persisted; client may catch up */
    }

    return session;
  }

  async function getSession() {
    const c = ensureClient();
    try {
      const { data } = await withTimeout(c.auth.getSession(), 8000, "getSession");
      return data?.session || null;
    } catch {
      try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.access_token && parsed?.user) return parsed;
      } catch (_) {
        /* ignore */
      }
      return null;
    }
  }

  async function signOut() {
    const c = ensureClient();
    try {
      await withTimeout(c.auth.signOut(), 8000, "signOut");
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  async function resetPassword(email) {
    const c = ensureClient();
    const { error } = await c.auth.resetPasswordForEmail(email, {
      redirectTo: absoluteUrl("min-side.html"),
    });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const c = ensureClient();
    const { error } = await c.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function isAdminUser(userId, accessToken) {
    if (!userId) return false;
    const headers = {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${accessToken || cfg.anonKey}`,
      Accept: "application/json",
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}`,
        { headers, signal: controller.signal }
      );
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureProfile() {
    const c = ensureClient();
    const { data, error } = await c.rpc("ensure_own_profile");
    if (error) throw error;
    return data;
  }

  async function loadProfile() {
    const c = ensureClient();
    const session = await getSession();
    if (!session?.user?.id) return null;
    try {
      await ensureProfile();
    } catch (_) {
      /* table may not exist yet */
    }
    const { data, error } = await c
      .from("profiles")
      .select("user_id, display_name, email, created_at, updated_at")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function updateDisplayName(name) {
    const c = ensureClient();
    const { data, error } = await c.rpc("update_own_display_name", {
      p_display_name: name,
    });
    if (error) throw error;
    return data;
  }

  async function loadMemberStatus() {
    const c = ensureClient();
    const session = await getSession();
    const email = session?.user?.email;
    if (!email) return null;

    // Prefer linked user_id; fall back to email match for CRM status.
    const byUser = await c
      .from("members")
      .select("id, status, full_name, email, user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!byUser.error && byUser.data) return byUser.data;

    const byEmail = await c
      .from("members")
      .select("id, status, full_name, email, user_id")
      .ilike("email", email)
      .in("status", ["active", "pending", "pending_payment"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byEmail.error) return null;
    return byEmail.data;
  }

  function setAccountNav(session) {
    const links = document.querySelectorAll("[data-nav='account'], [data-auth-account]");
    links.forEach((a) => {
      if (session?.user) {
        a.textContent = "Min side";
        a.setAttribute("href", a.getAttribute("data-href-authed") || "min-side.html");
        a.setAttribute("data-auth-state", "in");
      } else {
        const cmsLabel =
          window.CCFCContent?.get?.()?.nav?.account ||
          a.getAttribute("data-cms-fallback") ||
          "Logg inn";
        a.textContent = cmsLabel;
        a.setAttribute("href", a.getAttribute("data-href-guest") || "login.html");
        a.setAttribute("data-auth-state", "out");
      }
    });
  }

  async function setFooterAdmin(session) {
    const el = document.querySelector('[data-section="footerAdmin"]');
    if (!el) return;
    if (!session?.user?.id) {
      el.hidden = true;
      return;
    }
    const ok = await isAdminUser(session.user.id, session.access_token);
    el.hidden = !ok;
  }

  async function refreshChrome() {
    if (location.pathname.includes("/admin")) return;
    try {
      ensureClient();
    } catch {
      return;
    }
    const session = await getSession();
    setAccountNav(session);
    await setFooterAdmin(session);
  }

  function bootChrome() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      await refreshChrome();
      try {
        const c = ensureClient();
        c.auth.onAuthStateChange(() => {
          refreshChrome();
        });
      } catch (_) {
        /* ignore */
      }
    })();
    return bootPromise;
  }

  // Run after CMS so nav labels exist, then override account link.
  document.addEventListener("ccfc:content-ready", () => {
    bootChrome();
  });
  document.addEventListener("DOMContentLoaded", () => {
    // Fallback if content.js is absent or already ready.
    setTimeout(() => bootChrome(), 0);
  });

  return {
    ensureClient,
    getClient: () => ensureClient(),
    getSession,
    signInRaw,
    signOut,
    resetPassword,
    updatePassword,
    isAdminUser,
    loadProfile,
    ensureProfile,
    updateDisplayName,
    loadMemberStatus,
    formatAuthError,
    absoluteUrl,
    refreshChrome,
    AUTH_STORAGE_KEY,
  };
})();
