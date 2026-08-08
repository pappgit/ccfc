# Innlogging — logg (parkert)

**Status:** Parkert 2026-08-06. Kode fjernet fra aktiv branch; tas opp senere.  
**Full implementasjon lagret i git:** commit `83ff03e` på branchen `cursor/member-login-profiles-b386` (før reversering).  
**PR:** https://github.com/pappgit/ccfc/pull/26 (skal ikke merges som funksjon før videre arbeid).

## Beslutning

Enkel medlemsinnlogging (~200 brukere, minimal PII) ble planlagt og implementert i draft, deretter **satt på vent**. Nettsiden skal ikke ha innlogging synlig før videre beslutning.

## Hva som var laget (filinventar)

### Nye filer

| Fil | Rolle |
|-----|--------|
| `supabase/migrations/20260806200000_profiles.sql` | `profiles`-tabell, RLS, trigger ved ny Auth-bruker, `members.user_id`, RPC `ensure_own_profile` / `update_own_display_name` / `admin_link_member_user`, policy `members_select_own` |
| `supabase/functions/invite-login-user/index.ts` | Edge Function: admin inviterer via Auth invite-e-post |
| `assets/js/auth.js` | Delt Supabase-sesjon (samme storage-nøkkel som admin), login/raw token, nav/footer |
| `assets/js/login.js` | Skjemalogikk for `/login.html` |
| `assets/js/account.js` | Logikk for `/min-side.html` |
| `login.html` | Offentlig innlogging + glemt passord + personverntekst |
| `min-side.html` | Innlogget: status, visningsnavn, passord, utlogging |
| `personvern.html` | Personvernerklæring (konto + medlemsregister + Supabase) |
| `docs/innlogging/PLAN.md` | Kort teknisk plan |
| `docs/innlogging/KJOR-MIGRERING.md` | SQL + deploy-steg |
| `docs/innlogging/LOGG.md` | Denne filen |

### Endrede filer (i commit `83ff03e`)

| Fil | Endring |
|-----|---------|
| `admin/index.html` | Kort «Opprett innloggingskonto» |
| `assets/js/admin.js` | Invitasjonsskjema, «Opprett innloggingskonto» per aktivt medlem, CMS-felter for account/privacy/nav.account |
| `admin/README.md` | Oppdatert brukerdokumentasjon |
| `assets/js/content.js` | Cache v6; footerAdmin styres av auth (ikke CMS) |
| `assets/css/styles.css` | Stiler for konto/login/personvern |
| `assets/data/site-content.default.json` | `nav.account`, `account.*`, `privacy.*`, footer-tekst |
| `assets/data/changelog.json` | Oppføring «Innlogging for medlemmer» |
| Alle offentlige `*.html` (nav/footer) | Lenke Logg inn / Min side + `auth.js`; Admin-footer skjult for ikke-admins |
| `medlem.html` | Lenke til personvern ved samtykke |

## Modell (kort)

- Supabase Auth: e-post + passord; **åpen signup av** (invite-only)
- `public.profiles`: `user_id`, `display_name`, `email`
- `public.admins` uendret for admin
- Valgfri kobling `members.user_id → auth.users`

## Drift som var tenkt

1. Kjør migrering `20260806200000_profiles.sql`
2. `supabase functions deploy invite-login-user` (fra **repo-rot**, ikke `~`)
3. Auth → URL Configuration: redirect for `login.html` / `min-side.html`
4. Admin inviterer, eller Dashboard → Authentication → Invite

## Hvordan ta opp jobben senere

```bash
# Hent hele implementasjonen tilbake
git checkout 83ff03e
# eller se diff:
git show 83ff03e --stat
git checkout 83ff03e -- supabase/migrations/20260806200000_profiles.sql
# …evt. øvrige filer etter behov
```

Alternativt: gjenåpne/arbeid videre fra historikken på `cursor/member-login-profiles-b386` der commit `83ff03e` fortsatt finnes i reflog/historikk etter parkering.

## Kronologi

| Dato | Hendelse |
|------|----------|
| 2026-08-06 | Plan for enkel login + tippekonkurranse (senere) diskutert. |
| 2026-08-06 | Implementert steg 1–5 (profiler, login/min-side, nav, admin-invite, personvern). Commit `83ff03e`. PR #26. |
| 2026-08-06 | **Parkert.** Funksjonskode fjernet fra aktiv branch. Logg + plan beholdes under `docs/innlogging/`. |

## Åpent ved gjenopptak

- [ ] Kjøre SQL-migrering i Supabase (kun hvis ikke allerede kjørt manuelt)
- [ ] Deploy `invite-login-user`
- [ ] Auth redirect-URL-er
- [ ] Smoke-test: invite → sett passord → login → Min side
- [ ] Evt. tippekonkurranse som neste feature oppå kontoer
