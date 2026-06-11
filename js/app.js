/* Movie Night Matchmaker — quiz + recommendation engine */

(() => {
  "use strict";

  // ---------- State ----------
  const TOTAL_STEPS = 6;
  let catalog = [];
  let catalogUpdated = "";
  let step = 0;
  let shownTitles = new Set(); // avoid repeating picks on reshuffle
  const answers = {
    format: null,   // movie | series | any
    time: null,     // short | medium | long
    mood1: [],      // up to 2
    mood2: [],      // up to 2
    era: null,      // new | classic | any
    avoid: []       // dealbreakers
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const MOOD_LABELS = {
    laugh: "laughs", thrill: "tension", feels: "big feelings",
    think: "brain food", escape: "escapism", cozy: "coziness"
  };

  // ---------- Data loading ----------
  async function loadCatalog() {
    try {
      const res = await fetch("data/titles.json", { cache: "no-store" });
      const data = await res.json();
      catalog = data.titles || [];
      catalogUpdated = data.updated || "";
      const movies = catalog.filter(t => t.type === "movie").length;
      const series = catalog.length - movies;
      $("#catalog-meta").textContent =
        `Choosing from ${movies} movies and ${series} series · catalog updated ${catalogUpdated}`;
      $("#footer-updated").textContent = `Last update: ${catalogUpdated}`;
    } catch (err) {
      $("#catalog-meta").textContent = "Couldn't load the catalog — check your connection and refresh.";
      console.error("Catalog load failed:", err);
    }
  }

  // ---------- Screen / step navigation ----------
  function showScreen(id) {
    $$(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderStep() {
    $$(".step").forEach(s => s.classList.toggle("active", +s.dataset.step === step));
    $("#progress-fill").style.width = `${((step + 1) / TOTAL_STEPS) * 100}%`;
    $("#progress-label").textContent = `${step + 1} / ${TOTAL_STEPS}`;
    $("#btn-back").style.visibility = step === 0 ? "hidden" : "visible";
    $("#btn-next").textContent = step === TOTAL_STEPS - 1 ? "Get our match 🍿" : "Next →";
    updateNextEnabled();
  }

  function currentStepGroup() {
    return $(`.step[data-step="${step}"] .options`);
  }

  function stepIsAnswered() {
    const group = currentStepGroup();
    const name = group.dataset.name;
    if (name === "avoid") return true; // optional step
    const val = answers[name];
    return Array.isArray(val) ? val.length > 0 : val !== null;
  }

  function updateNextEnabled() {
    $("#btn-next").disabled = !stepIsAnswered();
  }

  // ---------- Option selection ----------
  function bindOptions() {
    $$(".options").forEach(group => {
      const name = group.dataset.name;
      const single = group.dataset.single === "true";
      const max = +(group.dataset.max || 1);

      group.addEventListener("click", (e) => {
        const btn = e.target.closest(".opt");
        if (!btn) return;
        const value = btn.dataset.value;

        if (single) {
          [...group.children].forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          answers[name] = value;
        } else {
          const list = answers[name];
          const idx = list.indexOf(value);
          if (idx >= 0) {
            list.splice(idx, 1);
            btn.classList.remove("selected");
          } else {
            if (list.length >= max) {
              // drop the oldest selection to make room
              const removed = list.shift();
              const oldBtn = [...group.children].find(b => b.dataset.value === removed);
              if (oldBtn) oldBtn.classList.remove("selected");
            }
            list.push(value);
            btn.classList.add("selected");
          }
        }
        updateNextEnabled();
      });
    });
  }

  // ---------- Recommendation engine ----------
  function passesDealbreakers(t) {
    const a = answers.avoid;
    if (a.includes("horror") && t.genres.includes("horror")) return false;
    if (a.includes("heavy") && t.tone === "heavy") return false;
    if (a.includes("slow") && t.pace === "slow") return false;
    if (a.includes("subtitles") && t.language !== "en") return false;
    if (a.includes("romance") && t.romanceCentral) return false;
    if (a.includes("violence") && t.violence) return false;
    return true;
  }

  function passesFormat(t) {
    return answers.format === "any" || t.type === answers.format;
  }

  function scoreTitle(t) {
    let score = 0;

    // Mood match — the heart of it. Reward covering BOTH partners.
    const m1 = answers.mood1.filter(m => t.moods.includes(m));
    const m2 = answers.mood2.filter(m => t.moods.includes(m));
    score += (m1.length + m2.length) * 2;
    if (m1.length && m2.length) score += 5; // satisfies both people
    if (!m1.length && !m2.length) score -= 6;

    // Time fit
    if (answers.time === "short") {
      if (t.type === "series" && t.runtime <= 35) score += 3;
      else if (t.type === "series") score += 1.5;
      else if (t.runtime <= 100) score += 0.5;
      else score -= 3;
    } else if (answers.time === "medium") {
      if (t.type === "movie" && t.runtime <= 150) score += 2.5;
      else if (t.type === "movie") score += 0.5;
      else score += 1;
    } else if (answers.time === "long") {
      if (t.runtime >= 130 || t.type === "series") score += 2;
    }

    // Era preference
    const thisYear = new Date().getFullYear();
    if (answers.era === "new") {
      if (t.year >= thisYear - 2) score += 3.5;
      else if (t.year >= thisYear - 6) score += 1;
      else score -= 2;
    } else if (answers.era === "classic") {
      if (t.year <= 2012) score += 3;
      else if (t.year <= 2019) score += 1;
      else score -= 1.5;
    }

    // Quality nudge
    score += (t.rating - 7) * 1.5;

    // A pinch of chaos so reshuffles feel alive
    score += Math.random() * 1.5;

    return score;
  }

  function getRecommendations() {
    let pool = catalog.filter(t => passesFormat(t) && passesDealbreakers(t));
    if (pool.length === 0) return null;

    const ranked = pool
      .map(t => ({ t, score: scoreTitle(t) }))
      .sort((a, b) => b.score - a.score);

    // Prefer titles we haven't shown this session
    const fresh = ranked.filter(r => !shownTitles.has(r.t.title));
    const source = fresh.length >= 3 ? fresh : ranked;

    const picks = source.slice(0, 3).map(r => r.t);
    picks.forEach(p => shownTitles.add(p.title));
    return picks;
  }

  // ---------- Rendering results ----------
  function fmtRuntime(t) {
    if (t.type === "series") return `~${t.runtime} min/ep`;
    const h = Math.floor(t.runtime / 60), m = t.runtime % 60;
    return h ? `${h}h ${m ? m + "m" : ""}`.trim() : `${m}m`;
  }

  function matchNote(t) {
    const m1 = answers.mood1.filter(m => t.moods.includes(m)).map(m => MOOD_LABELS[m]);
    const m2 = answers.mood2.filter(m => t.moods.includes(m)).map(m => MOOD_LABELS[m]);
    if (m1.length && m2.length) {
      const both = [...new Set([...m1, ...m2])];
      return `💞 Works for both of you — ${both.join(" + ")}.`;
    }
    if (m1.length) return `Covers Partner 1's pick (${m1.join(", ")}) — Partner 2, consider it a gift.`;
    if (m2.length) return `Covers Partner 2's pick (${m2.join(", ")}) — Partner 1, you owe them one.`;
    return "A wildcard pick — sometimes the best nights are unplanned.";
  }

  function badgesHTML(t) {
    return `
      <div class="badges">
        <span class="badge badge-type">${t.type === "movie" ? "🎬 Movie" : "📺 Series"}</span>
        <span class="badge badge-rating">★ ${t.rating.toFixed(1)}</span>
        <span class="badge badge-runtime">⏱ ${fmtRuntime(t)}</span>
        ${t.genres.slice(0, 3).map(g => `<span class="badge">${g}</span>`).join("")}
      </div>`;
  }

  function renderResults() {
    const picks = getRecommendations();

    if (!picks) {
      $("#winner-card").innerHTML = `
        <div class="empty-state">
          <h3>That's… a lot of deal-breakers 😅</h3>
          <p>Nothing in the catalog survives all those filters. Try removing one or two and we'll find you something.</p>
        </div>`;
      $("#alt-cards").innerHTML = "";
      showScreen("#screen-results");
      return;
    }

    const [winner, ...alts] = picks;

    $("#winner-card").innerHTML = `
      <article class="winner">
        <div class="winner-body">
          <div class="title-row">
            <h3>${winner.title}</h3>
            <span class="year">${winner.year}</span>
          </div>
          ${badgesHTML(winner)}
          <p class="desc">${winner.desc}</p>
          <p class="match-note">${matchNote(winner)}</p>
        </div>
      </article>`;

    $("#alt-cards").innerHTML = alts.map(t => `
      <article class="alt-card">
        <h4>${t.title} <span class="year">(${t.year})</span></h4>
        ${badgesHTML(t)}
        <p class="desc">${t.desc}</p>
      </article>`).join("");

    showScreen("#screen-results");
  }

  // ---------- Wiring ----------
  function resetQuiz() {
    step = 0;
    shownTitles.clear();
    answers.format = null;
    answers.time = null;
    answers.mood1 = [];
    answers.mood2 = [];
    answers.era = null;
    answers.avoid = [];
    $$(".opt").forEach(b => b.classList.remove("selected"));
  }

  $("#btn-start").addEventListener("click", () => {
    resetQuiz();
    renderStep();
    showScreen("#screen-quiz");
  });

  $("#btn-next").addEventListener("click", () => {
    if (!stepIsAnswered()) return;
    if (step < TOTAL_STEPS - 1) {
      step++;
      renderStep();
    } else {
      renderResults();
    }
  });

  $("#btn-back").addEventListener("click", () => {
    if (step > 0) {
      step--;
      renderStep();
    }
  });

  $("#btn-reshuffle").addEventListener("click", renderResults);

  $("#btn-restart").addEventListener("click", () => {
    resetQuiz();
    showScreen("#screen-intro");
  });

  bindOptions();
  loadCatalog();
})();
