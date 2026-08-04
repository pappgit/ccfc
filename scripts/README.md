# Kampdata-synk (kommer etter pitch)

Når klubben har godkjent retningen:

1. Opprett gratis nøkkel på [API-Football](https://www.api-football.com/)
2. Lagre den som GitHub Actions secret: `API_FOOTBALL_KEY`
3. Implementer `scripts/update-fixtures.mjs` som:
   - henter team fixtures for Coventry (alle ligaer/cup for sesongen)
   - for kamper med status `FT`: henter events + statistics
   - skriver `assets/data/fixtures.json` i samme format som eksempeldataen
4. Aktiver commit-stegene i `.github/workflows/update-fixtures.yml`

Ukentlig (mandag) er nok: ingen live-polling, kun ferdige kamper + eventuelle
programendringer.
