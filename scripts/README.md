# Kampdata og statistikk

## Viktig: API-Football gratisplan

Gratisplanen hos API-Football gir **ikke** tilgang til sesong **2026** (kun ca. 2022–2024).
Derfor ligger PL 2026/27-programmet i `fixtures.json` fra offisiell fixture-release.

## Auto-oppdatering (anbefalt, gratis)

1. Registrer gratis på https://www.football-data.org/client/register  
2. Kopier API-token  
3. GitHub → repo **Settings** → **Secrets** → **Actions** → ny secret:  
   `FOOTBALL_DATA_API_KEY` = tokenet  
4. Kjør Actions → **Update fixtures**

Scriptet bruker da **1–2 kall** (PL + FA Cup) — godt innenfor gratisplan.

`API_FOOTBALL_KEY` beholdes for senere (Pro) eller historikk.

## Championship-historikk

`assets/data/championship-stats.json` fra football-data.co.uk CSV (24/25 + 25/26).
