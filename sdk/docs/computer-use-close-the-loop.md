# Computer use: closing the loop in cloud sessions

Cloud sessions already let an agent work on a GitHub repository in a sandbox, stream its tool calls to the client, and open a pull request. The missing step is the one a human engineer always takes before saying "done": run the thing and look at it.

Computer use (or "closing the loop") gives the sandboxed agent a virtual display, a way to take screenshots, and a way to click, type, and scroll. After building a feature, the agent launches the app, uses it the way a user would, looks at the result (screenshots go back to the model as image input), fixes what it finds, and picks the best frames as visual proof. Clients show that proof as a "Verified in sandbox" slideshow.

Approach: no new agent tool. The sandbox image gets standard Linux tools (Xvfb, xdotool, ImageMagick, Chrome), and a system-prompt section tells the agent they're available, with light guidance for getting good results. The agent decides how to use them. It drives the app with `run_commands` and looks at screenshots with `read_files`, which already returns PNG/WebP/JPEG/GIF files as image content to models with image input (`sdk/packages/core/src/extensions/tools/executors/file-read.ts`).

## Why

- Tests passing is not the same as the feature working. Layout bugs, dead buttons, broken focus handling, unreadable dark mode, and overflowing mobile layouts all pass unit tests.
- Today you have to check out the branch and run the app to see a UI change. Captioned screenshots answer "what does it look like" in seconds and make cloud sessions much easier to trust.
- Agents that can observe their output self-correct. A screenshot of a blank page after `bun run dev` is a much stronger signal than an exit code.

## Goals

- The agent can launch and drive GUI apps in the sandbox: web apps in a browser, Electron or Tauri desktop apps, and terminal UIs in a terminal emulator.
- The agent verifies its own work before completing and fixes problems it finds.
- Clients (cloud web app, desktop app, VS Code) show the proof as a screenshot slideshow.

## Non-goals

- A new agent tool. Everything runs through `run_commands`, `read_files`, and the prompt.
- Live remote-desktop streaming to the client, or letting the user take over the sandbox display.
- Computer use on the user's own machine (local sessions).
- Windows and macOS sandboxes.

## Decisions

- **When to verify:** the agent decides, case by case. Changes with something to see or interact with (a navbar style, a new dialog, a form flow) are worth verifying. Changes with nothing to look at (running a git command, a config tweak) aren't.
- **Viewport:** the agent picks what fits the check. The prompt suggests 1280×800 as a default, and 390×844 for phone layouts.
- **Tool usage:** the agent knows these tools and their flags, so it gets flexibility rather than a wrapper script. The prompt gives light guidance and an example of what worked in the prototype.

## User experience

While the agent works, each computer-use step appears as a command row (for example `xdotool mousemove 640 228 click 1`), and the screenshots it reads appear as images on its file-read rows, so you can follow along.

When the run completes, a "Verified in sandbox" slideshow appears with the answer (above the answer text in the desktop app, inside the completed card in VS Code):

- One large stage plus a filmstrip of thumbnails. It autoplays, and each thumbnail carries a story-style progress bar that fills until the next slide.
- Each frame has a caption stating what it proves ("Ctrl+K opens the command palette"), the input that produced it ("Pressed `Ctrl+K`"), and a pass or fail mark. Clicks can show a pointer marker at the click location.
- Playback pauses on hover and on keyboard focus. Arrow keys step, Space toggles, and the play button stays visible. Reduced-motion users get a static slideshow.
- Frames expand into the host's lightbox.
- Narrow hosts (the VS Code sidebar) use a compact variant with smaller thumbnails and title-only captions.

A frame marked as failed turns the header summary red ("1 failed"), so the slideshow can also report problems the agent could not fix.

## How it works

1. The agent builds the feature and starts the app, which renders to a virtual display (`DISPLAY=:99`).
2. It drives the app with xdotool (keys, typing, clicks, scrolling, resizing) and takes screenshots with ImageMagick.
3. It reads the screenshots with `read_files`, fixes problems, and checks again.
4. It writes `/tmp/cu-shots/evidence.json` naming the frames that prove the feature works.
5. On completion, those frames are uploaded and attached to the completion, and clients render them as the slideshow.

---

## Linux tools primer

**Xvfb** is a virtual X11 display: an in-memory screen that GUI apps render to as if a monitor were attached, so a sandbox with no screen can still run Chrome, Electron, or Tauri apps and screenshot them. Start it, point `DISPLAY` at it, and anything you launch draws there:

```bash
Xvfb :99 -screen 0 1920x1200x24 -nolisten tcp &   # virtual screen #99
export DISPLAY=:99                                # apps launched from here render to it
google-chrome --app=http://localhost:5173 &       # the app under test
xdotool key ctrl+k                                # keyboard input goes to that display
xdotool mousemove 640 228 click 1                 # so do mouse clicks, at pixel coordinates
import -window root shot.png                      # ImageMagick screenshot of the display
```

