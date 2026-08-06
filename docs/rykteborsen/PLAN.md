# Ryktebørsen — plan

Meny og side som samler overgangsrykter og sladder relevant for Coventry City / Championship / Premier League, med fokus på **lovlig kildebruk** og enkel drift på GitHub Pages + eksisterende stack.

**Status:** Fase 0 implementert (meny + manuell kuratering). Fase 1–2 ikke startet.

## Mål

- Ny meny: **Ryktebørsen** (`rykteborsen.html`)
- Vise rykter med tydelig kilde, tidspunkt og lenke til originalen
- Filtrere/prioritere Coventry-relaterte treff, men tillate bredere Championship/PL-rykter
- Unngå ulovlig scraping / republisering av fullartikler
- Passe inn i eksisterende mønster (statisk HTML + JS, CMS-tekster, changelog)

## Juridisk ramme (kort)

| Tillatt (anbefalt) | Unngå |
| --- | --- |
| Offentlige **RSS/Atom**-feeds der utgiver tillater headline + kort sammendrag + lenke tilbake | Scraping av HTML fra nyhetssider uten tillatelse |
| Lisensierte **data-API-er** (betalt) | Kopiere hele gossip-spalter eller artikler |
| Manuelt kuraterte korttekster skrevet av admin (egen tekst) | Framing av andres sider i iframe |
| Ren **lenkeaggregering** med tittel, kilde og deep link | Scraping av X/Twitter uten offisiell API / ToS-brudd |
| Sitatrett: korte sitater med kildehenvisning (norsk åndsverklov) — ikke erstatning for RSS-lisens | Bruke BBC-/Sky-logoer uten tillatelse |

**Praksis for oss:** Vis **overskrift + 1–2 setninger (fra feed) + kilde + lenke**. Aldri full artikkeltekst. Alltid `rel="noopener"` og tydelig «Les hos [kilde]».

## Anbefalte kilder (lovlige nok til aggregering)

### A. Gratis / lav risiko (fase 1)

| Kilde | Hva | Hvorfor OK | Merknad |
| --- | --- | --- | --- |
| **BBC Sport** (football RSS) | Generelle fotballnyheter; gossip-artikler dukker ofte opp som egne poster | BBC publiserer RSS og tillater headline + sammendrag + lenke med attribusjon («From BBC Sport»), uten BBC-logo | Feed: `https://feeds.bbci.co.uk/sport/football/rss.xml`. Filtrer på «gossip» / «transfer» / «Coventry» i tittel/beskrivelse |
| **BBC Football Gossip** (side) | Daglig rundtur av rykter | Best brukt via RSS-treff / manuell kuratering — **ikke** scrape hele spalten | Lenk til dagens gossip-artikkel; eventuelt admin-utdrag |
| **The Guardian Football** RSS | Mer pålitelige overgangsreportasjer | Offentlig RSS, lenke + kort utdrag | Mindre «sladder», mer journalistikk — bra for troverdighet |
| **Sky Blues Trust / supporterkanaler** (hvis RSS) | Lokal vinkel | Ofte åpne feeds fra fan-sider | Sjekk ToS per kilde før aktivering |
| **ccfc.co.uk** (offisiell klubb) | Bekreftede overganger / klubbuttalelser | Offisiell kilde; lenk heller enn å speile | Skille «rykte» vs «bekreftet» i UI |

### B. Betalte API-er (fase 2, valgfritt)

| Leverandør | Hva | Når |
| --- | --- | --- |
| **Sportmonks Transfer Rumours API** | Strukturerte rykter: spiller, klubber, sannsynlighet, kilde + deep link | Når vi vil ha Coventry-filtrert «børs» uten scraping |
| **Football Feeds (transfer rumours)** | JSON/XML med fee, probability, source | Alternativ til Sportmonks |

Betalte feeds er juridisk renest (lisens), men har kostnad og nøkkelhåndtering (GitHub Secrets / Edge Function — ikke i frontend).

### C. Ikke anbefalt som automatiske kilder

| Kilde | Hvorfor |
| --- | --- |
| Transfermarkt HTML-scraping | ToS + databasevern; skjør HTML |
| Sky Sports / The Athletic / tabloid fullside-scrape | Opphavsrett + ToS |
| Fabrizio Romano m.fl. via X-scrape | Bryter plattformens vilkår; bruk heller API/lisens eller manuell «Her we go»-post fra admin |
| Google News scraping | Bruk eventuell lisensiert News API hvis behov |

## Produktkonsept

**Ryktebørsen** = feed-kort (ikke dashboard med stats/chips).

Hvert kort:

1. Spillernavn / kort tittel  
2. Én setning (fra RSS eller admin)  
3. Kilde + publisert tid  
4. Tag: `Rykte` | `Bekreftet` | `Avvist` (admin/regel)  
5. CTA: «Les original» → ekstern lenke  

Valgfritt senere: «Coventry-filter» (toggle), troverdighet (Lav/Medium/Høy) basert på kilde-whitelist.

## Teknisk innpassing (eksisterende stack)

Statisk site + `main.js` + CMS (`site-content.default.json`) + eventuell GitHub Action (som fixtures).

