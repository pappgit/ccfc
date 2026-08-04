# Admin (Supabase)

Prosjekt: [ccfc-scandinavia](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg)  
Admin-UI: https://pappgit.github.io/ccfc/admin/

## Menyer

1. **Innhold** — tekster, meny (synlighet), seksjoner, logo/favicon, forside-slideshow
2. **Nyheter** — legg til, rediger og slett artikler
3. **Medlemmer** — medlemsregister, manuell inn/utmelding, e-postkø med utmeldingslenke
4. **Ønsker** — kommentarer/forslag; huk av når gjennomført
5. **Endringslogg** — oversikt over endringer (system + manuelt lagt til)
6. **API** — synk-innstillinger (nøkler i GitHub Secrets)

## Medlemshåndtering

Plan og logg: [`docs/medlemshandtering/`](../docs/medlemshandtering/).

1. Kjør migrering `supabase/migrations/20260804150000_membership.sql` i Supabase SQL Editor (eller `supabase db push`).
2. Offentlig innmelding: `/medlem.html`
3. Utmelding via e-postlenke: `/utmelding.html?token=…`
4. E-post: bruk **Åpne mailto** i admin inntil Resend er satt opp (`dispatch-member-mail`).

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
