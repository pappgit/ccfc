(function () {
  const auth = window.CCFCAuth;
  if (!auth) return;

  const $ = (sel) => document.querySelector(sel);
  const gateMsg = $("#account-gate-msg");
  const accountView = $("#account-view");
  const emailEl = $("#account-email");
  const statusEl = $("#account-status");
  const nameInput = $("#display-name");
  const profileMsg = $("#profile-msg");
  const passwordMsg = $("#password-msg");
  const nameForm = $("#profile-form");
  const passwordForm = $("#password-form");

  const STATUS_LABELS = {
    active: "Aktivt medlemskap",
    pending: "Medlemskap til godkjenning",
    pending_payment: "Medlemskap til godkjenning",
    cancelled: "Utmeldt",
    lapsed: "Utmeldt",
  };

  function showMsg(el, text, isError) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function memberStatusLabel(member) {
    if (!member) return "Ingen medlemsrad knyttet (kun innloggingskonto)";
    return STATUS_LABELS[member.status] || member.status;
  }

  async function requireSession() {
    const session = await auth.getSession();
    if (!session?.user) {
      location.replace("login.html");
      return null;
    }
    return session;
  }

  async function render() {
    const session = await requireSession();
    if (!session) return;

    if (gateMsg) gateMsg.hidden = true;
    if (accountView) accountView.hidden = false;

    if (emailEl) emailEl.textContent = session.user.email || "—";

    let profile = null;
    try {
      profile = await auth.loadProfile();
    } catch (err) {
      showMsg(profileMsg, err.message || "Kunne ikke hente profil.", true);
    }
    if (nameInput) nameInput.value = profile?.display_name || "";

    try {
      const member = await auth.loadMemberStatus();
      if (statusEl) statusEl.textContent = memberStatusLabel(member);
    } catch {
      if (statusEl) statusEl.textContent = "Status utilgjengelig";
    }

    // Recovery / invite links land with type=recovery in hash — show password form hint.
    if (/type=recovery|type=invite/i.test(location.hash || location.search || "")) {
      showMsg(
        passwordMsg,
        "Velg et nytt passord nedenfor for å fullføre."
      );
      passwordForm?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  nameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = String(nameInput?.value || "").trim();
    const btn = nameForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    showMsg(profileMsg, "Lagrer…");
    try {
      await auth.updateDisplayName(name);
      showMsg(profileMsg, "Visningsnavn lagret.");
    } catch (err) {
      showMsg(profileMsg, auth.formatAuthError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(passwordForm);
    const password = String(fd.get("password") || "");
    const confirm = String(fd.get("password_confirm") || "");
    if (password.length < 8) {
      showMsg(passwordMsg, "Passordet må være minst 8 tegn.", true);
      return;
    }
    if (password !== confirm) {
      showMsg(passwordMsg, "Passordene er ikke like.", true);
      return;
    }
    const btn = passwordForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    showMsg(passwordMsg, "Oppdaterer passord…");
    try {
      await auth.updatePassword(password);
      showMsg(passwordMsg, "Passordet er oppdatert.");
      passwordForm.reset();
      history.replaceState({}, "", "min-side.html");
    } catch (err) {
      showMsg(passwordMsg, auth.formatAuthError(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("#logout-btn")?.addEventListener("click", async () => {
    await auth.signOut();
    location.replace("login.html");
  });

  render().catch((err) => {
    if (gateMsg) {
      gateMsg.hidden = false;
      gateMsg.textContent = err.message || "Kunne ikke laste Min side.";
      gateMsg.classList.add("is-error");
    }
  });
})();
