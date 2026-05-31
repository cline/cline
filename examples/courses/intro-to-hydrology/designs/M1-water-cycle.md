# Module 1 Design Note — The Water Cycle in Motion

> Stage-2 per-module plan. Approve / edit before HTML authoring.
> `id: water-cycle` · prereqs: none · est. 30 min · showcase: **Manim film + `timeline`**

---

## Learning goal (one thing)

> Trace a parcel of water through the global hydrologic cycle and **name the six
> fluxes** that move it — evaporation, transpiration, condensation, precipitation,
> infiltration, runoff — and grasp that the cycle is a *closed mass balance*
> (what goes up must come down).

Success = the student can label a blank cycle diagram and state "precip = ET +
runoff + Δstorage" in plain words.

## Why it's the hook (no prior knowledge needed)

This is the front door of the whole course. It must *delight* before it teaches:
read-only, cinematic, zero Python required. It sets the narrative spine every
later module hangs off ("remember the runoff arrow? Modules 3–5 are all about
*that* arrow").

---

## Section layout (8-section contract)

1. **Hero** — brand strip (`Interactive Module · Foundations`), gradient title
   "The Water Cycle **in Motion**", one-line how-to-use.
2. **Workflow strip** — Film · Fluxes · Balance · Scrub · Check · Sources.
3. **§1 The film** — the Manim animation cell (centerpiece, below).
4. **§2 Six fluxes** — `reveal`/scrolly panel: each flux fades in with a one-line
   plain-language definition + its symbol + typical magnitude. SVG, no kernel.
5. **§3 The balance** — a small animated mass-balance: an SVG "bathtub" (storage)
   with precip in, ET + runoff out; a `bindParam` slider on precipitation shows
   storage rising/falling. Pure DOM (`sim` on a `<canvas>`), no kernel.
6. **§4 Scrub the cycle** — `aihydro.timeline` scrubber that drives the cycle
   SVG (or the rendered film's `<video>` playback position) frame-by-frame so the
   student can *stop time* at condensation, at peak runoff, etc.
7. **§5 Checkpoint** — `.aihydro-quiz` (3 questions, below) → posts
   `quizComplete` → marks module done.
8. **Provenance footer** — citations, data/imagery sources, CC-BY-4.0, author.

---

## Centerpiece: the Manim film

A `data-aihydro-render="video"` cell. ~12–18 s, 480p (low-q default = fast).

**Scene beats (`class WaterCycle(Scene)`):**
1. A calm sea (gradient rectangle) + sun. Heat shimmer → **evaporation** arrows
   rising (labelled), a few from a stylised tree → **transpiration**.
2. Vapor rises, cools, dots coalesce into a cloud → **condensation** label.
3. Cloud drifts over a hill silhouette; rain falls → **precipitation**.
4. On the hill: some arrows sink in → **infiltration**; the rest slide downslope
   as a blue line to the sea → **runoff**.
5. Camera pulls back; all six labels glow once; the loop arrow closes.

**Brand:** AI-Hydro dark bg (`#0a0a15`), cyan→blue gradient (`#00A3FF`→`#00FFFF`)
for water, white labels. Reuse the palette from the existing exemplars.

**Graceful degrade (confirmed decision):** if Manim/ffmpeg absent the cell shows
the standard "Manim is not installed" note; §4's `timeline` then drives the
**static SVG cycle** instead of the video — so the module is fully functional
with zero optional deps. (We author the SVG cycle regardless; the film is the
enhancement layer.)

---

## Quiz (3 questions, `.aihydro-quiz`, `data-answer` = correct index)

1. *Which two fluxes return water to the atmosphere?*
   → Evaporation & transpiration ✓ / Runoff & infiltration / Precip & condensation.
   Feedback on wrong: "those move water *down*, not up."
2. *Over a long period for a closed basin, precipitation ≈ ___ ?*
   → ET + runoff + change in storage ✓ / just runoff / just ET.
3. *Condensation happens because rising air ___ ?*
   → cools ✓ / warms / dries out.

Pass (3/3) marks `water-cycle` complete and unlocks M2 + M3.

## Citations (via `aihydro-bridge-citation`, not free text)

- A standard hydrology text for the cycle/mass-balance framing (e.g. a widely
  used intro text — confirm the exact reference with you before embedding).
- A public-domain water-cycle schematic source (USGS Water Science School) for
  the flux inventory.

## Build checklist

- [ ] Unique `data-aihydro-cell-id` on the Manim cell; `data-language="python"`
      + `data-aihydro-render="video"`.
- [ ] All animation respects `prefers-reduced-motion` (timeline/sim/scrolly).
- [ ] `aihydro.timeline` and `aihydro.sim` calls guarded with `whenReady()`.
- [ ] No `plt.show()` / file-I/O / `<code>` wrapper; passes Validate Module.
- [ ] Provenance footer present.

## Open questions for you

1. **Reference text** — which intro hydrology textbook should I cite for the
   mass-balance equation (so the citation is real)? I can default to USGS Water
   Science School + a common open text if you have no preference.
2. **Film length** — 12–18 s feels right for a hook; OK, or do you want a
   slightly longer (~25 s) narrated-by-labels version?
