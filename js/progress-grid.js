// Shared progress-grid renderer: the tier ladder, difficulty banding, the tier-state
// logic, and the constellation-card builder. Loaded as a plain-script global (no build).
// Two callers draw the same cards: the course screen's full grid and the result screen's
// practiced-this-lesson strip (both in index.html). The `highlight` hook marks dots that
// newly passed the just-finished lesson. Depends on nothing but the DOM (only progressCard
// touches it).

const TIERS = [
  { key: 'identify/diagram', short: 'iD', label: 'Identify by diagram' },
  { key: 'find/diagram',     short: 'fD', label: 'Find by diagram' },
  { key: 'identify/stars',   short: 'iS', label: 'Identify by stars' },
  { key: 'find/stars',       short: 'fS', label: 'Find by stars' },
  { key: 'identify/photo',   short: 'iP', label: 'Identify by photo' },
  { key: 'find/photo',       short: 'fP', label: 'Find by photo' },
  { key: 'find/photo-nb',    short: 'nP', label: 'Find by photo (no bounds)' },
];

// Classify one constellation+tier against an explicit exposure record:
// 'passed' (correct>=1) | 'seen' (seen>=1) | 'unseen'.
function tierClass(exposure, abbr, key) {
  const t = exposure?.[abbr]?.[key];
  if (!t) return 'unseen';
  if (t.correct >= 1) return 'passed';
  if (t.seen >= 1) return 'seen';
  return 'unseen';
}

// Difficulty band labels shown as grid section headers, keyed by con.diff.
const DIFFICULTY_BANDS = {
  1: 'Instant Recognition', 2: 'Bright & Distinctive',
  3: 'Prominent',           4: 'Moderate',
  5: 'Faint Zodiac & Medium Southern', 6: 'Regional Familiarity',
  7: 'Faint or Deep South', 8: 'The Invisible',
};

// Group constellations into difficulty bands for the progress grid: sorted by diff then
// name, one group per distinct diff, returned as [{ diff, label, cons }] ascending.
// Does not mutate its input.
function consByDifficulty(cons) {
  const sorted = [...(cons || [])].sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name));
  const groups = [];
  let cur = null;
  for (const con of sorted) {
    if (!cur || con.diff !== cur.diff) {
      cur = { diff: con.diff, label: DIFFICULTY_BANDS[con.diff] || `Difficulty ${con.diff}`, cons: [] };
      groups.push(cur);
    }
    cur.cons.push(con);
  }
  return groups;
}

// The distinct constellations across a lesson's questions, deduped by abbr in
// first-encounter order — the set of cards a result/progress surface shows for a lesson.
function distinctCons(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions || []) {
    const con = q?.con;
    if (con && !seen.has(con.abbr)) { seen.add(con.abbr); out.push(con); }
  }
  return out;
}

// The set of "abbr/tierKey" strings for tiers that passed for the FIRST time between two
// exposure snapshots (before → after), across `cons`. Feeds progressCard's `highlight` so
// the result screen can emphasize what this lesson just unlocked. A null `before` (no
// pre-lesson snapshot, e.g. after a reload) yields an empty set — nothing emphasized, the
// graceful fallback.
function newlyPassed(before, after, cons) {
  const set = new Set();
  if (!before) return set;
  for (const con of cons || []) {
    for (const t of TIERS) {
      if (tierClass(before, con.abbr, t.key) !== 'passed' &&
          tierClass(after, con.abbr, t.key) === 'passed') {
        set.add(`${con.abbr}/${t.key}`);
      }
    }
  }
  return set;
}

// Build a .con-card element (name + 7 tier dots) for `con` against `exposure`.
// opts.highlight: a Set of "abbr/tierKey" strings; matching dots get `.just-passed`.
function progressCard(con, exposure, opts = {}) {
  const highlight = opts.highlight;
  const e = exposure?.[con.abbr];
  const unseen = (e?.['identify/diagram']?.seen || 0) === 0;

  const card = document.createElement('div');
  card.className = 'con-card' + (unseen ? ' unseen' : '');

  const dots = TIERS.map(t => {
    const cls = tierClass(exposure, con.abbr, t.key);
    const data = e?.[t.key];
    const tip = `${t.key}: seen ${data?.seen || 0}, correct ${data?.correct || 0}`;
    const pop = highlight && highlight.has(`${con.abbr}/${t.key}`) ? ' just-passed' : '';
    return `<div class="tier ${cls}${pop}" title="${tip}"></div>`;
  }).join('');

  card.innerHTML =
    `<div class="con-name" title="${con.name}">${con.name}</div>` +
    `<div class="tiers">${dots}</div>`;
  return card;
}

// Render the full banded progress grid — every constellation in `catalog` as a
// progressCard, grouped into difficulty bands with a header each — into `host`
// (cleared first). Shared by the course map and the calibration payoff so both
// draw the identical grid. opts is forwarded to progressCard (e.g. `highlight`);
// opts.onCardClick(con, card), if given, is wired to each card.
function renderProgressGrid(host, catalog, exposure, opts = {}) {
  host.innerHTML = '';
  for (const band of consByDifficulty(catalog)) {
    const hdr = document.createElement('div');
    hdr.className = 'diff-header';
    hdr.textContent = band.label;
    host.appendChild(hdr);
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const con of band.cons) {
      const card = progressCard(con, exposure, opts);
      if (opts.onCardClick)
        card.addEventListener('click', e => { e.stopPropagation(); opts.onCardClick(con, card); });
      grid.appendChild(card);
    }
    host.appendChild(grid);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIERS, DIFFICULTY_BANDS, tierClass, consByDifficulty, distinctCons, newlyPassed, progressCard, renderProgressGrid };
}
