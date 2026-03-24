# App Redesign Plan

## Philosophy
- **Quiz first, explain later** (Duolingo model) — the quiz IS the learning
- Exploration and finding guides are reference material you dip into, not prerequisites
- Progression: recognize constellations → find them on virtual sky → find them in real sky

## Three Modes

### /explore
Unified sky browser. Absorbs the old viewer mode. One UI for browsing the sky and visiting particular constellations. You can:
- Select a constellation to go to
- Toggle layers (diagram, art, photo, boundaries, star names, etc.)
- Read the Wikipedia summary
- Launch the finding guide
- Free-roam

### /train
Adaptive quizzing. Throws you in immediately — no study-first prerequisite. Quiz types escalate in difficulty:
- "What's this constellation?" (identify from diagram/photo)
- Point to it on the sky map
- Find/navigate challenges

Links to explore/guides from within the quiz when you get something wrong or want to learn more. Difficulty adapts to progress — no predefined course or named lessons.

### /progress
Stats view. What you've mastered, what needs work.

## Routing
Move from hash routing (#course, #quiz, etc.) in one HTML file to proper path routing with pushState: /train, /progress, /explore, /explore?con=Ori, etc.

find-help.html becomes a route in the main app rather than a separate page.

## Difficulty Levels (8 tiers, draft)

### 1 — Instant Recognition (5)
Orion, Ursa Major, Scorpius, Crux, Cassiopeia

### 2 — Bright & Distinctive (8)
Leo, Cygnus, Canis Major, Taurus, Lyra, Gemini, Sagittarius, Centaurus

### 3 — Prominent, Needs a Little Skill (11)
Boötes, Auriga, Pegasus, Aquila, Andromeda, Perseus, Corona Borealis, Corvus, Ursa Minor, Canis Minor, Aries

### 4 — Moderate (12)
Virgo, Capricornus, Libra, Draco, Cepheus, Ophiuchus, Hercules, Delphinus, Sagitta, Grus, Pavo, Triangulum

### 5 — Faint Zodiac & Medium Southern (12)
Pisces, Aquarius, Cancer, Serpens, Lepus, Eridanus, Carina, Ara, Corona Australis, Lupus, Piscis Austrinus, Columba

### 6 — Requires Regional Familiarity (13)
Hydra, Cetus, Vela, Puppis, Monoceros, Crater, Lynx, Coma Berenices, Scutum, Lacerta, Equuleus, Triangulum Australe, Phoenix

### 7 — Faint or Deep South (14)
Vulpecula, Leo Minor, Camelopardalis, Sextans, Fornax, Sculptor, Tucana, Indus, Musca, Circinus, Norma, Telescopium, Volans, Microscopium

### 8 — The Invisible (11)
Antlia, Pyxis, Caelum, Horologium, Reticulum, Pictor, Mensa, Octans, Chamaeleon, Apus, Dorado

## Challenge Tiers (7 per constellation)

The old system tracked 16 discrete tier keys per constellation (identify/find/navigate × diagram/stars/photo × bounds/no-bounds/choice/autocomplete). The new model collapses this to **7 tiers** with continuous difficulty knobs inside each.

| Tier | Challenge | Adaptive knobs |
|------|-----------|---------------|
| 1 | Identify diagram | choice → autocomplete |
| 2 | Find diagram (no bounds) | starting distance |
| 3 | Identify stars | choice → autocomplete |
| 4 | Find stars (with bounds) | starting distance |
| 5 | Identify photo | choice → autocomplete |
| 6 | Find photo (with bounds) | starting distance |
| 7 | Find photo (no bounds) | starting distance |

### Design rationale

**Choice vs autocomplete** is not a separate tier — it's a difficulty knob within each "identify" tier. Early attempts get a 4-option multiple choice; as the user builds accuracy, choices go away and they type the name. Same tier, same progress tracking, just harder.

**Navigate vs find** is also not a separate tier — it's a continuous "starting distance" knob within each "find" tier. Early on you're already looking at the target; as you improve, you start farther away and have to scroll over. The user doesn't know which variant they're getting — it just gets harder.

**Bounds simplification:**
- Diagram: never show bounds (they don't add much when lines are visible)
- Stars: always show bounds (big help when it's just dots)
- Photo: bounds on tier 6, no bounds on tier 7 (the capstone)
- Stars-no-bounds dropped as a tier — not a meaningful stepping stone

**Progression logic:** identify it → find it, repeated across three visual modes that strip away scaffolding: lines → dots → photo. Within each step, difficulty ramps smoothly rather than in discrete jumps.

Tier 7 (photo, no bounds, eventually starting far away) is the "I can actually find this in a real sky" test.

## Adaptive Algorithm

### Tier weighting (which tier to quiz for a given constellation)

When a constellation comes up for review, pick the tier using exponential decay from frontier (the lowest unpassed tier). Decay factor ~0.3:

| Distance from frontier | Weight | ~Probability |
|------------------------|--------|-------------|
| 0 (frontier) | 1.0 | 58% |
| 1 below | 0.3 | 17% |
| 2 below | 0.09 | 5% |
| 3 below | 0.027 | 2% |
| 4+ below | <0.01 | <1% |

Mostly pushing forward, some reinforcement of recent tiers, rarely trivial — but easy wins still happen occasionally. And within each tier the continuous knobs (choice→autocomplete, starting distance) are also adapting, so even a "tier below frontier" question isn't necessarily easy.

### Breadth control (when to introduce new constellations)

Replace the current blunt gate (`avgStrength >= 5`) with a **queue depth** model:

- A constellation is **"in progress"** until it reaches tier 3 (all three identify modes passed — diagram, stars, photo). Before that, it needs significant attention.
- Cap in-progress constellations at `5 + floor(total_known / 10)`. Early on you can juggle 5; at 30 known it's 8; at 60 known it's 11.
- Under the cap → introduce 1 new per lesson. At the cap → no new ones until something graduates.

This handles edge cases naturally:
- **Deep master, few constellations**: all graduated, way under cap, new ones flow in freely
- **Wide but shallow**: lots in-progress, capped, forced to consolidate
- **Mixed portfolio**: mastered constellations don't count against you, only half-learned ones consume cap space

New constellations ordered by difficulty level (easiest first within each level).

### Lesson composition and heat

When filling 12 question slots, constellations are sampled by **heat** — how much attention they need right now:

- Recently introduced (low tier): high heat
- Recently practiced with high accuracy: low heat
- Not practiced recently: heat rises over time
- Deep in progression but stale: moderate heat

Hotter constellations get more slots in the lesson. Within each slot, tier is picked by the exponential decay weighting above. One slot reserved for a new constellation if under the queue cap.

### What this replaces

The current system (`generateNextLesson` / `targetSpec` / `reviewSpec` in data.js) uses:
- 16 discrete tier keys with binary pass/fail gating
- A flat `avgStrength >= 5` gate for introducing new constellations
- 60/25/15 split (frontier / highest-passed / random-passed) for review tier selection
- No recency tracking, no heat model, no queue depth concept

## TODO
- Review difficulty groupings
- Plan the routing migration
- Design explore UI consolidation
- Decide what happens to the "course" breadcrumb / lesson structure
- Design the continuous difficulty knobs (how fast does choice→autocomplete ramp? what curve for starting distance?)
- Prototype the heat function (what inputs, what decay rate for recency?)
- Define "passing" a tier — correct count threshold? streak? accuracy %?
