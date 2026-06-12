# HTML Preview executable cells (`.aihydro-cell`)

Official contract for runnable Python/JavaScript cells inside HTML artifacts.

## DOM markup

```html
<div
  class="aihydro-cell"
  data-aihydro-cell-id="cell-001"
  data-language="python"
  data-execution="kernel"
>
  <pre class="aihydro-source">import math
print(math.sqrt(2))</pre>
  <div class="aihydro-output" aria-live="polite"></div>
</div>
```

- `data-language`: `python` | `javascript`
- `data-execution`: `kernel` (Python via extension) | `inline` (future)
- Optional `data-timeout-seconds` per cell

## JSON metadata (optional)

```html
<script type="application/vnd.aihydro.cell+json">
{"id":"cell-001","language":"python","execution":"kernel","timeoutSeconds":60,"dependsOn":[]}
</script>
```

`dependsOn` is reserved for future graph execution (not implemented yet).

## Panel toolbar

Users run cells from the HTML Preview panel: **Run Cell**, **Run All**, **Restart & Run All**, **Stop**, **Clear**.

## Quiz checkpoints (`.aihydro-quiz`)

`.aihydro-quiz` is the **canonical** quiz block. Each `.aihydro-quiz-question` carries a
`data-answer` (the correct option index); a `.aihydro-quiz-submit` button scores all questions
on click. When every question is correct, the bridge posts `artifact/quizComplete` with
`passed: true` to the host, which marks the current course module complete in `CourseNavigator`.

```html
<div class="aihydro-quiz">
  <div class="aihydro-quiz-question" data-answer="1">
    <p class="q-text">Which filter parameter controls baseflow smoothness?</p>
    <label class="aihydro-quiz-option"><input type="radio" name="q1" value="0"> Time step</label>
    <label class="aihydro-quiz-option"><input type="radio" name="q1" value="1"> Alpha (α)</label>
    <div class="aihydro-quiz-feedback" data-fb="0">Not quite — that's the sampling interval.</div>
  </div>
  <button class="aihydro-quiz-submit" type="button">Check answers</button>
  <span id="quizScore"></span>
</div>
```

> **Deprecated:** the older single-question `.aihydro-question` / `data-aihydro-answer` markup
> (wired by `aihydro.quiz()`) still works and also reports completion, but prefer `.aihydro-quiz`
> for new modules.

## Cell run status

Each `.aihydro-cell` reflects its run state via a `data-aihydro-cell-status`
attribute (`warming` | `running` | `done` | `error`), shown as a colored stripe
plus a status pill in the cell header. The first run of a session shows
**Warming** while the kernel spawns and imports numpy/matplotlib; later runs show
**Running**. The status animation respects `prefers-reduced-motion`.

To keep that first run fast, the kernel pre-imports numpy and matplotlib in the
background (`warm` op) as soon as a session is established — authors don't need to
do anything.

## Video-render cells (Manim)

A cell that renders a cinematic animation instead of a figure is marked with
`data-aihydro-render="video"` (or `data-language="manim"`). Author it like a
normal Python cell whose body defines one or more Manim `Scene` subclasses:

```html
<div class="aihydro-cell" data-aihydro-cell-id="anim-1"
     data-language="python" data-aihydro-render="video">
  <button class="aihydro-run" type="button">Run</button>
  <pre class="aihydro-source">from manim import *

class Hydrograph(Scene):
    def construct(self):
        axes = Axes()
        self.play(Create(axes))</pre>
  <div class="aihydro-output" aria-live="polite"></div>
</div>
```

On run, the kernel renders each `Scene` to a low-quality MP4 and returns it as a
`video/mp4` output; the bridge plays it inline in a `<video controls>` element.
Rendering requires `manim` and `ffmpeg` in the kernel env (`.aihydro/venv`); when
they are absent the cell still succeeds and shows a "Manim is not installed" note
rather than failing. Renders can take several seconds — the cell shows a
**Rendering animation…** message while it works.

## Interactivity primitives (`window.aihydro`)

Pure-DOM author helpers (no kernel dependency); all respect `prefers-reduced-motion`.

- **`aihydro.timeline({ mount, steps, fps, autoplay, loop, onTick, cellId, param })`** —
  play / pause / step / scrub control over `steps` frames. `onTick(index, t)` fires per
  frame (`t` in `[0,1]`); optionally drives a `bindParam` slot via `cellId` + `param`.
  Returns `{ play, pause, toggle, seek, destroy }`.
- **`aihydro.compare(selector)`** — before/after wipe slider over an `.aihydro-compare`
  block with two children (first = before, second = after). Auto-wired on load for
  `.aihydro-compare`; call explicitly for a custom selector.
- **`aihydro.sim({ canvas, step, params, autoplay })`** — `requestAnimationFrame` loop over
  a `<canvas data-aihydro-sim>`. `step(ctx, elapsedSeconds, params)` renders each frame;
  `params` may be a value or a function (pull live `bindParam` values). Returns
  `{ play, stop, toggle }`.
- **`aihydro.plot({ mount, data, layout, config })`** — branded Plotly wrapper; lazy-loads
  Plotly from the CSP-whitelisted CDN and applies the AI-Hydro dark palette.
- **`aihydro.scene3d({ canvas, dem, setup, onFrame })`** — three.js helper for 3D /
  manipulable scenes (terrain flythroughs, DEM/TWI surfaces, watershed views) over a
  `<canvas data-aihydro-scene3d>`. Lazy-loads three.js + OrbitControls from the
  CSP-whitelisted jsdelivr CDN and hands `setup(ctx)` a branded `{ THREE, scene, camera,
  renderer, controls, canvas, dem }`; `onFrame(ctx)` runs per animation frame (skipped under
  reduced-motion, which renders a single static frame). Returns a promise resolving to that
  `ctx` (with a `stop()` method).

## Control-state persistence

Any input bound with `aihydro.bindParam(...)` has its value persisted per module
so a learner who adjusts sliders, closes the panel, and reopens it lands on the
same configuration instead of the authored defaults. State is keyed by
`"<cellId>::<paramName>"` and stored on disk at
`~/.aihydro/module_state/<moduleKey>.json` (keyed by the module's file path).

The bridge requests saved state on load and pushes debounced changes back to the
host; no author action is required. The HTML Preview kebab menu exposes
**Reset controls to defaults** (clears persisted values and restores authored
defaults) and **Copy control state** (copies the current values as JSON to the
clipboard for sharing).

## Rendering saved web pages ("Save Page As → Complete")

When you open a file saved with *File → Save Page As → Web Page, Complete* (or the
equivalent in any browser), the panel injects a `<base href="…">` tag pointing at the
file's parent directory so that the sibling `_files/` folder (CSS, images, JS) resolves
correctly. No author action is required.

**Live web-app snapshots (e.g. Google My Maps, Mapbox editors) cannot render offline.**
The panel detects these files by looking for the `<!-- saved from url=… -->` marker
combined with known live-app hostnames. When detected, a dismissible banner appears
above the iframe:

> *This looks like a saved copy of a live web page (Google My Maps). The interactive
> map needs the original site and can't render offline.*

The **Open in browser** button inside the banner opens the file in the system default
browser. The iframe still renders beneath the banner — local static assets (if any)
will display after the base-href fix.

## Python environment

Create `.aihydro/venv` with the agent, then refresh environments in the toolbar. Each artifact gets its own persistent kernel session (variables do not leak across artifacts unless `aihydro.htmlPreview.shareKernelAcrossArtifacts` is enabled).
