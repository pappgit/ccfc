# Kjør innloggings-migrering

1. Åpne [SQL Editor](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg/sql)
2. Kjør innholdet i `supabase/migrations/20260806200000_profiles.sql`
3. Deploy edge function (valgfritt, for admin-invitasjon):

```bash
supabase link --project-ref zzqhgqcwuztbqgkvpxjg
supabase functions deploy invite-login-user
```

4. Authentication → URL Configuration: legg til redirect-URL-er for
   `https://www.skyblues.no/login.html` og `https://www.skyblues.no/min-side.html`
   (og eventuelle forhåndsvisnings-URL-er)

5. Hold **Disable public sign-ups** på (invite-only)