```mermaid
flowchart TB
  subgraph sources [Kilder]
    RSS[RSS feeds]
    ADMIN[Admin manuelt]
    API[Betalt API valgfritt]
  end
  subgraph pipeline [Oppdatering]
    GHA[GitHub Action]
    JSON[assets/data/rumors.json]
    SB[(Supabase rumors valgfritt)]
  end
  subgraph ui [Nettside]
    NAV[Meny Ryktebørsen]
    PAGE[rykteborsen.html]
    RENDER[main.js render]
  end
  RSS --> GHA
  API --> GHA
  ADMIN --> SB
  GHA --> JSON
  JSON --> RENDER
  SB --> RENDER
  NAV --> PAGE --> RENDER
```

### Anbefalt faseinndeling

### Fase 0 — Meny + manuell ryktebørs ✅

1. `rykteborsen.html` (mal etter `nyheter.html`)
2. Nav-lenke på **alle** HTML-sider + `nav.rumors` / `nav.visible.rumors` i CMS
3. Admin-felter for sidetekst i `admin.js` `CONTENT_SECTIONS`
4. Data: `assets/data/rumors.json` fallback + Supabase `rumor_posts` (`20260806120000_rumor_posts.sql`)
5. Admin-panel «Ryktebørsen»: tittel, korttekst, kilde, URL, tag, publisert
6. Oppdatert `changelog.json`

**Drift:** Kjør migrasjonen i Supabase før admin-CRUD virker. Uten tabell faller forsiden tilbake til tom `rumors.json`.

### Fase 1 — Automatisk RSS-aggregat (Coventry-fokus)

1. Script `scripts/update-rumors.mjs` (node, som fixtures)
2. GitHub Action (f.eks. 2–4 ganger daglig i transfervindu, ellers daglig)
3. Hent BBC Football RSS (+ evt. Guardian)
4. Filtrer treff: `Coventry`, `Sky Blues`, kjente spillernavn fra en enkel watchlist, eller «gossip»/«transfer»
5. Lagre kun: `title`, `summary` (trimmet), `source`, `url`, `publishedAt`, `tags`
6. Dedup på URL
7. Vis disclaimer: «Aggregerte overskrifter med lenke til original. Vi republiserer ikke artikler.»

**Lisens-krav i UI:** «From BBC Sport» der BBC er kilde; ingen BBC-logo.

### Fase 2 — Strukturert «børs» (valgfritt)

1. Sportmonks / Football Feeds (nøkkel i secret)
2. Filtrer på lag-ID Coventry City
3. Vis sannsynlighet + kilde-deep-link fra API
4. Fallback til RSS/manuelt hvis API feiler

## UI / innhold (bevar eksisterende design)

- Følg sky blue / Montserrat / eksisterende `page-hero` + `section`
- Ikke bygg et «AI-dashboard»; én liste med tydelige poster
- Skille **Nyheter** (klubbens egne) fra **Ryktebørsen** (eksterne rykter)
- Synlig disclaimer øverst: rykter er spekulasjon; bekreftede saker merkes

## Filendringer (forventet)

| Fil | Endring |
| --- | --- |
| `rykteborsen.html` | Ny side |
| Alle `*.html` med nav | Ny menylenke |
| `assets/data/site-content.default.json` | `nav.rumors`, `rumorsPage.*` |
| `assets/js/main.js` | `renderRumorsPage` |
| `assets/js/admin.js` | CMS + evt. CRUD |
| `assets/data/rumors.json` | Statisk/Action-generert feed |
| `scripts/update-rumors.mjs` | RSS → JSON (fase 1) |
| `.github/workflows/update-rumors.yml` | Schedule |
| `assets/data/changelog.json` | Brukervendt oppføring |
| Evt. `supabase/migrations/..._rumors.sql` | Hvis admin-CRUD i DB |

## Risiko og beslutninger å ta før kode

1. **Kun Coventry eller bred gossip?** Anbefaling: start Coventry-filter + manuelle «hot takes»; bred BBC-gossip som sekundær seksjon.
2. **Manuell-først vs RSS-først?** Anbefaling: Fase 0 først (1–2 dager arbeid i stacken), deretter RSS.
3. **Supabase vs JSON-fil?** JSON + Action matcher fixtures og krever ingen migrasjon; Supabase matcher Nyheter og gir admin-redigering. Hybrid: Action skriver JSON, admin kan «pinne»/overstyre i Supabase.
4. **Betalt API?** Utsett til etter at Fase 0–1 er i bruk.

## Akseptansekriterier

- [ ] Meny «Ryktebørsen» synlig og CMS-styrbar
- [ ] Siden viser liste med kilde + ekstern lenke
- [ ] Ingen fullartikler hostes lokalt
- [ ] BBC-attribusjon korrekt der relevant
- [ ] Disclaimer synlig
- [ ] Changelog oppdatert
- [ ] Fungerer på mobil og desktop i eksisterende layout

## Anbefalt neste steg

Godkjenn **Fase 0** (meny + manuell/admin-kuratert ryktebørs). Deretter **Fase 1** med BBC (+ evt. Guardian) RSS filtrert på Coventry/overganger.
