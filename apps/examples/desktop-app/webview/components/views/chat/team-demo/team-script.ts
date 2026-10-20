import type { AgentScreenshot } from "@cline/ui";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import qaBoard from "./screenshots/qa-01-board.webp";
import qaPalette from "./screenshots/qa-02-palette.webp";
import qaSettings from "./screenshots/qa-03-settings.webp";
import qaDark from "./screenshots/qa-04-dark.webp";
import qaShortcuts from "./screenshots/qa-05-shortcut.webp";
import qaSaved from "./screenshots/qa-06-saved.webp";

/*
 * Scripted agent team run: a lead session that plans and delegates with the
 * real team tools, and one child session per teammate. Tool names, inputs, and
 * results follow the SDK team tools so the transcript and the header's agent
 * roster render exactly as they do for a live run. The QA screenshots were
 * captured from the Settings panel a real team built for this fixture app.
 */

export const TEAM_NAME = "tidepool-settings";
export const LEAD = "lead";
export const TEAMMATE_IDS = [
	"backend-dev",
	"ui-dev",
	"integration-dev",
	"qa-engineer",
] as const;
export type TeammateId = (typeof TEAMMATE_IDS)[number];
export type SessionKey = typeof LEAD | TeammateId;

export const TITLE = "Add a Settings panel: theme, digest, shortcuts";
export const PROMPT =
	"Add a Settings panel to Tidepool: a Light / Dark / Auto theme, a daily digest email with a send time, and editable keyboard shortcuts. Persist settings in localStorage, and open Settings from the command palette, a gear button, and Ctrl+,. Use a team for this, and have someone verify it in the browser.";

export type Teammate = {
	id: TeammateId;
	runId: string;
	title: string;
	role: string;
	task: string;
};

export const TEAMMATES: Record<TeammateId, Teammate> = {
	"backend-dev": {
		id: "backend-dev",
		runId: "run_4f2a91",
		title: "Build the settings store and localStorage persistence",
		role: "You own application state and persistence.",
		task: "Create src/settings.js: defaults for theme, digest, and shortcuts, persistence in localStorage under tidepool.settings.v1, and a change event other modules can subscribe to. Tell integration-dev the API when it is ready.",
	},
	"ui-dev": {
		id: "ui-dev",
		runId: "run_8c07de",
		title: "Design and build the Settings dialog",
		role: "You own UI markup and styles.",
		task: "Build the Settings dialog with Theme, Notifications, and Keyboard Shortcuts sections. Match the command palette's dialog styles and reuse the existing design tokens.",
	},
	"integration-dev": {
		id: "integration-dev",
		runId: "run_b513e0",
		title: "Wire Settings into the theme, palette, and shortcuts",
		role: "You connect features across the app.",
		task: "Once the store and dialog exist, apply the theme, make the palette shortcut configurable, and open Settings from a gear button, a palette action, and Ctrl+,. Plan against the current code while you wait.",
	},
	"qa-engineer": {
		id: "qa-engineer",
		runId: "run_e9d342",
		title: "Verify the Settings panel in the browser",
		role: "You run the app and verify features like a user would.",
		task: "When integration-dev says it is ready, run the app in Chrome and verify every requirement with screenshots. Report bugs to the owner, then re-verify.",
	},
};

export const SCREENSHOTS: AgentScreenshot[] = [
	{
		id: "board",
		src: qaBoard.src,
		title: "Board loads with the new gear button",
		action: "launch",
		detail: "localhost:5173",
		status: "passed",
	},
	{
		id: "palette",
		src: qaPalette.src,
		title: "“Settings” is a palette action",
		action: "type",
		detail: "sett",
		status: "passed",
	},
	{
		id: "settings",
		src: qaSettings.src,
		title: "Settings opens with Theme and Notifications",
		action: "key",
		detail: "Enter",
		status: "passed",
	},
	{
		id: "dark",
		src: qaDark.src,
		title: "Dark theme applies instantly",
		action: "click",
		detail: "Dark",
		pointer: { x: 0.35, y: 0.456 },
		status: "passed",
	},
	{
		id: "shortcuts",
		src: qaShortcuts.src,
		title: "Keyboard shortcuts are editable",
		action: "scroll",
		detail: "Keyboard Shortcuts",
		status: "passed",
	},
	{
		id: "saved",
		src: qaSaved.src,
		title: "Saved settings survive a reload",
		action: "key",
		detail: "F5",
		status: "passed",
	},
];

