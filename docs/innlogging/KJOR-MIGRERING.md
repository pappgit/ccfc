# Kjør innloggings-migrering — PARKERT

> **Status 2026-08-06:** Ikke kjør dette før innlogging gjenopptas. Se [`LOGG.md`](./LOGG.md).

Når dere tar opp arbeidet igjen:

1. Hent SQL-filen tilbake fra commit `83ff03e` (eller tilsvarende branch-historikk)
2. Åpne [SQL Editor](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg/sql)
3. Kjør innholdet i `supabase/migrations/20260806200000_profiles.sql`
4. Deploy edge function fra **repo-roten** (ikke hjemmemappa):

```bash
cd /sti/til/ditt/ccfc-repo   # ekte lokal sti, f.eks. ~/Developer/ccfc
supabase link --project-ref zzqhgqcwuztbqgkvpxjg
supabase functions deploy invite-login-user
```

5. Authentication → URL Configuration: redirect-URL-er for
   `https://www.skyblues.no/login.html` og `https://www.skyblues.no/min-side.html`
6. Hold **Disable public sign-ups** på (invite-only)
