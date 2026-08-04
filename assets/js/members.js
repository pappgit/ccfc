/* Public membership signup / unsubscribe */
(function () {
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function siteBaseUrl() {
    const path = location.pathname.replace(/\/[^/]*$/, "") || "";
    return location.origin + path;
  }

  function showMsg(el, text, isError) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error", "is-ok");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
    el.classList.toggle("is-ok", !isError);
  }

  function client() {
    if (!window.supabase || !window.CCFC_SUPABASE) {
      throw new Error("Supabase er ikke konfigurert.");
    }
    return window.supabase.createClient(
      window.CCFC_SUPABASE.url,
      window.CCFC_SUPABASE.anonKey
    );
  }

  function rpcErrorMessage(err) {
    const raw = err?.message || err?.error_description || String(err || "Noe gikk galt");
    if (/E-posten er allerede registrert/i.test(raw)) return "Denne e-posten er allerede registrert.";
    if (/Personvernsamtykke/i.test(raw)) return "Du må godta lagring av personopplysninger.";
    if (/Ugyldig/i.test(raw)) return raw;
    if (/already used|allerede brukt/i.test(raw)) return "Lenken er allerede brukt.";
    if (/expired|utløpt/i.test(raw)) return "Lenken er utløpt. Be admin om ny utmeldingslenke.";
    if (/Ugyldig eller utløpt/i.test(raw)) return "Ugyldig eller utløpt lenke.";
    return raw;
  }

  async function setupJoinForm() {
    const form = $("#member-join-form");
    if (!form) return;
    const msg = $("#member-join-msg");
    const submit = $("#member-join-submit");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const fullName = String(fd.get("full_name") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const phone = String(fd.get("phone") || "").trim();
      const country = String(fd.get("country") || "NO");
      const consentPrivacy = !!fd.get("consent_privacy");
      const consentMarketing = !!fd.get("consent_marketing");

      if (!fullName || !email || !phone) {
        showMsg(msg, "Fyll inn navn, e-post og mobil.", true);
        return;
      }
      if (!consentPrivacy) {
        showMsg(msg, "Du må godta lagring av personopplysninger.", true);
        return;
      }

      if (submit) submit.disabled = true;
      showMsg(msg, "Sender innmelding…");

      try {
        const sb = client();
        const { data, error } = await sb.rpc("register_member_public", {
          p_full_name: fullName,
          p_email: email,
          p_phone: phone,
          p_country: country,
          p_consent_privacy: consentPrivacy,
          p_consent_marketing: consentMarketing,
          p_base_url: siteBaseUrl(),
        });
        if (error) throw error;
        if (!data?.ok) throw new Error("Innmelding feilet.");

        form.reset();
        showMsg(
          msg,
          "Takk! Innmeldingen er mottatt og venter på godkjenning. Du får e-post når medlemskapet er godkjent.",
          false
        );
      } catch (err) {
        console.error(err);
        showMsg(msg, rpcErrorMessage(err), true);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  async function setupUnsubscribe() {
    const form = $("#unsubscribe-form");
    const lead = $("#unsubscribe-lead");
    const msg = $("#unsubscribe-msg");
    const submit = $("#unsubscribe-submit");
    if (!form && !lead) return;

    const params = new URLSearchParams(location.search);
    const token = (params.get("token") || "").trim();

    if (!token) {
      if (lead) lead.textContent = "Mangler utmeldingslenke. Åpne lenken fra e-posten din.";
      showMsg(msg, "Ingen token i adressen.", true);
      return;
    }

    if (lead) lead.textContent = "Bekreft utmelding nedenfor.";
    form.hidden = false;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (submit) submit.disabled = true;
      showMsg(msg, "Melder ut…");
      try {
        const sb = client();
        const { data, error } = await sb.rpc("unsubscribe_with_token", {
          p_token: token,
        });
        if (error) throw error;
        form.hidden = true;
        if (lead) {
          lead.textContent = data?.already
            ? "Du er allerede meldt ut."
            : "Du er nå meldt ut. Takk for at du var med.";
        }
        showMsg(msg, "Utmelding fullført.", false);
      } catch (err) {
        console.error(err);
        showMsg(msg, rpcErrorMessage(err), true);
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupJoinForm();
    setupUnsubscribe();
  });
})();