- **xdotool** sends input: `key` and `type` for the keyboard; `mousemove` and `click` for the mouse (button 1 is left, 4 and 5 scroll); `search`, `windowfocus`, and `windowsize` for windows.
- **ImageMagick `import`** takes screenshots (`-window root` for the whole display, `-window $WID` for one window). It's unrelated to a code `import`. `scrot`, `maim`, and `xwd` do the same job.
- **wmctrl, xwininfo, xdpyinfo** list, move, and resize windows, and report window geometry and display resolution.
- **fluxbox** (or openbox) is an optional lightweight window manager. Without one, `xdotool getactivewindow` and `windowactivate` don't work, so find the app window by class (`xdotool search --class google-chrome`) and focus it with `windowfocus`.
- **Playwright** (optional) drives browsers through the DOM. It's handy for web-only checks but can't drive native windows.

---

## Sandbox image

```dockerfile
# Display, window manager, input, screenshots, fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb fluxbox xdotool x11-utils wmctrl imagemagick \
      fonts-noto fonts-noto-color-emoji fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Chrome (Ubuntu's chromium is snap-only and awkward in containers; on Debian, `apt-get install chromium` also works)
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb

ENV DISPLAY=:99
```

`x11-utils` provides `xdpyinfo` and `xwininfo`.

| Job | Tool | Example |
| --- | --- | --- |
| Virtual display | `Xvfb` | `Xvfb :99 -screen 0 1920x1200x24 -nolisten tcp &` |
| Window manager (focus, active window) | `fluxbox` | `fluxbox &` |
| Keyboard | `xdotool` | `xdotool key ctrl+k`, `xdotool type --delay 40 -- "over"` |
| Mouse | `xdotool` | `xdotool mousemove 640 228 click 1` (button 4/5 = scroll up/down) |
| Find / focus / resize windows | `xdotool`, `wmctrl` | `xdotool search --onlyvisible --class google-chrome`, `xdotool windowsize --sync $WID 390 844`, `wmctrl -l` |
| Screenshots | ImageMagick `import` | `import -window $WID shot.png` or `import -window root shot.png` |
| Window and display info | `xwininfo`, `xdpyinfo` | `xdotool getwindowgeometry --shell $WID` |
| Web-only checks (optional) | Playwright | DOM-aware screenshots and selectors; can't drive native windows |

Display lifecycle: start the display lazily, the first time the agent needs it, and keep `DISPLAY=:99` in the environment of every command the agent runs. That way `bun run dev`, `npm start`, `cargo tauri dev`, or an Electron app render to the same screen the agent is looking at.

---

## System prompt section

Add this only when the sandbox has the display stack and the model accepts images:

````markdown
## Verify your work visually

This sandbox has a virtual display (DISPLAY=:99) and standard Linux tools for computer use: Xvfb, xdotool, ImageMagick (`import`), wmctrl, and Google Chrome. Use them however you see fit to run what you built and check it the way a user would. To see a screenshot, call `read_files` on the image file.

Use your judgment about when to verify. It's worth it when a change affects something a user sees or interacts with (a navbar style, a new dialog, a form flow, a terminal UI). Skip it when there's nothing to look at (running a git command, a config tweak).

Tips that give good results:
- Start the display if it isn't running: `Xvfb :99 -screen 0 1920x1200x24 -nolisten tcp &`. Make the screen bigger than any window you'll open.
- Start the app (for example `bun run dev &`) and wait until it's serving.
- For web apps, open Chrome in app mode so screenshots show only the app:
  `google-chrome --app=http://localhost:5173 --window-position=0,0 --window-size=1280,800 --force-device-scale-factor=1 --user-data-dir="$(mktemp -d)" --no-first-run --no-default-browser-check --disable-features=Translate --disable-gpu --hide-scrollbars &`
  - `--app` gives a bare window with no tabs or address bar.
  - A fixed position and size keep click coordinates and crops predictable. 1280×800 is a good default; resize to 390×844 to check a phone layout.
  - `--force-device-scale-factor=1` keeps screenshot pixels equal to click coordinates.
  - A fresh `--user-data-dir` and the first-run flags keep restore prompts and popups out of screenshots.
  - `--disable-gpu` because there's no GPU; `--hide-scrollbars` for cleaner shots.
- Drive the app with xdotool: `key`, `type --delay 40 --`, `mousemove X Y click 1` (buttons 4 and 5 scroll). Find the window with `xdotool search --onlyvisible --class google-chrome`, and focus it with `xdotool windowfocus --sync <id>` (`windowactivate` needs a window manager).
- Take screenshots with ImageMagick, for example `import -window <id> /tmp/cu-shots/03-filtered.png`. Wait about half a second after each action so the UI settles first.
- Take a fresh screenshot right before every click, and click in that screenshot's pixel coordinates; layouts move. If a click misses, look again before retrying.
- Move the pointer out of the way before screenshots you'll use as proof, so hover states don't leak in.
- Check the states that usually break: empty, loading, error, long content, dark mode, and a narrow viewport.
- If something looks wrong, fix it, reload, and check again.
- Read only the screenshots you need; each one costs context.
- Never close the window you're testing, and never put secrets (tokens, passwords, `.env` contents) on screen.

Example of a loop that worked well:

