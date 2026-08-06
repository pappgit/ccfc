# Innlogging (medlemskonto)

Enkel e-post/passord-innlogging for ~200 brukere. Minimal persondata.

## Modell

| Lag | Innhold |
|-----|---------|
| Supabase Auth | E-post + passord (åpen signup av) |
| `public.profiles` | `user_id`, `display_name`, `email` |
| `public.members.user_id` | Valgfri kobling til foreningsregister |
| `public.admins` | Uendret — kun admin-tilgang |

## Flyt

1. Admin inviterer (Admin → Medlemmer, eller Supabase Dashboard → Auth → Users)
2. Bruker setter passord via e-postlenke
3. Logg inn på `/login.html` → `/min-side.html`

## Migrering / deploy

1. Kjør `supabase/migrations/20260806200000_profiles.sql` i SQL Editor
2. Deploy edge function: `supabase functions deploy invite-login-user`
3. Under Authentication → URL Configuration: legg til redirect-URL-er for `login.html` og `min-side.html` (inkl. glemt-passord)

## Personvern

Kontosiden lagrer e-post (Auth) og valgfritt visningsnavn. Se `/personvern.html`.
