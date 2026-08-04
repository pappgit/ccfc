# Admin (Supabase)

Prosjekt: [ccfc-scandinavia](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg)  
Admin-UI: https://pappgit.github.io/ccfc/admin/

## Menyer

1. **Innhold** — tekster, meny (synlighet), seksjoner, logo/favicon, forside-slideshow
2. **Nyheter** — legg til, rediger og slett artikler
3. **Ønsker** — kommentarer/forslag; huk av når gjennomført
4. **Endringslogg** — oversikt over endringer (system + manuelt lagt til)
5. **API** — synk-innstillinger (nøkler i GitHub Secrets)

## Brukere

Åpen registrering er **av**. Brukere opprettes i Supabase:

1. Dashboard → **Authentication** → **Users** → **Add user**
2. Sett e-post + passord (auto-confirm)
3. Kjør SQL for admin-tilgang:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'deg@example.com'
on conflict (user_id) do update set email = excluded.email;
```

Deretter logg inn på `/admin/` med samme e-post/passord.