export const FINAL_DIFF = { additions: 486, deletions: 41 };

const LEAD_PLAN = `This splits into four pieces. Only the store is a hard dependency, so the store and the dialog can start in parallel while integration plans against the current code.

1. **backend-dev**: settings store and \`localStorage\` persistence
2. **ui-dev**: the Settings dialog, in the palette's existing styles
3. **integration-dev**: theme, configurable palette shortcut, and the three ways to open Settings, once 1 and 2 land
4. **qa-engineer**: run the app in Chrome and verify every requirement, once 3 lands`;

const LEAD_FINAL = `Settings is in. Four teammates built it in parallel, and qa-engineer verified it in the browser.

- **backend-dev** added \`src/settings.js\`: defaults, persistence under \`tidepool.settings.v1\`, and change events
- **ui-dev** built the dialog with Theme, Notifications, and Keyboard Shortcuts sections in the existing styles
- **integration-dev** applied the theme, made the palette shortcut configurable, and added a gear button, a "Settings" palette action, and \`Ctrl ,\`
- **qa-engineer** found that **Auto** ignored OS theme changes, sent it back to integration-dev, and re-verified the fix

31 tests pass.`;

export type Beat = { wait: number; in: SessionKey } & (
	| { status: ChatSessionStatus }
	/** Opens a teammate's session with its task as the first message. */
	| { start: true }
	| {
			say: string;
			reasoning?: string;
			/** Model time spent thinking, so "Thought for…" reads like a real turn. */
			thinkMs?: number;
			stream?: boolean;
	  }
	/** A tool call. With `ref` it stays running until a matching `complete`. */
	| {
			tool: string;
			input: unknown;
			result?: unknown;
			runMs?: number;
			ref?: string;
	  }
	| { complete: string; result: unknown }
);

const commandResult = (query: string, result: string) => [{ query, result }];

const screenshot = (images: Record<string, string>, id: string) => [
	{ type: "image", mediaType: "image/webp", data: images[id] ?? "" },
];

const runSummary = (teammate: Teammate, status = "completed") => ({
	id: teammate.runId,
	agentId: teammate.id,
	status,
});