```bash
export DISPLAY=:99
mkdir -p /tmp/cu-shots
WID=$(xdotool search --sync --onlyvisible --class google-chrome | tail -1)
xdotool windowfocus --sync "$WID"
xdotool key ctrl+k && sleep 0.5 && import -window "$WID" /tmp/cu-shots/01-palette.png
xdotool type --delay 40 -- "over" && sleep 0.5 && import -window "$WID" /tmp/cu-shots/02-search.png
xdotool mousemove 640 228 click 1 && sleep 0.5 && import -window "$WID" /tmp/cu-shots/03-filtered.png
xdotool windowsize --sync "$WID" 390 844 && sleep 0.8 && import -window "$WID" /tmp/cu-shots/04-mobile.png
```

When you're done verifying, write `/tmp/cu-shots/evidence.json` choosing 3 to 8 screenshots that show the feature working:
[{"file": "/tmp/cu-shots/03-filtered.png", "caption": "Overdue filter applied: 4 cards", "action": "click", "detail": "Show overdue", "verdict": "passed"}]
`action` is one of launch, click, type, key, scroll, or resize. Captions state what the frame proves. Use "failed" for anything you couldn't fix, and say so in your answer.
````

The `evidence.json` fields map one-to-one onto `AgentScreenshot` in `@cline/ui` (`src` = the resolved file, `title` = caption, `action`, `detail`, `status` = verdict). The upload step in "Getting screenshots to clients" reads this file.

Context cost: Claude bills images at roughly `width × height / 750` tokens, so a 1280×800 screenshot is about 1.4k tokens. The existing media budget in `@cline/shared` (`DEFAULT_MAX_TOTAL_MEDIA_BYTES`, 8 MB per turn, and `IMAGE_OMITTED_PLACEHOLDER`) applies to images returned by `read_files`.

---

## Getting screenshots to clients

What already exists:
- `@cline/core/cloud` (`CloudSessionController`, `CloudSessionApi`) streams hub events and transcript snapshots from the sandbox to hosts.
- Messages already carry `GeneratedMedia` (`@cline/shared`, `llms/media.ts`), whose source is `base64`, `url`, or `artifact`. Hosts render inline `base64` today. `artifact` exists in the schema, but no host resolves it yet (`GeneratedMediaContent` shows a placeholder).
- The VS Code message translator maps `media` content events to `ClineMessage.media`. The desktop transcript renders tool-result images.

### Sandbox artifacts (backend dependency)

The biggest missing piece is on the backend: sandboxes need a way to expose files they produce, like these PNG screenshots, so clients can fetch and display them. Today a session only streams its transcript and events, and files on the sandbox disk are unreachable from clients (and disappear when the sandbox expires).

What the clients need from core-platform:
- **Publish from the sandbox:** a way for the sandbox to upload or register a file (PNG/WebP/JPEG, later video) for its session and get back a stable `artifactId`.
- **List and fetch from clients:** authenticated endpoints next to the existing `/api/v1/session/:id/...` routes. These list a session's artifacts and return bytes or a short-lived signed URL, using the same Cline auth and org scoping as the rest of the session API.
- **Durability:** artifacts outlive the sandbox and follow session retention, so a finished or expired session still shows its proof.
- **Limits:** caps on artifact size and on artifacts per session, and an org-level switch to disable screenshot capture.
- **Notification:** clients learn about new artifacts from the session's existing event or transcript stream, without polling.

The core-platform design lives in its own spec: [Sandbox artifacts spec (core-platform)](TODO-link). The client side below assumes that API.

### Client work

1. When the run completes, the sandbox reads `/tmp/cu-shots/evidence.json`, publishes those frames as artifacts, and gets an `artifactId` per frame. The completion carries `{ type: "artifact", artifactId }` media plus a small inline WebP thumbnail (about 320px wide, a few KB) so the slideshow renders immediately.
2. Host resolvers: the desktop sidecar and the VS Code extension fetch through an authenticated `CloudSessionApi` call (signed URL or bytes) and hand the webview a `blob:` or `data:` URL. Webviews never bind remote URLs directly, and the VS Code webview's content security policy blocks `fetch()` to other origins anyway.
3. A verification contract on the completion: `verification: { frames: [{ media, caption, action, detail, verdict }] }`, built from `evidence.json`.
4. Budgets: a cap on frames per session, dedupe by hash.

---

## Client UI (already built, on the branch)

- `@cline/ui` `AgentScreenshotCarousel`: autoplaying slideshow with a filmstrip and progress bars, a caption overlay (action, what the frame proves, pass/fail), a click-pointer marker, an expand-to-lightbox hook, and a compact mode. Its stylesheet is framework-neutral (`--cline-ui-shots-*` variables).
- Desktop: `ChatMessages` takes `verification` and renders the slideshow above the run's final answer.
- VS Code: `CompletionOutputRow` renders image `media` on the completion as a compact slideshow.
- Dev-only scripted demos: desktop with Cmd/Ctrl+Shift+D; VS Code with the "Cline: Play Computer Use Demo" command (needs `IS_DEV=true`).
