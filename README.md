# FPL Analyser — GitHub Pages Edition

This edition is designed to be public-hosted entirely on GitHub.

## Architecture

```text
GitHub Action (server-side)
        |
        | fetches FPL API
        v
data/bootstrap.json
data/fixtures.json
data/history.json
        |
        | same-origin static files
        v
GitHub Pages
        |
        v
Browser FPL Analyser
```

The browser does **not** call `fantasy.premierleague.com`, so FPL API CORS restrictions do not affect the app.

## First deployment

1. Create a new **public GitHub repository**.
2. Upload all files/folders in this ZIP, preserving:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `data/`
   - `scripts/`
   - `.github/workflows/`
3. Open **Actions → Update FPL Data → Run workflow**.
4. Wait for the workflow to finish. It will populate the JSON files and commit them.
5. Open **Settings → Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select your main branch and `/ (root)`.
8. Save.

Your app will then be available at the GitHub Pages URL.

## Automatic data updates

The workflow runs every six hours and can also be run manually.

GitHub scheduled workflows are approximate, not guaranteed to start at the exact cron minute.

For a public repository, GitHub may disable scheduled workflows after long periods with no repository activity. Manual `workflow_dispatch` remains available.

## Runtime

Each user's browser stores only their personal:
- 15-player squad
- selling prices
- bank

Everyone shares the same published FPL data snapshot and the same calculation code.

## Model retained from the Google Sheets baseline

- AI score: Fixture 20%, Performance 20%, Expected Output 20%, Value 15%, Reliability 10%, Availability 10%, Position 5%.
- Historical season score: 80% season points vs position target + 20% minutes.
- Previous seasons: 55% / 30% / 15%.
- Historical confidence: 3+ seasons 100%, 2 seasons 80%, 1 season 55%, no history 0%.
- Dynamic current-season vs historical weighting by gameweek.
- Legal best-XI formation testing.
- Bench swap analysis.
- KEEP / WATCH / SELL / ALT transfer analysis.
- Single free-transfer simulation.
- Transfer Value = 70% GW XI Gain + 30% Asset Improvement.
- £100m automatic squad builder.


## v1.1 additions

### Sortable tables
Click any table column heading to sort ascending. Click it again to reverse the order. Numeric fields are sorted numerically, not alphabetically.

### Media Activity
The GitHub Action now creates `data/media.json` using Google News RSS search results for up to 250 currently relevant FPL players.

For each player the snapshot records:
- articles since the player's club last completed match (clamped to a 24-hour to 7-day window)
- unique news sources
- article count in the equivalent preceding window
- Media Activity Index
- last 24-hour count
- last 72-hour count

The Media Activity Index is an anomaly indicator:
- 100 ≈ same publishing rate as the previous equivalent window
- above 100 = elevated activity
- 200 = about twice the preceding rate

HIGH requires at least 5 current-window articles and an index of at least 200.
ELEVATED requires at least 3 current-window articles and an index of at least 125.

Media Activity is deliberately **not included in the FPL AI/Transfer Score**. It is an investigation signal, not assumed evidence that a player is a better or worse asset.
