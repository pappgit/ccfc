# Agent-regler — Coventry City Scandinavia

## Endringslogg (obligatorisk)

Ved **alle** endringer eller nye funksjoner som brukere eller admin merker: oppdater `assets/data/changelog.json` i **samme** commit/PR.

- Ny oppføring øverst i `entries` (nyeste først)
- Format: `date` (YYYY-MM-DD), `title` (kort norsk tittel), `items` (1–4 korte punkter på norsk, brukerspråk)
- Beskriv resultatet for brukeren, ikke interne filnavn eller commit-hash
- Små rene refactors/docs uten synlig effekt trenger ikke egen oppføring; alt annet skal inn

Admin kan også legge til egne oppføringer under **Endringslogg** (lagres i Supabase). Innebygde/kode-endringer skal likevel alltid inn i `changelog.json`.
