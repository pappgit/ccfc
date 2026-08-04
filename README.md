# Coventry City Scandinavia

Pitch-utkast til nettside for skandinavisk Coventry City-supporterklubb.

**Sky blue forever** — farger inspirert av [ccfc.co.uk](https://www.ccfc.co.uk/) (`#059DD9`). Eget CCS-merke (ikke offisiell klubblogo) til vi har avklart merkevare med klubben.

## Hva som er med

| Side | Innhold |
|------|---------|
| `index.html` | Hero, neste kamper, nyheter |
| `kamper.html` | Kommende / resultater / alle · liga & cup · detaljer etter FT |
| `nyheter.html` | Nyhetsseksjon (JSON) |
| `om-oss.html` | Om klubben + merkevare-note |

**Ikke i denne fasen:** forum, innlogging, live-scores.

## Hosting: GitHub Pages

Statisk site — ingen build-steg.

1. Push repo til GitHub
2. Settings → Pages → Source: **Deploy from a branch** → `main` / `/ (root)`
3. Åpne `https://<bruker>.github.io/<repo>/`

Lokal forhåndsvisning (trengs fordi `fetch` av JSON ikke virker via `file://`):

```bash
cd ccfc
python3 -m http.server 8080
# åpne http://localhost:8080
```

## Data

- Kamper: `assets/data/fixtures.json` (eksempeldata nå)
- Nyheter: `assets/data/news.json` — legg til poster manuelt, eller bytt til CMS senere
- Mandags-Action: `.github/workflows/update-fixtures.yml` (skjelett, klar for API-Football)

## Pitch til klubben — snakkepunkter

1. **Lav kostnad** — GitHub Pages + ukentlig API-oppdatering
2. **Kamper** — liga + cup, resultater med målscorere og stats etter kamp
3. **Nyheter** — egen seksjon for skandinaviske fans
4. **Merkevare** — sky blue nå; offisiell logo avklares med CCFC
5. **Neste steg** — forum bak innlogging (utenfor Pages) når retningen er godkjent

## Stack

HTML · CSS · vanilla JS · JSON · GitHub Actions (planlagt)
