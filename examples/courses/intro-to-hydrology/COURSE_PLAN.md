# Introduction to Hydrology — Flagship Course Plan

> **Status:** Structure proposal for review (Stage 1 of 2).
> Stage 2 = per-module deep design, one module at a time, only after this structure is approved.

---

## 1. Why this course exists

The current `intro-to-hydrology` course (3 modules, ~2 h) was a proof that the
course system *works*. This rebuild makes it the **flagship reference course** —
the thing we point a newcomer at to answer "what can the AI-Hydro HTML preview
actually do as a learning hub?"

Two goals, held simultaneously:

1. **Teach real intro hydrology** — a coherent curriculum a first-year MSc /
   senior-undergrad water-resources student could actually learn from, following
   the natural narrative spine of the **hydrologic cycle → watershed → the
   hydrograph → real data → distributed terrain → synthesis**.
2. **Be a gallery of the medium** — each module is deliberately built around a
   *different* showcase primitive (Manim animation, `scene3d` 3-D terrain,
   `sim` draggable interaction, `compare` wipe, live kernel cells, `plot`,
   `timeline`), so by the end the student has *seen every capability* of the
   preview hub at least once.

This is the course referenced by the community Modules repo
(`github.com/AI-Hydro/Modules`) as the canonical example of a **course** (the
repo today has sample *modules* but no sample *course*).

---

## 2. Audience & assumptions

| Dimension | Decision |
|---|---|
| **Audience** | Advanced undergrad / first-year MSc in hydrology, water resources, environmental / civil engineering, earth science. |
| **Assumed prior knowledge** | High-school physics & algebra; comfort reading a graph. **No** Python required to *follow* (cells run with one click and are pre-written); light Python helps for the hands-on stretch goals. |
| **Tone** | Curious, visual, plain-language first; rigor introduced gently. The 3Blue1Brown / explorable-explanations register. |
| **Total time budget** | ~4.5–5 h end-to-end (7 modules). Each module self-contained in one sitting. |
| **Hands-on vs read-only** | Mixed. M1 is animated/read-only (a hook). M3–M7 each have at least one live Python kernel cell. |

---

## 3. Proposed module structure (the ask — please approve / edit)

Curriculum order is top-to-bottom. Prereqs form a **DAG, not a chain**, so a
returning student can free-roam.

| # | Module title | Prereqs | Est. min | One-sentence learning goal | Showcase primitive |
|---|---|---|---|---|---|
| 1 | **The Water Cycle in Motion** | — | 30 | Trace a water molecule through evaporation → precipitation → runoff → the sea, and name the fluxes. | **Manim** animated water-cycle film + `timeline` scrubber |
| 2 | **The Watershed: Where Rain Becomes Runoff** | 1 | 40 | Define a catchment, see how topography routes water to an outlet. | **`scene3d`** draggable 3-D terrain + `sim` "drag-a-raincloud" |
| 3 | **Reading a Hydrograph** | 1 | 30 | Identify baseflow, rising limb, peak, recession on a real time series. | `bindParam` sliders + branded `plot` + `aihydro-quiz`; live kernel cell |
| 4 | **Splitting the Flow: Baseflow Separation** | 3 | 40 | Run the Lyne–Hollick filter and interpret the Baseflow Index (BFI). | **`compare`** wipe + α slider that **`rewriteCell`s** the live Python (slider → code → re-run) |
| 5 | **Catching the Flow: Real Streamflow Data** | 3 | 45 | Fetch live USGS data for a CONUS gauge, plot the regime, spot a flood. | **Leaflet map** (`data-aihydro-map`) + live `fetch_streamflow_data` kernel cell + `plot` |
| 6 | **The Shape of the Land: DEM → TWI** | 2 | 55 | Compute the Topographic Wetness Index — your first distributed-hydrology product. | **`scene3d`** DEM surface + `compare` DEM↔TWI; `compute_twi` kernel cell |
| 7 | **Capstone: Tell a Basin's Water Story** | 4, 5, 6 | 60 | Pick a basin, fetch + characterize it, and narrate its hydrology end-to-end. | Synthesis: map + plots + signatures kernel cells; mini "lab report" |

**Totals:** 7 modules · ~5 h · every showcase primitive exercised at least once.

### 3a. Showcase-coverage matrix (the "gallery" proof)

The audit that makes the gallery claim true — every `window.aihydro` primitive and
every preview capability appears in ≥1 module. `●` = primary showcase, `○` = used.

