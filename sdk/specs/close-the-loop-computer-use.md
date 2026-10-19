# Close the loop: computer use for cloud sessions

Status: draft / vision. Companion to the two scripted demos in this change
(desktop app `/demo/close-the-loop`, VS Code Storybook `Views/Chat > Close The
Loop`). Nothing described under "Proposed" exists yet.

## 1. The idea

Today a cloud session ends when the agent says it is done: tests pass, a PR is
open, and the user reads a summary. The agent never *looks* at what it built.

"Close the loop" means the sandbox agent finishes a task the way a careful
engineer would: build it, launch it, use it, look at it, fix what is wrong, and
hand the reviewer the evidence. Concretely:

1. The agent launches the app it changed inside the sandbox (dev server, CLI,
   TUI, or a desktop window on a virtual display).
2. It drives the app like a person: click, type, scroll, resize, press keys.
3. After each meaningful step it takes a screenshot and reads it back, so the
   model sees the real rendered result and can self-correct.
4. The screenshots that matter are shipped to the client and shown next to the
   completion summary as a slideshow the user can flip through.

The payoff is twofold. For quality, the model catches a whole class of bugs
("it compiles but the button is behind the header") that tests do not. For
trust, the user can review a PR from the transcript without pulling the branch.

## 2. What exists today

| Piece | State | Where |
| --- | --- | --- |
| Cloud sessions (sandbox provisioning, event stream, GitHub creds, `gh pr create`) | Shipped | `packages/core/src/cloud/` (`controller.ts`, `state.ts`), system prompt in `buildCloudSessionSystemPrompt` |
| Agent can *see* images | Shipped | `read_files` returns an `image` content block for png/jpg/gif/webp (`packages/core/src/extensions/tools/executors/file-read.ts`) when the model supports image input |
| Agent can run arbitrary commands | Shipped | `run_commands` |
| "Verify by execution" contract | Shipped | `submit_and_exit` requires `summary` + `verified` and tells the model to run the result and read the output back (`schemas.ts`) |
| Media on the wire | Partial | Hub protocol already names `assistant.media` and `artifact.created` (`packages/shared/src/hub.ts`); `GeneratedMedia.source` supports `base64 \| url \| artifact` (`packages/shared/src/llms/media.ts`) |
| Images in the cloud transcript reducer | Gap | `reduceCloudEvent` stringifies `image` blocks to `"[image]"` (`packages/core/src/cloud/state.ts`) |
| Artifact storage / signed URLs for sandbox files | Missing | No backend path from a file in the sandbox to a URL the client can render |
| Client rendering of verification screenshots | Demo only | `WorkVerificationCarousel` in the desktop app and VS Code webview (this change), fed by canned data |
| Sandbox GUI tooling (virtual display, screenshot, input injection) | Missing | Sandbox image has no X server or capture tools today |

The gap is smaller than it looks: with a virtual display and two CLI tools in
the sandbox image, the agent can already close the loop for itself using
`run_commands` + `read_files`. Everything else is about getting the frames to
the user nicely.

## 3. User experience

### 3.1 In the transcript

A completed cloud session gains one block under the final summary:

- Header: "Verified in sandbox", the target (`localhost:5173`, `habitat --help`,
  …), frame count, wall time, and an "All checks passed" / "N checks failed"
  badge.
- Stage: the current screenshot, letterboxed on a blurred backdrop so a
  terminal, a phone-width window, and a 1280×800 browser all sit well in the
  same 16:10 frame.
- Overlay: per-frame progress segments (stories style) along the top; at the
  bottom the action chip (`launch`, `click`, `resize`, …), `n / N`, a pass/fail
  dot, a one-line title, and a short note of what the agent observed.
- Controls on hover: previous/next, play/pause, expand to lightbox. Thumbnails
  below. Arrow keys and space when the stage is focused.
- Behaviour: autoplays through the frames once the summary lands (4 s per
  frame), pauses while hovered, stops when the user navigates manually, loops
  otherwise. Clicking a frame opens the lightbox.

The same component serves both clients. The two implementations in this change
share a data shape and markup; they should collapse into one `@cline/ui`
component once the VS Code webview adopts the `@cline/ui` theme CSS (it only
imports `GeneratedMediaContent` today).

### 3.2 While the agent is working

