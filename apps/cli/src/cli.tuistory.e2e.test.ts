// ---------------------------------------------------------------------------
// Proof-of-concept: driving the interactive TUI with tuistory
// (https://github.com/remorses/tuistory) instead of `script` + timed printf.
//
// Compare with `cli.interactive.e2e.test.ts`, which pipes keystrokes through
// the Unix `script` utility on a fixed sleep schedule and greps the raw
// output dump. Here each test launches the CLI in a real PTY backed by a
// Ghostty terminal emulator, waits reactively for screen content
// (`waitForText` resolves as soon as the text renders), and asserts against
// the emulated screen state rather than the raw byte stream.
//
// Run with: bun run test:e2e:tuistory
// ---------------------------------------------------------------------------

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchTerminal, type Session } from "tuistory";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

const LAUNCH_TIMEOUT_MS = 30_000;
const UI_TIMEOUT_MS = 15_000;

const tempDirs: string[] = [];
const sessions: Session[] = [];

function createCliEnv(
	overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-tuistory-home-"));
	const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-tuistory-data-"));
	const sessionDir = mkdtempSync(
		path.join(os.tmpdir(), "cli-tuistory-sessions-"),
	);
	const teamDir = mkdtempSync(path.join(os.tmpdir(), "cli-tuistory-teams-"));
	tempDirs.push(homeDir, dataDir, sessionDir, teamDir);

	return {
		HOME: homeDir,
		CLINE_DATA_DIR: dataDir,
		CLINE_DB_DATA_DIR: path.join(dataDir, "db"),
		CLINE_SESSION_DATA_DIR: sessionDir,
		CLINE_TEAM_DATA_DIR: teamDir,
		CLINE_SESSION_BACKEND_MODE: "local",
		CLINE_PROVIDER_SETTINGS_PATH: path.join(
			dataDir,
			"settings",
			"providers.json",
		),
		CLINE_HOOKS_LOG_PATH: path.join(dataDir, "logs", "hooks.jsonl"),
		CLINE_TELEMETRY_DISABLED: "1",
		CLINE_NO_AUTO_UPDATE: "1",
		// Without this, the ClinePass promo dialog renders over the chat view.
		// The stream-grepping interactive suite doesn't notice the overlay, but
		// tuistory's screen snapshot reflects what the user actually sees.
		CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
		// The parent vitest process sets CI/VITEST; clear them so the spawned
		// CLI renders as a real interactive terminal.
		CI: undefined,
		VITEST: undefined,
		...overrides,
	};
}

async function launchCli(
	extraArgs: string[] = [],
	env: Record<string, string | undefined> = createCliEnv(),
): Promise<Session> {
	const session = await launchTerminal({
		command: bunExec,
		args: [
			cliEntry,
			"--provider",
			"anthropic",
			"-m",
			"claude-sonnet-4-6",
			"-k",
			"test-key",
			...extraArgs,
		],
		cwd: cliRoot,
		env,
		cols: 120,
		rows: 36,
		// The CLI compiles a large TS graph on cold start; don't gate launch
		// on the default 5s first-data timeout.
		waitForDataTimeout: LAUNCH_TIMEOUT_MS,
	});
	sessions.push(session);
	return session;
}

/** Wait for the chat view to be fully rendered. */
async function waitForChatView(session: Session): Promise<void> {
	await session.waitForText("What can I do for you?", {
		timeout: LAUNCH_TIMEOUT_MS,
	});
}

