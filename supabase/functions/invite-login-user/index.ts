// Invite a login user (Supabase Auth invite e-mail).
// Requires: caller JWT must be an admin (public.admins).
// Deploy: supabase functions deploy invite-login-user

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405, headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ ok: false, error: "Mangler innlogging" }, { status: 401, headers: cors });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return Response.json({ ok: false, error: "Ugyldig sesjon" }, { status: 401, headers: cors });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: adminRow, error: adminErr } = await admin
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminErr || !adminRow) {
    return Response.json({ ok: false, error: "Kun admin kan invitere" }, { status: 403, headers: cors });
  }

  let body: {
    email?: string;
    display_name?: string;
    member_id?: string | null;
    redirect_to?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Ugyldig JSON" }, { status: 400, headers: cors });
  }

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const displayName = String(body.display_name || "").trim().slice(0, 80);
  const memberId = body.member_id ? String(body.member_id) : null;
  const redirectTo = String(body.redirect_to || "").trim();

  if (!email || !email.includes("@")) {
    return Response.json({ ok: false, error: "Gyldig e-post er påkrevd" }, { status: 400, headers: cors });
  }

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: displayName ? { display_name: displayName } : undefined,
    redirectTo: redirectTo || undefined,
  });

  if (inviteErr) {
    // Already registered — try to ensure profile + optional member link.
    const msg = inviteErr.message || "Kunne ikke invitere";
    if (/already|registered|exists/i.test(msg)) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
      if (existing) {
        await admin.from("profiles").upsert({
          user_id: existing.id,
          email,
          display_name: displayName || null,
        });
        if (memberId) {
          await admin.from("members").update({ user_id: existing.id }).eq("id", memberId);
        }
        return Response.json(
          {
            ok: true,
            already: true,
            user_id: existing.id,
            message: "Brukeren finnes allerede. Profil oppdatert.",
          },
          { headers: cors }
        );
      }
    }
    return Response.json({ ok: false, error: msg }, { status: 400, headers: cors });
  }

  const newUser = invited.user;
  if (newUser?.id) {
    await admin.from("profiles").upsert({
      user_id: newUser.id,
      email,
      display_name: displayName || null,
    });
    if (memberId) {
      await admin.from("members").update({ user_id: newUser.id }).eq("id", memberId);
    }
  }

  return Response.json(
    {
      ok: true,
      already: false,
      user_id: newUser?.id || null,
      message: "Invitasjon sendt. Brukeren får e-post for å sette passord.",
    },
    { headers: cors }
  );
});