export function buildBeats(images: Record<string, string>): Beat[] {
	const backend = TEAMMATES["backend-dev"];
	const ui = TEAMMATES["ui-dev"];
	const integration = TEAMMATES["integration-dev"];
	const qa = TEAMMATES["qa-engineer"];
	const all = [backend, ui, integration, qa];

	return [
		{ wait: 500, in: LEAD, status: "running" },
		{
			wait: 500,
			in: LEAD,
			reasoning:
				"A settings panel touches state, UI, theming, and keyboard handling. Before deciding how to split it, I need to see where those live today.",
			thinkMs: 4000,
			say: "I'll look at how Tidepool handles state, theming, and shortcuts before splitting this up.",
		},
		{
			wait: 300,
			in: LEAD,
			tool: "read_files",
			input: {
				files: ["index.html", "src/app.js", "src/palette.js", "src/styles.css"],
			},
			result: "ok",
			runMs: 700,
		},
		{
			wait: 200,
			in: LEAD,
			tool: "search_codebase",
			input: { queries: ["keydown", "localStorage", "data-theme"] },
			result:
				"src/app.js:41 document.addEventListener('keydown', …)\nsrc/palette.js:12 if (e.ctrlKey && e.key === 'k')\nsrc/styles.css:3 :root[data-theme='dark']",
			runMs: 500,
		},
		{
			wait: 500,
			in: LEAD,
			reasoning:
				"Dependencies first. Theme, shortcuts, and notifications all read settings, so the store comes first, but the dialog markup doesn't need it, so the store and the dialog can run in parallel. Integration can plan against the existing keydown and theme code while it waits. QA needs everything wired, so it goes last and should exercise the real UI in a browser.",
			thinkMs: 9000,
			say: LEAD_PLAN,
			stream: true,
		},
		...all.map(
			(teammate): Beat => ({
				wait: 120,
				in: LEAD,
				tool: "team_spawn_teammate",
				input: { agentId: teammate.id, rolePrompt: teammate.role },
				result: { agentId: teammate.id, status: "spawned" },
				runMs: 220,
			}),
		),
		...all.flatMap((teammate): Beat[] => [
			{
				wait: 100,
				in: LEAD,
				tool: "team_run_task",
				input: {
					agentId: teammate.id,
					task: teammate.task,
					runMode: "async",
				},
				result: {
					agentId: teammate.id,
					mode: "async",
					status: "queued",
					dispatched: true,
					message: `Task dispatched to ${teammate.id} and queued as ${teammate.runId}.`,
					runId: teammate.runId,
				},
				runMs: 200,
			},
			{ wait: 60, in: teammate.id, start: true },
		]),
		{
			wait: 400,
			in: LEAD,
			say: "The team is running. backend-dev and ui-dev are building now; integration-dev and qa-engineer are planning until their inputs land.",
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_await_runs",
			input: { runId: backend.runId },
			ref: "await-store",
		},

		// Builders act while integration-dev and qa-engineer plan.
		{
			wait: 300,
			in: "backend-dev",
			reasoning:
				"Everyone else reads from this module, so the API matters more than the internals. Keep it small: get, update with a patch, and subscribe.",
			thinkMs: 3000,
			say: "Starting with the storage format so the rest of the team has a stable API.",
		},
		{
			wait: 300,
			in: "ui-dev",
			say: "I'll match the command palette's dialog so Settings feels native.",
		},
		{
			wait: 250,
			in: "integration-dev",
			reasoning:
				"My work depends on the store and the dialog, neither of which exists yet. The useful thing now is to find every place theme and shortcuts are handled, so I can wire them up the moment the others land.",
			thinkMs: 5000,
			say: "Nothing to wire yet. I'll map where theme and shortcuts are handled today.",
		},
		{
			wait: 250,
			in: "backend-dev",
			tool: "read_files",
			input: { files: ["src/app.js"] },
			result: "ok",
			runMs: 500,
		},
		{
			wait: 150,
			in: "ui-dev",
			tool: "read_files",
			input: { files: ["src/palette.js", "src/styles.css"] },
			result: "ok",
			runMs: 500,
		},
		{
			wait: 250,
			in: "qa-engineer",
			say: "Nothing to test yet. I'll turn the requirements into a checklist while the build lands.",
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "search_codebase",
			input: { queries: ["keydown", "prefers-color-scheme", "openPalette"] },
			result:
				"src/app.js:41 document.addEventListener('keydown', …)\nsrc/palette.js:12 if (e.ctrlKey && e.key === 'k') openPalette()",
			runMs: 500,
		},
		{
			wait: 250,
			in: "backend-dev",
			tool: "editor",
			input: {
				path: "src/settings.js",
				new_text: `const KEY = "tidepool.settings.v1";

export const DEFAULTS = {
	theme: "auto",
	digest: { enabled: true, time: "09:00" },
	shortcuts: { palette: "Mod+K", settings: "Mod+,", theme: "Mod+Shift+L" },
};

export function getSettings() {
	const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
	return { ...DEFAULTS, ...saved };
}

export function updateSettings(patch) {
	const next = { ...getSettings(), ...patch };
	localStorage.setItem(KEY, JSON.stringify(next));
	window.dispatchEvent(new CustomEvent("settingschange", { detail: next }));
	return next;
}

export function onSettingsChange(listener) {
	const handle = (event) => listener(event.detail);
	window.addEventListener("settingschange", handle);
	return () => window.removeEventListener("settingschange", handle);
}`,
			},
			result: "Created src/settings.js",
			runMs: 800,
		},
		{
			wait: 250,
			in: "qa-engineer",
			tool: "editor",
			input: {
				path: "qa/settings-checklist.md",
				new_text: `# Settings checklist

- [ ] Gear button opens Settings
- [ ] "Settings" palette action opens Settings
- [ ] Ctrl+, opens Settings
- [ ] Light, Dark, and Auto apply instantly
- [ ] Auto follows OS theme changes without a reload
- [ ] Daily digest toggle and send time
- [ ] Shortcuts are editable and take effect
- [ ] Settings survive a reload`,
			},
			result: "Created qa/settings-checklist.md",
			runMs: 600,
		},
		{
			wait: 250,
			in: "ui-dev",
			tool: "editor",
			input: {
				path: "index.html",
				old_text: `<div id="palette" class="dialog" hidden></div>`,
				new_text: `<div id="palette" class="dialog" hidden></div>
<div id="settings" class="dialog settings" role="dialog" aria-labelledby="settings-title" hidden>
	<header><h2 id="settings-title">Settings</h2><button data-close aria-label="Close">×</button></header>
	<section data-section="theme"></section>
	<section data-section="notifications"></section>
	<section data-section="shortcuts"></section>
	<footer><button data-reset>Reset to defaults</button><button data-save class="primary">Save changes</button></footer>
</div>`,
			},
			result: "Edited index.html",
			runMs: 700,
		},
		{
			wait: 300,
			in: "integration-dev",
			say: `Plan, once the store and dialog land:

1. Apply \`data-theme\` on \`<html>\` from settings, with **Auto** following \`prefers-color-scheme\`
2. Replace the hard-coded \`Ctrl+K\` check with the configured binding
3. Add a gear button, a "Settings" palette action, and \`Ctrl ,\``,
			stream: true,
		},
		{
			wait: 250,
			in: "backend-dev",
			tool: "run_commands",
			input: { commands: ["bun test src/settings.test.js"] },
			result: commandResult(
				"bun test src/settings.test.js",
				"✓ returns defaults when nothing is saved\n✓ merges a patch and persists it\n✓ notifies subscribers on change\n\n 11 pass\n 0 fail",
			),
			runMs: 900,
		},
		{
			wait: 250,
			in: "ui-dev",
			tool: "editor",
			input: {
				path: "src/styles.css",
				old_text: `.dialog {`,
				new_text: `.settings { width: min(512px, 92vw); max-height: 86vh; }
.settings section { padding: var(--space-4) var(--space-5); }
.settings .option { border: 1px solid var(--border); border-radius: var(--radius-md); }
.settings .option[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); }

.dialog {`,
			},
			result: "Edited src/styles.css",
			runMs: 600,
		},
		{
			wait: 250,
			in: "backend-dev",
			tool: "team_send_message",
			input: {
				toAgentId: "integration-dev",
				subject: "Settings store is ready",
				body: "src/settings.js exports getSettings(), updateSettings(patch), and onSettingsChange(fn). Defaults: theme auto, digest 09:00, palette Mod+K, settings Mod+,.",
			},
			result: { id: "msg_1", toAgentId: "integration-dev" },
			runMs: 250,
		},
		{
			wait: 300,
			in: "backend-dev",
			say: "The settings store is done: `src/settings.js` with defaults, persistence under `tidepool.settings.v1`, and a `settingschange` event. 11 tests pass, and integration-dev has the API.",
			stream: true,
		},
		{ wait: 200, in: "backend-dev", status: "completed" },
		{
			wait: 200,
			in: LEAD,
			complete: "await-store",
			result: runSummary(backend),
		},
		{
			wait: 400,
			in: LEAD,
			say: "The store is in and integration-dev has the API. Waiting on the rest of the team.",
		},
		{
			wait: 200,
			in: LEAD,
			tool: "team_await_runs",
			input: {},
			ref: "await-all",
		},

		// Integration picks up the store while ui-dev finishes the dialog.
		{
			wait: 300,
			in: "integration-dev",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: [
				{
					id: "msg_1",
					fromAgentId: "backend-dev",
					toAgentId: "integration-dev",
					subject: "Settings store is ready",
				},
			],
			runMs: 250,
		},
		{
			wait: 250,
			in: "ui-dev",
			tool: "editor",
			input: {
				path: "src/settings-panel.js",
				new_text: `import { getSettings, updateSettings, DEFAULTS } from "./settings.js";

export function openSettings() {
	const dialog = document.getElementById("settings");
	render(dialog, getSettings());
	dialog.hidden = false;
	dialog.querySelector("[data-save]").onclick = () => {
		updateSettings(readForm(dialog));
		dialog.hidden = true;
	};
	dialog.querySelector("[data-reset]").onclick = () => render(dialog, DEFAULTS);
}`,
			},
			result: "Created src/settings-panel.js",
			runMs: 800,
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "editor",
			input: {
				path: "src/theme.js",
				new_text: `import { getSettings, onSettingsChange } from "./settings.js";

const dark = window.matchMedia("(prefers-color-scheme: dark)");

function apply({ theme }) {
	const resolved = theme === "auto" ? (dark.matches ? "dark" : "light") : theme;
	document.documentElement.dataset.theme = resolved;
}

export function initTheme() {
	apply(getSettings());
	onSettingsChange(apply);
}`,
			},
			result: "Created src/theme.js",
			runMs: 700,
		},
		{
			wait: 250,
			in: "ui-dev",
			say: "The Settings dialog is done: Theme, Notifications, and Keyboard Shortcuts sections, styled with the palette's tokens, with `openSettings()` exported for integration-dev.",
			stream: true,
		},
		{ wait: 200, in: "ui-dev", status: "completed" },
		{
			wait: 250,
			in: "integration-dev",
			tool: "editor",
			input: {
				path: "src/palette.js",
				old_text: `if (e.ctrlKey && e.key === 'k') openPalette();`,
				new_text: `if (matchesShortcut(e, getSettings().shortcuts.palette)) openPalette();`,
			},
			result: "Edited src/palette.js",
			runMs: 600,
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "editor",
			input: {
				path: "src/app.js",
				old_text: `initPalette(commands);`,
				new_text: `initTheme();
commands.push({ id: "settings", label: "Settings", shortcut: "Mod+,", run: openSettings });
initPalette(commands);
document.getElementById("gear").addEventListener("click", openSettings);`,
			},
			result: "Edited src/app.js",
			runMs: 700,
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "team_send_message",
			input: {
				toAgentId: "qa-engineer",
				subject: "Ready to test",
				body: "Theme, the configurable palette shortcut, the gear button, the Settings palette action, and Ctrl+, are all wired. bun run dev serves it on :5173.",
			},
			result: { id: "msg_2", toAgentId: "qa-engineer" },
			runMs: 250,
		},

		// QA drives the real UI and finds a bug.
		{
			wait: 300,
			in: "qa-engineer",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: [
				{
					id: "msg_2",
					fromAgentId: "integration-dev",
					toAgentId: "qa-engineer",
					subject: "Ready to test",
				},
			],
			runMs: 250,
		},
		{
			wait: 200,
			in: "qa-engineer",
			tool: "run_commands",
			input: {
				commands: [
					"bun run dev & Xvfb :99 -screen 0 1280x800x24 & DISPLAY=:99 google-chrome --app=http://localhost:5173 &",
				],
			},
			result: commandResult(
				"bun run dev",
				"Serving on http://localhost:5173\nChrome attached to display :99",
			),
			runMs: 900,
		},
		{
			wait: 250,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "screenshot" },
			result: screenshot(images, "board"),
			runMs: 500,
		},
		{
			wait: 1100,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "type", text: "sett" },
			result: screenshot(images, "palette"),
			runMs: 500,
		},
		{
			wait: 1100,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "key", text: "Return" },
			result: screenshot(images, "settings"),
			runMs: 500,
		},
		{
			wait: 1100,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "left_click", coordinate: [448, 365] },
			result: screenshot(images, "dark"),
			runMs: 500,
		},
		{
			wait: 1100,
			in: "qa-engineer",
			reasoning:
				"Light and Dark work. For Auto, the theme has to follow the OS while the app is open. I selected Auto, switched the system to dark, and the page stayed light until I reloaded.",
			thinkMs: 4000,
			say: "Found a bug: with **Auto** selected, changing the OS theme doesn't update the app until a reload. Sending it to integration-dev.",
		},
		{
			wait: 250,
			in: "qa-engineer",
			tool: "team_send_message",
			input: {
				toAgentId: "integration-dev",
				subject: "Auto theme ignores OS changes",
				body: "With theme set to Auto, switching the OS to dark leaves the app light until reload. Repro: select Auto, then toggle prefers-color-scheme.",
			},
			result: { id: "msg_3", toAgentId: "integration-dev" },
			runMs: 250,
		},
		{
			wait: 400,
			in: "integration-dev",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: [
				{
					id: "msg_3",
					fromAgentId: "qa-engineer",
					toAgentId: "integration-dev",
					subject: "Auto theme ignores OS changes",
				},
			],
			runMs: 250,
		},
		{
			wait: 250,
			in: "integration-dev",
			say: "Good catch. `apply` only runs on settings changes, so it needs to listen to the media query too.",
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "editor",
			input: {
				path: "src/theme.js",
				old_text: `	onSettingsChange(apply);`,
				new_text: `	onSettingsChange(apply);
	dark.addEventListener("change", () => apply(getSettings()));`,
			},
			result: "Edited src/theme.js",
			runMs: 600,
		},
		{
			wait: 250,
			in: "integration-dev",
			tool: "team_send_message",
			input: {
				toAgentId: "qa-engineer",
				subject: "Fixed: Auto theme",
				body: "The theme now listens for prefers-color-scheme changes while set to Auto.",
			},
			result: { id: "msg_4", toAgentId: "qa-engineer" },
			runMs: 250,
		},
		{
			wait: 250,
			in: "integration-dev",
			say: 'Settings is wired in: theme with live OS changes for Auto, a configurable palette shortcut, a gear button, a "Settings" palette action, and `Ctrl ,`.',
			stream: true,
		},
		{ wait: 200, in: "integration-dev", status: "completed" },
		{
			wait: 300,
			in: "qa-engineer",
			tool: "team_read_mailbox",
			input: { unreadOnly: true },
			result: [
				{
					id: "msg_4",
					fromAgentId: "integration-dev",
					toAgentId: "qa-engineer",
					subject: "Fixed: Auto theme",
				},
			],
			runMs: 250,
		},
		{
			wait: 300,
			in: "qa-engineer",
			say: "Re-checked Auto: the app now follows the OS theme live. Moving on to shortcuts.",
		},
		{
			wait: 300,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "scroll", coordinate: [512, 400], direction: "down" },
			result: screenshot(images, "shortcuts"),
			runMs: 500,
		},
		{
			wait: 1100,
			in: "qa-engineer",
			tool: "computer",
			input: { action: "key", text: "F5" },
			result: screenshot(images, "saved"),
			runMs: 500,
		},
		{
			wait: 250,
			in: "qa-engineer",
			say: "Verified all 8 checklist items in Chrome: every way to open Settings, Light / Dark / Auto (including the OS change fix), the daily digest, editable shortcuts, and persistence across a reload.",
			stream: true,
		},
		{ wait: 200, in: "qa-engineer", status: "completed" },

		{
			wait: 300,
			in: LEAD,
			complete: "await-all",
			result: all.map((teammate) => runSummary(teammate)),
		},
		{
			wait: 300,
			in: LEAD,
			tool: "run_commands",
			input: { commands: ["bun test"] },
			result: commandResult(
				"bun test",
				" 31 pass\n 0 fail\nRan 31 tests across 9 files.",
			),
			runMs: 900,
		},
		{ wait: 400, in: LEAD, say: LEAD_FINAL, stream: true },
		{ wait: 300, in: LEAD, status: "completed" },
	];
}