describe("cli tuistory e2e", () => {
	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			try {
				// Double Ctrl+C exits the TUI cleanly (first press shows the
				// "press again to exit" hint) before the PTY is torn down.
				await session.press(["ctrl", "c"]);
				await session.press(["ctrl", "c"]);
				await session.waitIdle({ timeout: 3_000 });
			} catch {
				// Session may already be dead; close() below still cleans up.
			}
			session.close();
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows the interactive chat view on launch", async () => {
		const session = await launchCli();
		await waitForChatView(session);

		const screen = await session.text({ trimEnd: true });
		expect(screen).toContain("What can I do for you?");
		expect(screen).toContain("○ Plan ● Act (Tab)");
		expect(screen).toContain("Auto-approve all enabled (Shift+Tab)");
	});

	it("toggles plan/act mode with Tab", async () => {
		const session = await launchCli();
		await waitForChatView(session);
		expect(await session.text()).toContain("○ Plan ● Act (Tab)");

		await session.press("tab");
		// Reactive wait: resolves as soon as the toggled indicator renders.
		await session.waitForText("● Plan ○ Act (Tab)", {
			timeout: UI_TIMEOUT_MS,
		});

		// Unlike stream-grepping, the emulated screen reflects current state:
		// the old indicator is gone, not just buried in scrollback.
		const screen = await session.text();
		expect(screen).toContain("● Plan ○ Act (Tab)");
		expect(screen).not.toContain("○ Plan ● Act (Tab)");
	});

	it("toggles auto-approve-all with Shift+Tab", async () => {
		const session = await launchCli();
		await waitForChatView(session);
		expect(await session.text()).toContain(
			"Auto-approve all enabled (Shift+Tab)",
		);

		await session.press(["shift", "tab"]);
		await session.waitForText("Auto-approve all disabled (Shift+Tab)", {
			timeout: UI_TIMEOUT_MS,
		});

		const screen = await session.text();
		expect(screen).not.toContain("Auto-approve all enabled (Shift+Tab)");
	});

	it("opens /settings, navigates tabs, and closes with Escape", async () => {
		const session = await launchCli();
		await waitForChatView(session);

		await session.type("/settings");
		// Slash menu completion for the settings command.
		await session.waitForText("Modify agent configuration", {
			timeout: UI_TIMEOUT_MS,
		});
		// A single Enter accepts the highlighted completion and submits it.
		// (The `script`-based suite pressed Enter twice with 250ms sleeps; with
		// reactive key delivery the second Enter would leak into the settings
		// view and activate the focused row.)
		await session.press("enter");
		await session.waitForText("←/→ switch tabs", { timeout: UI_TIMEOUT_MS });

		const settingsScreen = await session.text();
		expect(settingsScreen).toContain("Settings");
		expect(settingsScreen).toContain("▸ Provider");

		// Switch from the General tab to the MCP tab; the body swaps from the
		// provider/model rows to MCP content.
		await session.press("right");
		await session.text({
			waitFor: (text) => !text.includes("Compaction"),
			timeout: UI_TIMEOUT_MS,
		});

		await session.press("escape");
		await session.waitForText("Use / for slash commands", {
			timeout: UI_TIMEOUT_MS,
		});
		expect(await session.text()).not.toContain("←/→ switch tabs");
	});

	it("launches config view directly with `cline config`", async () => {
		const session = await launchCli(["config"]);
		await session.waitForText("←/→ switch tabs", {
			timeout: LAUNCH_TIMEOUT_MS,
		});
		const screen = await session.text();
		expect(screen).toContain("Settings");
		expect(screen).toContain("▸ Provider");
	});

	it("dismisses the ClinePass promo with any key and marks it as shown", async () => {
		// Re-enable the promo dialog that the shared env suppresses.
		const env = createCliEnv({ CLINE_DISABLE_CLINE_PASS_NOTICE: undefined });
		const dataDir = env.CLINE_DATA_DIR as string;
		const session = await launchCli([], env);

		await session.waitForText("Try ClinePass", { timeout: LAUNCH_TIMEOUT_MS });
		await session.waitForText("Press Enter to open, any other key to close", {
			timeout: UI_TIMEOUT_MS,
		});

		// Any key other than Enter dismisses the dialog (Esc is unreliable in
		// some terminals, notably on Windows).
		await session.type("x");
		await session.text({
			waitFor: (text) => !text.includes("Try ClinePass"),
			timeout: UI_TIMEOUT_MS,
		});

		const screen = await session.text();
		expect(screen).toContain("What can I do for you?");
		expect(screen).not.toContain("Open ClinePass");

		// The "shown" marker is persisted once the dialog is dismissed so the
		// promo doesn't reappear on the next launch.
		const markerPath = path.join(dataDir, "settings", "cli-notices.json");
		await session.waitIdle({ timeout: UI_TIMEOUT_MS });
		expect(existsSync(markerPath)).toBe(true);
		expect(readFileSync(markerPath, "utf8")).toContain(
			'"cline-cli-cline-pass-intro": true',
		);
	});
});