| Capability | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|
| Manim video cell | ● |   |   |   |   |   |   |
| `timeline` | ● |   |   |   |   |   | ○ |
| `scene3d` (three.js) |   | ● |   |   |   | ● |   |
| `sim` (canvas raf) | ○ | ● |   |   |   |   |   |
| `compare` (wipe) |   |   |   | ● |   | ● |   |
| `plot` (Plotly) |   |   | ● | ○ | ● | ○ | ● |
| `bindParam` (+ persistence) | ○ | ● | ● | ● | ● |   | ● |
| `rewriteCell` |   |   |   | ● |   |   | ○ |
| `reveal` / `scrolly` | ● | ○ | ● |   |   | ○ |   |
| `quiz` → progress | ● | ● | ● | ● | ● | ● | ● |
| Leaflet map (`data-aihydro-map`) |   |   |   |   | ● |   | ● |
| Live kernel cell |   |   | ● | ● | ● | ● | ● |
| `export_session` artifact |   |   |   |   |   |   | ● |

No empty rows → no primitive is left undemonstrated. `rewriteCell` was the only
gap in the first draft; it now anchors M4 (the α-slider rewrites the visible
Python and re-runs — the single best "code is alive" moment in the course).

### 3b. The narrative thread (continuity device)

Two recurring threads stop the course feeling like 7 unrelated demos:

1. **"Follow the arrow."** M1 names the six fluxes as arrows. Every later module
   explicitly picks one up: M2 = the *runoff* arrow over terrain; M3–M4 = reading
   and splitting that runoff in time; M5 = measuring it for real; M6 = the
   *infiltration* arrow and where water *wants* to go. The capstone re-draws the
   full cycle annotated with the student's own basin numbers.
2. **One signature basin, threaded through.** M5 introduces the curated
   recommended-basin dropdown; the *same* basin the student picks in M5 is
   pre-selected in M7, so the capstone narrates a basin they already met. (Custom
   "Other basin" option in both, per the confirmed decision.)

### 3c. Cognitive-load ramp

Deliberate read-only → guided → open gradient:

- **M1** read-only/cinematic (build delight, zero friction).
- **M2** manipulate but no code (drag, no Python).
- **M3–M6** one-click pre-written kernel cells (code visible, runnable, not
  authored by the student).
- **M7** open-ended: the student changes the basin and *interprets* — the only
  module asking for judgement, not just clicks.

### Prerequisite DAG

```
            ┌─────────────────────────────┐
            │  1. Water Cycle in Motion    │
            └───────┬──────────────┬───────┘
                    │              │
          ┌─────────▼──────┐   ┌───▼────────────────┐
          │ 2. The Watershed│   │ 3. Reading a       │
          └────────┬────────┘   │    Hydrograph      │
                   │            └───┬────────────┬───┘
                   │                │            │
                   │        ┌───────▼──────┐ ┌───▼────────────┐
                   │        │ 4. Baseflow   │ │ 5. Real        │
                   │        │   Separation  │ │   Streamflow   │
                   │        └───────┬───────┘ └───┬────────────┘
          ┌────────▼─────────┐      │             │
          │ 6. DEM → TWI      │      │             │
          └────────┬──────────┘     │             │
                   │                │             │
                   └────────┬───────┴─────────────┘
                            │
                    ┌───────▼───────────────────────┐
                    │ 7. Capstone: Basin Water Story │
                    └────────────────────────────────┘
```

No cycles. Prereqs are meaningful (each child *uses* what the parent taught), and
M2 vs M3 are independent siblings off M1 — a student can branch toward "terrain"
(2→6) or "time series" (3→4/5) and converge at the capstone.

### Learning-outcomes map (what the student can DO after each module)

| After M | The student can… |
|---|---|
| 1 | Name the six fluxes and state the water balance P ≈ ET + R + ΔS. |
| 2 | Delineate a catchment by eye and explain why topography sets the divide. |
| 3 | Point to baseflow / rising limb / peak / recession on any hydrograph. |
| 4 | Run a digital baseflow filter and read a BFI value. |
| 5 | Pull real USGS data for a gauge and identify a flood event in the record. |
| 6 | Produce a TWI raster from a DEM and explain where the landscape stays wet. |
| 7 | Characterize an unfamiliar basin end-to-end and export a reproducible session. |

These map 1:1 onto the quiz checkpoints, so "course complete" = "can do all seven."

---

## 4. Relationship to the existing 3 modules

The current course already has strong material we **upgrade and absorb**, not throw away:

