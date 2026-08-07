# Kjøre migrering (steg 1)

# Kjøre migrering

Kjør i rekkefølge i [SQL Editor](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg/sql) hvis ikke allerede gjort:

1. `supabase/migrations/20260804150000_membership.sql`
2. `supabase/migrations/20260804160000_membership_pgcrypto_path.sql`
3. `supabase/migrations/20260804170000_membership_simple_flow.sql` ← enkel flyt + HTML-maler
4. `supabase/migrations/20260807100000_security_hardening.sql` ← **sikkerhet: revoke mail-RPC, HTML-escape, begrenset settings-lesing**

## Alternativ — CLI

```bash
supabase link --project-ref zzqhgqcwuztbqgkvpxjg
supabase db push
```

## Edge Function (e-post)

Når Resend er klar:

```bash
# Sett secrets
supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="CCS <medlem@example.com>" DISPATCH_CRON_SECRET="$(openssl rand -hex 32)"

# Deploy uten gateway-JWT (egen auth i funksjonen)
supabase functions deploy dispatch-member-mail --no-verify-jwt
```

Kall med `x-cron-secret: <DISPATCH_CRON_SECRET>` eller admin Bearer-JWT (POST).
