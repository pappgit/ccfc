# Kampdata og statistikk

## Fixtures (Premier League 2026/27 + cup)

Script: `scripts/update-fixtures.mjs`  
Workflow: `.github/workflows/update-fixtures.yml` (hver mandag + manuell kjøring)

### Kvote (gratisplan = 100/dag)

Per kjøring typisk:

1. `GET /fixtures?team=1346&season=2026` — **1 kall** (alle liga/cup)
2. `GET /fixtures?ids=…` — inntil **2 kall** (maks 20 kamper/kall) kun for FT uten detaljer

**Maks ~3 kall/mandag** når sesongen er i gang. Første uke uten ferdige kamper: **1 kall**.

Team-id er hardkodet (`1346` = Coventry City) for å unngå search-kall.

### Secret

`API_FOOTBALL_KEY` i repo → Settings → Secrets → Actions.

### Manuell kjøring

GitHub → Actions → **Update fixtures** → **Run workflow**.

## Championship-kampstats (historikk)

Kilde: football-data.co.uk CSV → `assets/data/championship-stats.json`  
Spillerstats: kan fylles senere via API-Football `/players` (spar kall — engangsimport).
