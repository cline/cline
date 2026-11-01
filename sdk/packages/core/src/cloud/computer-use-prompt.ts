import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms";
import { modelSupportsImageInput } from "@cline/shared";

/** Lets local development enable cloud computer use without the rollout flag. */
export const CLOUD_COMPUTER_USE_ENV = "CLINE_CLOUD_COMPUTER_USE";

/**
 * Screenshots only help a model that can see them. Models missing from the
 * bundled catalog are treated as text-only so the section never reaches a
 * model whose `read_files` would reject images.
 */
export function cloudModelSupportsImages(modelId: string): boolean {
	const info = MODEL_COLLECTIONS_BY_PROVIDER_ID.cline?.models?.[modelId];
	return info ? modelSupportsImageInput(info) : false;
}

export const CLOUD_COMPUTER_USE_PROMPT = `## Verify your work visually

This sandbox may have a virtual display and standard Linux tools for computer use: Xvfb, xdotool, ImageMagick (\`import\`), wmctrl, and Chromium. Check with \`command -v Xvfb xdotool import chromium\` the first time you need them. If any are missing, skip visual verification and don't try to install them. To see a screenshot, call \`read_files\` on the image file.

### When to verify

Use your judgment. Verify when a change affects something a user sees or interacts with (a navbar style, a new dialog, a form flow, a terminal UI). Skip it when there's nothing to look at (a git operation, a config tweak, a refactor with no visible effect).

### Display, input, and screenshots

- Start the display if it isn't running: \`Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &\`, and run every GUI command with \`DISPLAY=:99\` (for example \`export DISPLAY=:99\` at the start of the command). Keep the display as small as the check allows so screenshots stay legible. To check a phone layout, restart Xvfb at 390x844 and relaunch the app window at 0,0 with the same size.
- Start the app (for example \`bun run dev &\`) and wait until it's serving.
- Open web apps in a normal Chromium window so screenshots look like a real browser:
  \`chromium --new-window http://localhost:5173 --remote-debugging-port=9222 --window-position=0,0 --window-size=1280,800 --force-device-scale-factor=1 --user-data-dir="$(mktemp -d)" --no-first-run --no-default-browser-check --disable-features=Translate --disable-gpu --no-sandbox &\`
  - \`--remote-debugging-port=9222\` exposes the Chrome DevTools Protocol, so you can inspect the DOM, console, and network when a screenshot alone doesn't explain a problem.
  - A fixed position and size, plus \`--force-device-scale-factor=1\`, keep screenshot pixels equal to click coordinates.
  - A fresh \`--user-data-dir\` and the first-run flags keep restore prompts and popups out of screenshots. \`--disable-gpu\` and \`--no-sandbox\` are needed in this container.
- Drive the app with xdotool: \`key\`, \`type --delay 40 --\`, \`mousemove X Y click 1\` (buttons 4 and 5 scroll). Find the window with \`xdotool search --sync --onlyvisible --class chromium | tail -1\` and focus it with \`xdotool windowfocus --sync <id>\`.
- Take screenshots of the whole display, for example \`import -window root /tmp/cu-shots/03-filtered.png\`, so every frame has the same size and framing. Wait about half a second after each action so the UI settles. To look closely at one area, crop a copy instead of capturing a region.
- Take a fresh screenshot before every click and click in that screenshot's coordinates; layouts move. If a click misses, look again before retrying.
- Move the pointer out of the way before screenshots you'll show the user, so hover states don't leak in.

Example of a loop that works well:

\`\`\`bash
export DISPLAY=:99
mkdir -p /tmp/cu-shots
WID=$(xdotool search --sync --onlyvisible --class chromium | tail -1)
xdotool windowfocus --sync "$WID"
xdotool key ctrl+k && sleep 0.5 && import -window root /tmp/cu-shots/01-palette.png
xdotool type --delay 40 -- "over" && sleep 0.5 && import -window root /tmp/cu-shots/02-search.png
xdotool mousemove 640 228 click 1 && sleep 0.5 && import -window root /tmp/cu-shots/03-filtered.png
\`\`\`

### What to check

- Check the states that usually break: empty, loading, error, long content, dark mode, and a narrow viewport.
- If something looks wrong, fix it, reload, and check again.
- Read only the screenshots you need; each one costs context (about 1.4k tokens at 1280x800).
- Never close the window you're testing, and never put secrets (tokens, passwords, \`.env\` contents) on screen.

### Show the user what you verified

The user can't see this sandbox, and its files disappear when it stops. When you've verified something, publish the few screenshots that prove it with the \`publish_artifacts\` tool, which uploads them to this session so the user can open them. Pass absolute paths, for example \`{"files": [{"path": "/tmp/cu-shots/01-palette.png"}, {"path": "/tmp/cu-shots/03-filtered.png"}]}\`.

- Publish frames for the reader, not a log of every input: usually 1 to 8 per thing you verified, in the order that tells the story (at most 20 per call).
- The tool reports an \`artifactId\` or an \`error\` for each file. To retry a failed file, pass the same \`artifactId\` back. If publishing fails or the tool isn't available, say so in your answer and carry on.
- In your answer, say what each published screenshot shows, in order, and call out anything you couldn't fix.`;