Computer-use steps show up as ordinary tool rows (`computer_use · Clicked "Dark
mode" · screenshot 2`). The live frames are *not* streamed into the transcript
by default; they would dominate a run with dozens of steps. The final
`verification` block is curated by the agent (see 4.3). A live "watch the
sandbox" view (Xpra/noVNC) is a later phase.

### 3.3 Data shape (client-side, shared by both apps)

```ts
type WorkVerificationScreenshot = {
	id: string
	src: string            // host-resolved URL (artifact URL, blob URL, data URL)
	title: string          // "Dashboard renders the new weekly heatmap"
	note?: string          // what the agent did / observed
	action?: "launch" | "screenshot" | "click" | "type" | "scroll" | "key" | "resize"
	outcome?: "pass" | "fail" | "info"
}

type WorkVerification = {
	summary: string        // "Verified in sandbox"
	target?: string        // "localhost:5173"
	durationMs?: number
	screenshots: WorkVerificationScreenshot[]
}
```

Desktop: `ChatMessage.meta.verification` (zod schema in
`apps/examples/desktop-app/webview/lib/chat-schema.ts`). VS Code:
`ClineMessage.verification` on the `completion_result` say
(`apps/vscode/src/shared/ExtensionMessage.ts`); the proto conversion in
`src/shared/proto-conversions/cline-message.ts` does not carry it yet.

## 4. Architecture (proposed)

### 4.1 Sandbox: virtual display and capture tooling

Add to the sandbox image:

| Need | Tool | Notes |
| --- | --- | --- |
| Display | `Xvfb :1 -screen 0 1280x800x24` (+ a tiny WM such as `openbox` so windows get focus/geometry) | Already how this repo's cloud VM runs its GUI tests. Wayland (`sway` + `grim`/`wtype`) is possible but X11 has the broadest tooling. |
| Screenshot (window) | ImageMagick `import -window <id> out.png` | Window-only capture, no desktop chrome. `xwd \| convert` as fallback. |
| Screenshot (full) | `import -window root`, `scrot`, `maim` | Full-display capture for multi-window flows. |
| Window lookup | `xdotool search --name/--class`, `xwininfo`, `wmctrl -l` | Find the app window, read geometry for coordinate math. |
| Input | `xdotool mousemove X Y click 1`, `type`, `key ctrl+s`, `windowsize`, `windowactivate` | Works for any X11 app: browsers, Electron, Tauri, Qt, GTK, terminals. |
| Browser | Chrome/Chromium with `--no-sandbox --disable-gpu --window-size=…`, optionally `--remote-debugging-port` | CDP/Playwright give DOM-level selectors, console logs, and pixel-exact `Page.captureScreenshot`; use it when the target is a web app, fall back to X11 otherwise. |
| Terminal / TUI | `xfce4-terminal`/`xterm` on the display, or `tuistory` for headless PTY snapshots and PNG renders | `tuistory` already exists in this repo for the CLI TUI. |
| Video (optional) | `ffmpeg -f x11grab -i :1 …` | For a later "replay the run" feature. Not needed for stills. |

Everything in that table was exercised in the Cursor cloud VM while building the
demo: Chrome launched on `DISPLAY=:1`, `xdotool` clicked the dark-mode toggle
and a list row, `xdotool windowsize` produced the 390 px frame, and `import
-window` captured each window. The five demo screenshots are those captures.

### 4.2 Agent tooling, in three steps

**Step 0, no new tools.** With the image above and a system-prompt recipe
(4.5), the agent can already do this with `run_commands` and `read_files`:

```
run_commands: bun run dev --port 5173 &
run_commands: google-chrome --no-sandbox --window-size=1280,800 http://localhost:5173 &
run_commands: xdotool search --sync --onlyvisible --class chrome | head -1   # -> WID
run_commands: import -window $WID .cline/verification/01-dashboard.png
read_files:   .cline/verification/01-dashboard.png                            # model sees it
run_commands: xdotool mousemove 1166 153 click 1 && import -window $WID .cline/verification/02-dark.png
```

This is enough to prove value with a handful of internal tasks before writing a
tool.

**Step 1, a `computer_use` tool.** Shape it after the Anthropic computer-use
schema so models that were trained on it need no coaching:

