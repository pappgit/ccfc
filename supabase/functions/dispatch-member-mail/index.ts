// Dispatch pending rows from member_mail_outbox via Resend.
// Secrets: RESEND_API_KEY, MAIL_FROM, DISPATCH_CRON_SECRET (anbefalt)
// Optional: DISPATCH_ALLOWED_ORIGIN (default: https://pappgit.github.io)
//
// Deploy with JWT verification OFF so cron can auth via x-cron-secret:
//   supabase functions deploy dispatch-member-mail --no-verify-jwt
//
// Auth (required — one of):
//   1) Header x-cron-secret: <DISPATCH_CRON_SECRET>
//   2) Authorization: Bearer <DISPATCH_CRON_SECRET>
//   3) Authorization: Bearer <admin user JWT>  (must exist in public.admins)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_ORIGIN = "https://pappgit.github.io";

function allowedOrigin(req: Request): string {
  const configured = Deno.env.get("DISPATCH_ALLOWED_ORIGIN") || DEFAULT_ORIGIN;
  const origin = req.headers.get("Origin");
  if (!origin) return configured;
  if (origin === configured) return origin;
  if (origin === "http://localhost:8080" || origin === "http://127.0.0.1:8080") {
    return origin;
  }
  return configured;
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, content-type, apikey, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

/** Constant-time string compare for secrets. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(aa.length, bb.length);
  let mismatch = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const x = i < aa.length ? aa[i] : 0;
    const y = i < bb.length ? bb[i] : 0;
    mismatch |= x ^ y;
  }
  return mismatch === 0;
}

async function authorize(
  req: Request
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cronSecret = Deno.env.get("DISPATCH_CRON_SECRET") || "";
  const headerCron = req.headers.get("x-cron-secret") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (cronSecret && headerCron && timingSafeEqual(headerCron, cronSecret)) {
    return { ok: true };
  }
  if (cronSecret && bearer && timingSafeEqual(bearer, cronSecret)) {
    return { ok: true };
  }

  if (!bearer) {
    return {
      ok: false,
      error: "Unauthorized: mangler Bearer-token eller x-cron-secret",
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      error: "Server misconfigured (SUPABASE_URL / SUPABASE_ANON_KEY)",
    };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(bearer);
  if (userError || !user) {
    return { ok: false, error: "Unauthorized: ugyldig token" };
  }

  const { data: adminRow, error: adminError } = await userClient
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return { ok: false, error: "Unauthorized: ikke admin" };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Method not allowed" }, 405);
  }

  const auth = await authorize(req);
  if (!auth.ok) {
    return jsonResponse(req, { ok: false, error: auth.error }, 401);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const mailFrom =
    Deno.env.get("MAIL_FROM") ||
    "Coventry City Scandinavia <onboarding@resend.dev>";
  if (!resendKey) {
    return jsonResponse(
      req,
      {
        ok: false,
        error:
          "RESEND_API_KEY mangler. Bruk admin mailto inntil e-post er konfigurert.",
      },
      503
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error } = await sb
    .from("member_mail_outbox")
    .select("id, to_email, subject, body_text, body_html")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    return jsonResponse(req, { ok: false, error: error.message }, 500);
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
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
        })
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

  return jsonResponse(req, {
    ok: true,
    processed: results.length,
    results,
  });
});