| Existing | Becomes | Change |
|---|---|---|
| `01-reading-a-hydrograph` | **M3** | Keep; already near flagship quality. Light polish, wire quiz→progress. |
| `02-exploring-conus-hydrology` | **M5** | Keep map + data cell; add `plot` polish + flood-spotting interaction. |
| `03-dem-to-twi` | **M6** | Keep `compute_twi` cell; add `scene3d` 3-D surface + DEM↔TWI `compare`. |

**New builds:** M1 (Manim water cycle), M2 (scene3d watershed + raincloud sim),
M4 (baseflow `compare`), M7 (capstone). That's 4 new + 3 upgrades.

---

## 5. Consistency contract (applies to every module)

Per the `interactive-module-builder` 8-section contract + `course-authoring`:

- Hero with AI-Hydro brand strip + gradient title + one-line "how to use" instruction.
- Clickable **workflow strip** to jump between sections (as in M3 today).
- Sections marked `data-aihydro-editable="prose"` so edit-mode works.
- At least one showcase primitive (the column above) + a `.aihydro-quiz` checkpoint
  whose pass posts `quizComplete` → marks the module done in `CourseNavigator`.
- All animation respects `prefers-reduced-motion`.
- **Provenance footer**: real citations via the `aihydro-bridge-citation` system,
  data sources, license (CC-BY-4.0), author.
- Kernel cells: unique `data-aihydro-cell-id`, `data-language`, no `plt.show()`,
  no file-I/O, no `<code>` wrapper — passes `AI-Hydro: Validate Module`.

### 5a. Accessibility & UX principles (course-wide)

- **Reduced-motion is a first-class path, not a fallback.** Every animated section
  must still teach its point as a static frame (the Manim film → a captioned still;
  `timeline`/`sim` → final-state render). Test with reduced-motion on.
- **State persists.** Slider values survive panel close/reopen (`bindParam`
  persistence is automatic) — author defaults that are *interesting*, since a
  returning student lands on their last configuration.
- **Toolbar affordances work:** "Reset controls to defaults" and "Copy control
  state" must behave sanely for every module's controls.
- **No dead air.** Long kernel cells (M5 fetch, M6 TWI) show the warming/running
  pill; author a one-line "this fetches live data, ~10 s" note above slow cells.
- **Keyboard + contrast:** quiz options reachable by keyboard; gradient text keeps
  AA contrast on the dark background.

### 5b. Off-ramp — "where to go next" (last section of M7)

The course should *open doors*, not dead-end. M7 closes with a curated next-steps
card linking to: the **module marketplace** (community modules), the
**`baseflow-separation` / `flood-frequency-analysis` skills** for deeper dives, and
an invite to **contribute a module** to the Modules repo (this course is the
reference example). Reinforces the hub-as-ecosystem story.

---

## 6. Build sequence (Stage 2, after approval)

We design + build **one module at a time, in curriculum order**, so later modules
can reference earlier ones naturally:

1. **Scaffold** the full course with `course_scaffold` (writes `course.json` + 7
   skeletons; never hand-write `course.json`). Course id stays `intro-hydro-2026`.
2. For each module: I bring a **per-module design note** (concept beats, the exact
   showcase interaction, the kernel cell + expected output, quiz questions,
   citations) → you approve → I author the HTML → we test in the preview.
3. Validate each with `AI-Hydro: Validate Module` before moving on.
4. Final pass: walk the whole course (progress ring, prereq gating), tune
   `estimatedMinutes`, then publish to the Modules repo as the reference course.

---

## 7. Confirmed decisions (reviewed 2026-05-30)

1. **Scope:** ✅ All **7 modules / ~5 h** — full showcase; every preview primitive
   gets its own module.
2. **Capstone basin:** ✅ **Hybrid** — present a curated dropdown of 3–5
   *recommended* CAMELS-US gauges (each chosen for a clean teaching story: a flood
   basin, a snowmelt basin, a flashy arid basin, a baseflow-dominated basin), via
   a `bindParam` select, **plus** an "Other basin (enter USGS ID)" option so a
   student can run their own. M5 introduces the recommended set; M7 lets them pick.
3. **M1 hook:** ✅ **Manim, degrade gracefully** — cinematic water-cycle film as
   the opener; falls back to a "Manim not installed" note + a `timeline`/static
   version so it never breaks.

## 8. Next step

Stage 2 begins: scaffold the 7-module skeleton with `course_scaffold` (course id
`intro-hydro-2026`), then bring the **Module 1 design note** for approval before
authoring any HTML.
