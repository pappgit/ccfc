# Medlemshåndtering — plan

Prosjekt for medlemsregister i Coventry City Scandinavia-webappen.

**Status:** Enkel flyt (pending → godkjenn/manuell / meld ut) med HTML-e-postmaler. Vipps kommer senere.

## Mål

- Melde seg inn via nettsiden → **Til godkjenning**
- Admin godkjenner eller legger inn manuelt → velkomstmail (HTML-mal)
- Admin melder ut → avslutningsmail (HTML-mal) → **Utmeldt**
- Se alle medlemmer i liste
- Senere: Vipps-kontingent
- Personopplysninger sikret med RLS

## Flyt

```mermaid
flowchart LR
  A[medlem.html] --> B[pending]
  B -->|Godkjenn| C[active]
  D[Admin manuell inn] --> C
  C -->|Meld ut| E[cancelled]
  C --> F[Velkomstmail fra mal]
  D --> F
  E --> G[Avslutningsmail fra mal]
```

## Steg

### 1. DB + RLS + admin-fane ✅ (denne leveransen)

- Tabeller, indekser, RLS (`is_admin()`)
- Offentlige RPC-er for innmelding/utmelding (ingen direkte anon-tilgang til PII)
- Admin: liste, filter, manuell innmelding, aktivering, utmelding, utmeldingslenke

### 2. Offentlig innmelding + e-postutmelding ✅ (denne leveransen)

- `medlem.html` — skjema med personvernsamtykke
- `utmelding.html` — bekreft utmelding via token
- Velkomst-/bekreftelsesmail i `member_mail_outbox` med utmeldingslenke
- Admin kan sende via mailto / markere sendt; Edge Function klar for Resend

### 3. Vipps ePayment (senere)

- Vipps for bedrift + Payment Integration
- Edge Function starter betaling (`WEB_REDIRECT` + telefon)
- Webhook → `active` + `paid_until`
- Nøkler kun i Supabase secrets

### 4. Vipps Recurring (valgfritt senere)

- Årlig avtale (`interval: YEAR`)
- Auto-fornyelse uten manuelt trekk

### 5. PUSH_MESSAGE (valgfritt)

- Admin «Send Vipps-krav» direkte til app
- Krever Vipps-godkjenning + samtykke

## Kontingent (Vipps) — kort

- **Engangs:** ePayment API med `customer.phoneNumber` (MSISDN)
- **Årlig auto:** Recurring API
- Anbefaling: start med ePayment på innmelding; Recurring når org/Vipps er på plass

## Personvern

- Minimal data: navn, e-post, mobil, land, status, betaling
- RLS: kun admin leser registeret; publikum via RPC
- Utmeldingstoken lagres som SHA-256-hash
- Outbox/audit for sporbarhet
- Personvernerklæring + databehandleravtale (Supabase) før produksjon med reelle medlemmer
- Betalingsdata hos Vipps; vi lagrer kun reference/status

## Forutsetninger utenfor kode

- [ ] Org.nr. / forening
- [ ] Vipps for bedrift
- [ ] E-postleverandør (f.eks. Resend) for automatisk utsending
- [ ] Personvernerklæring og medlemsvilkår
