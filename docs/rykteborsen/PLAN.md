# Ryktebørsen — plan

Meny og side som samler overgangsrykter styrt av **søkeord admin legger inn**, med fokus på **lovlig kildebruk** og enkel drift på GitHub Pages + eksisterende stack.

**Status:** Fase 0 + Fase 1 (RSS via søkeord/kilder i admin) implementert. Fase 2 ikke startet.  
**Scope:** Kun treff som matcher admin-definerte søkeord (standard: Coventry-relatert).

## Mål

- Ny meny: **Ryktebørsen** (`rykteborsen.html`)
- Vise rykter som treffer **admin-styrte søkeord**, med kilde, tidspunkt og lenke til originalen
- Soft filter via søkeord (ikke hardkodet kun til ett lag — men default er Coventry)
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

## Søkeord-filter (obligatorisk for auto-henting)

Admin styrer listen under **Admin → Ryktebørsen → Søkeord** (lagres i Supabase `site_settings` / `rumor_keywords`).

- Standard ved første last: `Coventry`, `Sky Blues`, `CCFC`, `CBS Arena`
- Ett ord/uttrykk per linje
- Automatiske treff **må** treffe minst ett søkeord i tittel eller beskrivelse (case-insensitive)
- Ingen treff → ikke vis

Manuelle rykter (fase 0) legges inn uavhengig, men bør følge samme scope.

## Anbefalte kilder (kun Coventry)

### A. Gratis / lav risiko (fase 1) — prioritert rekkefølge

| Prioritet | Kilde | URL | Hvorfor | Merknad |
| --- | --- | --- | --- | --- |
| **1** | **Coventry Telegraph / CoventryLive** Football RSS | `https://www.coventrytelegraph.net/sport/football/rss.xml` | Allerede Coventry-fokus; mye transfer-LIVE og rykter | Beste gratis kilde for oss. Bruk kun tittel + kort beskrivelse + lenke |
| **1b** | CoventryLive Football News RSS | `https://www.coventrytelegraph.net/sport/football/football-news/rss.xml` | Samme familie, litt smalere | Filtrer på transfer/rumour/sign/deal i tittel |
| **2** | **Guardian Transfer window** RSS | `https://www.theguardian.com/football/transfer-window/rss` | Offentlig RSS; hadde Coventry-treff i test | Filtrer på Coventry-nøkkelord / kategori |
| **3** | Guardian Football RSS | `https://www.theguardian.com/football/rss` | Offentlig RSS | Samme Coventry-filter |
| **4** | **BBC Coventry City** team-feed | `https://feeds.bbci.co.uk/sport/football/teams/coventry-city/rss.xml` | Offisiell BBC team-feed + RSS-lisens | I praksis ofte podkast/features — lite rykter; behold som supplement |
| **5** | BBC Sport Football RSS | `https://feeds.bbci.co.uk/sport/football/rss.xml` | Lovlig RSS med attribusjon | **Kun** treff med Coventry-filter (generell feed har ofte 0 Coventry-hits) |
| **6** | Sky Sports Football RSS | `https://www.skysports.com/rss/11095` | Fungerer teknisk; transfer-innslag finnes | **Kun** Coventry-filter; uklare RSS-vilkår → bare tittel + lenke |
| — | **ccfc.co.uk** | (lenke manuelt / senere) | Bekreftede overganger | Merk som `Bekreftet` i UI |

**Ikke bruk generelle Sky-/BBC-gossip-feeder uten Coventry-filter** — de gir nesten bare PL-sladder om andre klubber.

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
6. **Søkeord-felt** i admin (lagres i `site_settings.rumor_keywords`)
7. Oppdatert `changelog.json`

**Drift:** Kjør migrasjonen i Supabase før admin-CRUD virker. Uten tabell faller forsiden tilbake til tom `rumors.json`.

### Fase 1 — Automatisk RSS via søkeord/kilder ✅

1. Script `scripts/update-rumors.mjs`
2. GitHub Action `.github/workflows/update-rumors.yml`
3. Admin: søkeord + RSS-kilder (`rumor_keywords`, `rumor_sources`)
4. Filter: admin-søkeord + transfer-kontekstord
5. Skriver `assets/data/rumors.json`
6. Frontend: overskrift som lenke ut + manuelle Supabase-rykter mergjet inn

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

1. **Fase 0 (ferdig):** Manuell ryktebørs + **søkeord i admin**.  
2. **Fase 1:** RSS-henting som filtrerer på admin-søkeordene (start med Coventry Telegraph).  
3. Sky/BBC generell gossip: bare treff som matcher søkeordene.
