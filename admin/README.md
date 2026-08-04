# Admin (Supabase)

Prosjekt: [ccfc-scandinavia](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg)  
Admin-UI: https://pappgit.github.io/ccfc/admin/

## Første innlogging

1. Åpne `/admin/`
2. Fyll e-post + passord
3. Klikk **Opprett første admin** (vises bare når ingen admin finnes)
4. Deretter: menyer **API** og **Nyheter**

Flere admins: opprett bruker i Supabase Auth, deretter:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'deg@example.com';
```

## Tabeller

- `news_posts` — artikler (publisert / vis på forsiden)
- `site_settings` — API-konfig (ikke hemmelige nøkler)
- `admins` — hvem som har tilgang

API-nøkler ligger fortsatt i GitHub Secrets.
