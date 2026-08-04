// Dispatch pending rows from member_mail_outbox via Resend.
// Secrets: RESEND_API_KEY, MAIL_FROM (e.g. "CCS <medlem@example.com>")
// Deploy later: supabase functions deploy dispatch-member-mail

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_URL = "https://api.resend.com/emails";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey",
      },
    });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const mailFrom = Deno.env.get("MAIL_FROM") || "Coventry City Scandinavia <onboarding@resend.dev>";
  if (!resendKey) {
    return Response.json(
      {
        ok: false,
        error: "RESEND_API_KEY mangler. Bruk admin mailto inntil e-post er konfigurert.",
      },
      { status: 503 }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: rows, error } = await sb
    .from("member_mail_outbox")
    .select("id, to_email, subject, body_text, body_html")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const row of rows || []) {
    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: mailFrom,
          to: [row.to_email],
          subject: row.subject,
          text: row.body_text,
          html: row.body_html || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        await sb
          .from("member_mail_outbox")
          .update({ status: "failed", error: body.slice(0, 500) })
          .eq("id", row.id);
        results.push({ id: row.id, ok: false, error: body.slice(0, 200) });
        continue;
      }
      await sb
        .from("member_mail_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", row.id);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb
        .from("member_mail_outbox")
        .update({ status: "failed", error: message.slice(0, 500) })
        .eq("id", row.id);
      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
});