```ts
{
	name: "computer_use",
	input: {
		action: "launch" | "screenshot" | "left_click" | "double_click" | "right_click"
		      | "mouse_move" | "drag" | "type" | "key" | "scroll" | "resize" | "wait",
		url?: string,            // launch (web)
		command?: string,        // launch (native/CLI)
		coordinate?: [x, y],     // in screenshot pixels; the tool rescales to the display
		text?: string,           // type / key
		direction?: "up" | "down", amount?: number,   // scroll
		width?: number, height?: number,              // resize / launch viewport
		label?: string           // human-readable intent, shown in the transcript row
	}
}
```

Result: `[{ type: "text", text: "<action summary, window title, cursor pos>" },
{ type: "image", mediaType: "image/png", data: … }]`. Every action returns a
fresh screenshot so the model always reasons about the current state.
Implementation is a thin executor over the 4.1 tools; put it next to the other
default executors in `packages/core/src/extensions/tools/executors/` and gate
it behind a runtime capability so it is only offered where a display exists.

Details that matter:

- Downscale screenshots before they go to the model (long edge ≤ 1280, PNG or
  WebP) and keep the scale factor to map clicks back. A 1280×800 PNG is roughly
  1.5k input tokens on current Claude models; cap frames per run.
- Keep the window id sticky per launch so the agent does not re-search.
- Treat `launch` as idempotent: re-launching the same URL focuses the window.
- Time-box waits; never block on a window that never appears.

**Step 2, app-aware adapters.** Behind the same tool: a browser adapter (CDP
selectors, console errors, network failures as text), a terminal adapter
(`tuistory` snapshot text + PNG), and a native adapter (AT-SPI accessibility
tree for Tauri/GTK/Qt). Each adapter can return an accessibility/text layer
alongside the pixels, which both cuts tokens and improves click accuracy.

### 4.3 Curating evidence

Not every frame is worth showing. The agent decides what the user sees:

- Extend `submit_and_exit` with an optional `evidence` array:
  `{ path, title, note?, action?, outcome? }[]`, path relative to the workspace
  (convention: `.cline/verification/`). The existing `verified` boolean stays;
  `evidence` is how the model shows its work.
- The runtime validates paths, reads the files, uploads them (4.4), and emits
  the `verification` payload on the completion message. Frames not listed are
  discarded with the sandbox.
- Cap at ~8 frames; the UI handles more but the point is a reviewable summary.

### 4.4 Transport: sandbox to client

The missing backend piece. Proposed flow:

1. Sandbox runtime uploads each evidence file to session artifact storage and
   receives an `artifactId`.
2. Hub emits `artifact.created` with `{ artifactId, kind: "screenshot",
   mediaType, sizeBytes, width, height, title, note, action, outcome }` and,
   on completion, the summary message carries `verification` referencing those
   ids. Alternatively reuse `assistant.media` with
   `source: { type: "artifact", artifactId }` and put the caption fields in a
   sibling `verification` block; either way the ids are the contract.
3. Client resolves `artifactId` to a short-lived signed URL via the cloud API
   (`CloudSessionApi`), the same place that already fronts repos and models.
   `GeneratedMediaContent` deliberately refuses `url`/`artifact` sources
   without a trusted resolver; this resolver is that trust boundary.
4. `reduceCloudEvent` stops flattening `image` blocks to `"[image]"` for
   screenshot results and keeps `media`/`verification` on the message.
5. Snapshot reconciliation (`snapshots.ts`) must include artifacts so a client
   that attaches after the run still gets the frames.

Limits: ≤ 2 MB per frame after encoding, ≤ 8 frames per completion, artifacts
retained with the session transcript and deleted with it.

### 4.5 System prompt additions (cloud sessions)

Append to `buildCloudSessionSystemPrompt` when the sandbox advertises a display:

> After your changes build and tests pass, verify the result the way a user
> would experience it. If the project has a UI, start it, open it on the
> virtual display, and exercise the feature you changed: click through it,
> try the states the task mentions, and resize to a narrow width if layout
> matters. If it is a CLI or TUI, run it and look at the output. Take a
> screenshot after each meaningful step and look at it before continuing. If
> something is wrong, fix it and verify again. When you submit, include the
> screenshots that best prove the work in `evidence`, each with a one-line
> title and what it demonstrates. Do not include screenshots that show
> secrets, tokens, or personal data.

