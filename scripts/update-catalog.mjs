/**
 * Weekly catalog updater.
 *
 * Pulls newly released titles and merges them into data/titles.json:
 *  - Series:  TVMaze API (free, no key required) — series that premiered in the last 7 days.
 *  - Movies:  TMDB API (optional) — recent wide releases. Only runs if TMDB_API_KEY is set.
 *
 * Run locally:  node scripts/update-catalog.mjs
 * Run in CI:    see .github/workflows/update-catalog.yml (weekly cron)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "titles.json");
const MAX_NEW_PER_RUN = 12;
const MAX_AUTO_TITLES = 150; // cap on auto-added entries; curated entries are never evicted

// ---------- Genre → metadata heuristics ----------
const MOOD_MAP = {
  comedy: ["laugh"], romance: ["feels"], drama: ["feels"],
  thriller: ["thrill"], horror: ["thrill"], crime: ["thrill"], action: ["thrill", "escape"],
  mystery: ["think", "thrill"], scifi: ["think", "escape"], history: ["think"],
  documentary: ["think"], fantasy: ["escape"], adventure: ["escape"],
  animation: ["escape"], family: ["cozy"], musical: ["feels", "escape"],
  sport: ["thrill"], reality: ["cozy"], war: ["think"], western: ["escape"]
};

const HEAVY_GENRES = ["horror", "war", "crime"];
const LIGHT_GENRES = ["comedy", "family", "reality", "musical"];
const VIOLENT_GENRES = ["horror", "action", "crime", "war", "thriller"];
const FAST_GENRES = ["action", "comedy", "thriller", "adventure"];

function normalizeGenre(g) {
  const s = String(g).toLowerCase().replace(/[^a-z-]/g, "");
  const aliases = {
    "science-fiction": "scifi", "sciencefiction": "scifi", "sci-fi": "scifi",
    "actionadventure": "action", "warpolitics": "war", "kids": "family",
    "soap": "drama", "talkshow": "reality", "gameshow": "reality", "espionage": "thriller",
    "supernatural": "fantasy", "anime": "animation", "music": "musical", "biography": "drama"
  };
  return aliases[s] || s;
}

function inferMeta(genres) {
  const moods = [...new Set(genres.flatMap(g => MOOD_MAP[g] || []))].slice(0, 3);
  if (moods.length === 0) moods.push("escape");
  const tone = genres.some(g => HEAVY_GENRES.includes(g)) ? "heavy"
    : genres.some(g => LIGHT_GENRES.includes(g)) ? "light" : "medium";
  const pace = genres.some(g => FAST_GENRES.includes(g)) ? "fast" : "normal";
  const violence = genres.some(g => VIOLENT_GENRES.includes(g));
  const romanceCentral = genres.includes("romance");
  return { moods, tone, pace, violence, romanceCentral };
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(s, n = 180) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---------- Source: TVMaze (series, keyless) ----------
async function fetchNewSeries() {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    const date = isoDaysAgo(i);
    for (const endpoint of [
      `https://api.tvmaze.com/schedule/web?date=${date}`,
      `https://api.tvmaze.com/schedule?date=${date}&country=US`
    ]) {
      let entries;
      try {
        entries = await fetchJson(endpoint);
      } catch (err) {
        console.warn(`TVMaze fetch failed (${endpoint}): ${err.message}`);
        continue;
      }
      for (const ep of entries) {
        // Only series premieres: season 1, episode 1
        if (ep.season !== 1 || ep.number !== 1) continue;
        const show = ep._embedded?.show || ep.show;
        if (!show || seen.has(show.id)) continue;
        seen.add(show.id);

        const genres = (show.genres || []).map(normalizeGenre).filter(Boolean);
        if (genres.length === 0) continue;
        const summary = stripHtml(show.summary);
        if (!summary) continue; // skip shows with no description

        out.push({
          title: show.name,
          type: "series",
          year: show.premiered ? +show.premiered.slice(0, 4) : new Date().getFullYear(),
          genres: [...new Set(genres)].slice(0, 4),
          runtime: show.averageRuntime || show.runtime || 45,
          rating: show.rating?.average || 7.0,
          language: (show.language || "English").toLowerCase().startsWith("english") ? "en" : "other",
          desc: truncate(summary),
          ...inferMeta(genres)
        });
      }
    }
  }
  // Prefer better-rated premieres
  return out.sort((a, b) => b.rating - a.rating);
}

// ---------- Source: TMDB (movies, optional key) ----------
async function fetchNewMovies(apiKey) {
  const GENRES = {
    28: "action", 12: "adventure", 16: "animation", 35: "comedy", 80: "crime",
    99: "documentary", 18: "drama", 10751: "family", 14: "fantasy", 36: "history",
    27: "horror", 10402: "musical", 9648: "mystery", 10749: "romance",
    878: "scifi", 53: "thriller", 10752: "war", 37: "western"
  };
  const url = `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${apiKey}` +
    `&primary_release_date.gte=${isoDaysAgo(30)}` +
    `&primary_release_date.lte=${isoDaysAgo(0)}` +
    `&sort_by=popularity.desc&vote_count.gte=20&include_adult=false`;
  const data = await fetchJson(url);

  return (data.results || []).map(m => {
    const genres = (m.genre_ids || []).map(id => GENRES[id]).filter(Boolean);
    if (genres.length === 0 || !m.overview) return null;
    return {
      title: m.title,
      type: "movie",
      year: m.release_date ? +m.release_date.slice(0, 4) : new Date().getFullYear(),
      genres: genres.slice(0, 4),
      runtime: 115, // discover endpoint doesn't include runtime; use a sane default
      rating: Math.round((m.vote_average || 7) * 10) / 10,
      language: m.original_language === "en" ? "en" : m.original_language,
      desc: truncate(stripHtml(m.overview)),
      ...inferMeta(genres)
    };
  }).filter(Boolean);
}

// ---------- Merge ----------
function keyOf(t) {
  return `${t.title.toLowerCase().trim()}::${t.type}`;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const existing = new Set(data.titles.map(keyOf));

  let candidates = [];

  try {
    const series = await fetchNewSeries();
    console.log(`TVMaze: found ${series.length} series premieres in the last 7 days`);
    candidates.push(...series);
  } catch (err) {
    console.warn(`TVMaze step failed entirely: ${err.message}`);
  }

  const tmdbKey = process.env.TMDB_API_KEY;
  if (tmdbKey) {
    try {
      const movies = await fetchNewMovies(tmdbKey);
      console.log(`TMDB: found ${movies.length} recent movie releases`);
      candidates.push(...movies);
    } catch (err) {
      console.warn(`TMDB step failed: ${err.message}`);
    }
  } else {
    console.log("TMDB_API_KEY not set — skipping new movie fetch (series still update via TVMaze).");
  }

  // Dedupe against catalog and within this batch, keep the best, cap per run
  const fresh = [];
  for (const c of candidates) {
    const k = keyOf(c);
    if (existing.has(k)) continue;
    existing.add(k);
    fresh.push({ ...c, source: "auto", added: isoDaysAgo(0) });
    if (fresh.length >= MAX_NEW_PER_RUN) break;
  }

  if (fresh.length === 0) {
    console.log("No new titles to add this week. Catalog unchanged.");
    return;
  }

  data.titles.push(...fresh);

  // Evict oldest/lowest-rated auto entries beyond the cap (never curated ones)
  const auto = data.titles.filter(t => t.source === "auto");
  if (auto.length > MAX_AUTO_TITLES) {
    const toDrop = new Set(
      auto.sort((a, b) => (a.added || "").localeCompare(b.added || "") || a.rating - b.rating)
        .slice(0, auto.length - MAX_AUTO_TITLES)
        .map(keyOf)
    );
    data.titles = data.titles.filter(t => t.source !== "auto" || !toDrop.has(keyOf(t)));
  }

  data.updated = isoDaysAgo(0);
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`Added ${fresh.length} new titles:`);
  fresh.forEach(t => console.log(`  + [${t.type}] ${t.title} (${t.year}) ★${t.rating}`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
