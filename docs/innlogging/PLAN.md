# Innlogging (medlemskonto) — PARKERT

> **Status 2026-08-06:** Ut satt. Se [`LOGG.md`](./LOGG.md) for filinventar og hvordan hente tilbake commit `83ff03e`.

Enkel e-post/passord-innlogging for ~200 brukere. Minimal persondata.

## Modell

| Lag | Innhold |
|-----|---------|
| Supabase Auth | E-post + passord (åpen signup av) |
| `public.profiles` | `user_id`, `display_name`, `email` |
| `public.members.user_id` | Valgfri kobling til foreningsregister |
| `public.admins` | Uendret — kun admin-tilgang |

## Flyt (når gjenopptatt)

1. Admin inviterer (Admin → Medlemmer, eller Supabase Dashboard → Auth → Users)
2. Bruker setter passord via e-postlenke
3. Logg inn på `/login.html` → `/min-side.html`

## Migrering / deploy

Se [`KJOR-MIGRERING.md`](./KJOR-MIGRERING.md) og full filiste i [`LOGG.md`](./LOGG.md).

## Personvern

Kontosiden lagrer e-post (Auth) og valgfritt visningsnavn. Personvernside var `/personvern.html` i parkert implementasjon.
