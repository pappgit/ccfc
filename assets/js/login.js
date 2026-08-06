(function () {
  const auth = window.CCFCAuth;
  if (!auth) return;

  const $ = (sel) => document.querySelector(sel);
  const loginForm = $("#login-form");
  const resetForm = $("#reset-form");
  const loginMsg = $("#login-msg");
  const resetMsg = $("#reset-msg");
  const loginPanel = $("#login-panel");
  const resetPanel = $("#reset-panel");

  function showMsg(el, text, isError) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function showReset(show) {
    if (loginPanel) loginPanel.hidden = show;
    if (resetPanel) resetPanel.hidden = !show;
  }

  async function redirectIfAuthed() {
    try {
      const session = await auth.getSession();
      if (session?.user) {
        location.replace("min-side.html");
      }
    } catch (_) {
      /* stay on login */
    }
  }

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "");
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    showMsg(loginMsg, "Logger inn…");
    try {
      await auth.signInRaw(email, password);
      showMsg(loginMsg, "Innlogget. Sender deg videre…");
      location.replace("min-side.html");
    } catch (err) {
      showMsg(loginMsg, auth.formatAuthError(err), true);
      if (btn) btn.disabled = false;
    }
  });

  resetForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(resetForm);
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const btn = resetForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    showMsg(resetMsg, "Sender e-post…");
    try {
      await auth.resetPassword(email);
      showMsg(
        resetMsg,
        "Hvis kontoen finnes, får du en e-post med lenke for å sette nytt passord."
      );
    } catch (err) {
      showMsg(resetMsg, auth.formatAuthError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#show-reset")?.addEventListener("click", (e) => {
    e.preventDefault();
    showReset(true);
    showMsg(resetMsg, "");
  });

  $("#show-login")?.addEventListener("click", (e) => {
    e.preventDefault();
    showReset(false);
    showMsg(loginMsg, "");
  });

  redirectIfAuthed();
})();
