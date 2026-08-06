# Admin (Supabase)

Prosjekt: [ccfc-scandinavia](https://supabase.com/dashboard/project/zzqhgqcwuztbqgkvpxjg)  
Admin-UI: https://pappgit.github.io/ccfc/admin/

## Menyer

1. **Innhold** — tekster, meny (synlighet), seksjoner, logo/favicon, forside-slideshow
2. **Nyheter** — legg til, rediger og slett artikler (valgfritt bilde per artikkel)
3. **Medlemmer** — medlemsregister, manuell inn/utmelding, e-postkø med utmeldingslenke
4. **Ønsker** — kommentarer/forslag; huk av når gjennomført
5. **Endringslogg** — oversikt over endringer (system + manuelt lagt til)
6. **API** — synk-innstillinger (nøkler i GitHub Secrets)

## Nyhetsbilder

1. Kjør migrering `supabase/migrations/20260804180000_news_image.sql` i Supabase SQL Editor (eller `supabase db push`) hvis `image_url` ikke allerede finnes på `news_posts`.
2. I admin → **Nyheter**: last opp bilde eller lim inn URL. Tomt felt = ingen bildeplass på forsiden/nyhetssiden.
3. Bilder lagres i Storage-bucket `media` under `news/`.

## Medlemshåndtering

Plan og logg: [`docs/medlemshandtering/`](../docs/medlemshandtering/).

**Flyt**
1. Nettside `/medlem.html` → status **Til godkjenning** (`pending`)
2. Admin **Godkjenn** eller **Legg inn manuelt** → **Aktiv** + velkomstmail i kø
3. Admin **Meld ut** → **Utmeldt** + avslutningsmail i kø
4. HTML-maler redigeres under Medlemmer → E-postmaler

**Migreringer (kjør i rekkefølge hvis ikke allerede kjørt)**
- `20260804150000_membership.sql`
- `20260804160000_membership_pgcrypto_path.sql`
- `20260804170000_membership_simple_flow.sql` ← enkel flyt + maler
- `20260804180000_news_image.sql` ← valgfritt bilde på artikler

## Brukere

Åpen registrering er **av**. Innloggingskontoer opprettes slik:

**A — Admin-UI (anbefalt når edge function er deployet)**  
Admin → Medlemmer → **Opprett innloggingskonto**, eller knappen på et aktivt medlem.

**B — Supabase Dashboard**
1. Dashboard → **Authentication** → **Users** → **Invite** / **Add user**
2. Brukeren setter passord via e-post

**Admin-tilgang** (etter at Auth-bruker finnes):

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'deg@example.com'
on conflict (user_id) do update set email = excluded.email;
```

Offentlig innlogging: `/login.html` → `/min-side.html`  
Admin: `/admin/` (krever rad i `admins`)

**Migrering:** `supabase/migrations/20260806200000_profiles.sql` — se [`docs/innlogging/`](../docs/innlogging/).
