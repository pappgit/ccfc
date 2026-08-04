# Medlemshåndtering — logg

Kronologisk logg for prosjektet medlemshåndtering.

| Dato | Hendelse |
|------|----------|
| 2026-08-04 | Plan lagret under `docs/medlemshandtering/`. Prosjektnavn: **medlemshåndtering**. |
| 2026-08-04 | Beslutning: Steg 1–2 implementeres nå (DB/RLS/admin + offentlig innmelding/utmelding). Vipps bedrift og org.nr. utsettes. |
| 2026-08-04 | Steg 1: Migrering `members`, `membership_payments`, `unsubscribe_tokens`, `member_mail_outbox`, `member_audit_log` + RLS/RPC. |
| 2026-08-04 | Steg 1: Admin-fane **Medlemmer** (liste, filter, manuell inn/ut, aktivering, utmeldingslenke). |
| 2026-08-04 | Steg 2: Sider `medlem.html` og `utmelding.html`, navigasjon, e-postkø med utmeldingslenke. |
| 2026-08-04 | Edge Function-skjelett `dispatch-member-mail` for senere Resend-integrasjon. |
| 2026-08-04 | Steg 1–2 ferdig i kode. **Gjenstår:** kjøre SQL-migrering i Supabase; Vipps/org.nr. senere. |
| 2026-08-04 | Migrering kjørt i Supabase. Verifisert: `members` RLS, `register_member_public`, `unsubscribe_with_token`, `site_settings.membership`. |
| 2026-08-04 | Bug funnet ved e2e-test: `gen_random_bytes` mangler i `search_path`. Fix-migrering `20260804160000_membership_pgcrypto_path.sql` — **må kjøres**. |
| 2026-08-04 | Fix-migrering kjørt. E2e OK: innmelding → `pending_payment`, duplikat-e-post avvist, anon uten PII-lesing. |

## Åpent

- Sette `RESEND_API_KEY` (+ `MAIL_FROM`) når automatisk e-post ønskes
- Vipps bedrift / org.nr. / ePayment (steg 3)
- Personvernerklæring på nettsiden før produksjonsbruk
- Manuell smoke-test i nettleser: `/medlem.html` → admin aktiver → mailto → `/utmelding.html`
- Merge PR #8 (pgcrypto-fix) så fiksen også ligger i repo/main

## Notater

- Offentlig innmelding oppretter `pending_payment` til Vipps er klart; admin kan aktivere manuelt.
- Utmelding skjer via engangs-token i e-postlenke (`utmelding.html?token=…`).
- Anon-brukere har ikke direkte SELECT på medlems-PII.
