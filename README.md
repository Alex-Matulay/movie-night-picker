# 🍿 Movie Night Matchmaker

**Stop scrolling. Start watching.**

A little web app for couples who can never decide what to watch. Both partners answer a few quick questions — format, time available, each person's mood, era preference, and any deal-breakers — and the matchmaker scores its catalog and serves up one winning pick plus two backups.

## How it works

1. **Pick a format** — movie, series, or surprise us.
2. **Say how much time you have** — an episode, a full movie, or all night.
3. **Each partner picks their mood** (separately — no peeking): laughs, tension, big feelings, brain food, escapism, or cozy.
4. **New release or classic?**
5. **Deal-breakers** — no horror, nothing heavy, no subtitles tonight, etc. These are hard filters.

The recommendation engine scores every title in the catalog: titles that satisfy **both** partners' moods get a big bonus, runtime is matched to your evening, deal-breakers are excluded outright, and a touch of randomness keeps reshuffles interesting.

## Weekly catalog updates

The catalog ([data/titles.json](data/titles.json)) starts with ~115 hand-curated movies and series and refreshes automatically **every Monday** via [GitHub Actions](.github/workflows/update-catalog.yml):

- **New series** are pulled from the free [TVMaze API](https://www.tvmaze.com/api) — no API key needed, works out of the box. The script finds shows that premiered (S01E01) in the past 7 days.
- **New movies** are pulled from [TMDB](https://www.themoviedb.org/documentation/api) — optional. To enable, get a free TMDB API key and add it as a repository secret named `TMDB_API_KEY` (Settings → Secrets and variables → Actions → New repository secret).

New titles get mood/tone/pacing metadata inferred from their genres, are deduplicated against the existing catalog, and are committed automatically. You can also trigger an update any time from the **Actions** tab (`Run workflow`), or locally:

```bash
node scripts/update-catalog.mjs
```

## Running locally

It's a static site — no build step. Serve the folder with any static server:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000`. (A plain `file://` open won't work because the catalog is fetched with `fetch()`.)

## Project structure

```
index.html                          # the app (intro → quiz → results)
css/style.css                       # styling
js/app.js                           # quiz flow + recommendation engine
data/titles.json                    # the catalog (curated + auto-added)
scripts/update-catalog.mjs          # weekly updater (TVMaze + optional TMDB)
.github/workflows/update-catalog.yml # Monday cron job
```

## Tech

Vanilla HTML/CSS/JS, zero dependencies, zero build step. Deployable on GitHub Pages as-is.
