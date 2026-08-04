# Kampdata og statistikk

## Championship-kampstats (gratis, allerede på plass)

Kilde: [football-data.co.uk](https://www.football-data.co.uk/) CSV  
Filer: `mmz4281/2425/E1.csv` (2024/25) og `mmz4281/2526/E1.csv` (2025/26)  
Output: `assets/data/championship-stats.json`

Inneholder per Coventry-kamp: skudd, på mål, corners, fouls, gule/røde + sesongaggregater.
**Ikke** spillerstats (målscorere, minutter, osv.).

## Spillerstats — API-Football (anbefalt)

1. Gratis nøkkel: https://www.api-football.com/ (100 req/dag)
2. Championship `league=40`, sesong `2024` og `2025`
3. Endpoints:
   - `GET /players?team={coventryId}&season=2024`
   - `GET /players?team={coventryId}&season=2025`
   - (valgfritt) `GET /players/topscorers?league=40&season=2025`
4. Skriv resultatet inn i `players`-feltet per sesong i `championship-stats.json`
5. Lagre nøkkel som GitHub secret `API_FOOTBALL_KEY` når mandagsjobben skal synke live fixtures

Engangsimport av to ferdige sesonger bruker typisk under 20 API-kall — godt innenfor gratisplanen.

## Fixtures (kommende sesong)

Se `.github/workflows/update-fixtures.yml` for ukentlig synk av fixtures/resultater.