Keep it short; the `submit_and_exit` description already carries the
"verify by execution, not assumption" contract.

### 4.6 Client work

- Desktop: `WorkVerificationCarousel` (this change) rendered from
  `meta.verification`; wire `use-chat-session` to populate it from the hub
  payload; replace the dev-only demo entry in Settings > About once real data
  flows.
- VS Code: `WorkVerificationCarousel` (this change) rendered inside
  `CompletionOutputRow`; add `verification` to the `ClineMessage` proto and the
  message translator so `submit_and_exit` evidence reaches the webview.
- Shared: move the component into `@cline/ui` once both hosts load its theme
  CSS; add a `computer_use` case to `buildToolSummary` so transcript rows read
  `Clicked "Dark mode"` rather than a humanized tool name.
- Cloud web app: same component, same payload.

## 5. Safety, privacy, cost

- Screenshots can contain secrets (env panels, tokens in terminals). The
  prompt forbids it, the sandbox egress proxy already injects GitHub
  credentials so they never appear in the shell, and evidence is user-visible
  only inside the session. Add a simple redaction pass (regex over OCR'd text
  is overkill for v1; start with "no screenshots of `.env` or auth pages").
- Frames are session artifacts: same retention, access control, and deletion
  as the transcript. No cross-session reuse.
- Models without image input: `read_files` already throws "Current model does
  not support image input"; `computer_use` should be withheld from the tool
  list for those models and the prompt addition skipped.
- Token cost: budget frames per run (default 20 for the loop, 8 for evidence),
  downscale aggressively, prefer text layers from adapters when available.
- Input injection only ever targets the sandbox display. There is no path to
  the user's machine.

## 6. Milestones

- M0 (this change): clickable vision demos in both clients, shared data shape,
  this spec.
- M1: sandbox image with Xvfb + WM + Chrome + xdotool + ImageMagick; prompt
  recipe (4.5) behind a flag; run 10 internal UI tasks with Step 0 tooling and
  compare PR quality with and without the loop.
- M2: artifact upload + signed-URL resolver + `verification` on the completion
  message; desktop and VS Code render real data; remove the demo entry point.
- M3: `computer_use` tool with screenshot-per-action, coordinate scaling,
  frame budget; `buildToolSummary` support; tool-row icons.
- M4: adapters (CDP, tuistory, AT-SPI), optional live sandbox view, optional
  video capture.

## 7. Open questions

- Should evidence frames be attached to the PR body as well (GitHub-hosted
  images via `gh`)? Cheap to do once the files exist; reviewers who never open
  Cline would benefit.
- One `verification` block per completion, or per `submit_and_exit` in a
  multi-turn session? Per completion keeps the transcript readable; later
  turns replace the block.
- Where does the frame budget live: per model, per org, or per task? Start
  with a global default and a per-task override in the system prompt.
- Local sessions: the same tool works on a developer's own display, but input
  injection there is a very different safety conversation. Out of scope.

## Appendix: commands used to produce the demo frames

Run on the cloud VM's `DISPLAY=:1` (1920×1200 Xvfb with a panel and WM):

```sh
python3 -m http.server 5173 &                                   # the fake "habitat" app
google-chrome --no-sandbox --no-first-run --disable-gpu \
  --user-data-dir=/tmp/chrome --window-size=1280,800 --window-position=40,40 \
  http://localhost:5173 &
WID=$(xdotool search --sync --onlyvisible --class google-chrome | head -1)
import -window "$WID" 01-light.png                              # frame 1
xdotool mousemove 1166 153 click 1 && sleep 0.8 && import -window "$WID" 02-dark.png
xdotool mousemove 901 682 click 1  && sleep 0.5 && import -window "$WID" 03-journal.png
xdotool windowsize "$WID" 430 860  && sleep 1.2 && import -window "$WID" 04-mobile.png
xfce4-terminal --geometry=104x26 --command=./run-tests.sh &     # bun test, git push, gh pr create
TID=$(xdotool search --sync --onlyvisible --name "cline@sandbox" | head -1)
import -window "$TID" 05-terminal.png
```

Chrome needs `--simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT'` on a
stale image to suppress the update nag, and a window must be activated before
capture on compositor-less displays or `import` can return a stale frame.
