// ---------------------------------------------------------------------------
// Release blast-radius e2e suite (tuistory-driven).
//
// Covers the CLI-visible surface of the changes shipped since the last CLI
// release (v3.0.49), so a release candidate can be smoke-tested end-to-end
// in one command:
//
//   - #12899 Themes: /theme picker, live selection, persistence, restore,
//     escape-cancel, command palette + help dialog + settings integration
//   - #12930 Status bar tracks external git branch changes (5s poll)
//   - #12807 Lazy session persistence: no artifacts until the first user turn
//   - Onboarding provider screen (restyled by the themes PR) still renders
//     when no provider is configured
//
// Run with: bun run test:e2e:tuistory
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchTerminal, type Session } from "tuistory";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

const LAUNCH_TIMEOUT_MS = 30_000;
const UI_TIMEOUT_MS = 15_000;
// The repo status bar refreshes on a 5s poll; leave headroom for slow CI.
const REPO_POLL_TIMEOUT_MS = 20_000;

const tempDirs: string[] = [];
const sessions: Session[] = [];

interface CliEnv {
	env: Record<string, string | undefined>;
	dataDir: string;
	sessionDir: string;
}

function createCliEnv(
	overrides: Record<string, string | undefined> = {},
): CliEnv {
	const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-blast-home-"));
	const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-blast-data-"));
	const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-blast-sessions-"));
	const teamDir = mkdtempSync(path.join(os.tmpdir(), "cli-blast-teams-"));
	tempDirs.push(homeDir, dataDir, sessionDir, teamDir);

	return {
		dataDir,
		sessionDir,
		env: {
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
			CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
			CI: undefined,
			VITEST: undefined,
			...overrides,
		},
	};
}

async function launchCli(
	extraArgs: string[] = [],
	env: Record<string, string | undefined> = createCliEnv().env,
	args: string[] = [
		"--provider",
		"anthropic",
		"-m",
		"claude-sonnet-4-6",
		"-k",
		"test-key",
	],
): Promise<Session> {
	const session = await launchTerminal({
		command: bunExec,
		args: [cliEntry, ...args, ...extraArgs],
		cwd: cliRoot,
		env,
		cols: 120,
		rows: 36,
		waitForDataTimeout: LAUNCH_TIMEOUT_MS,
	});
	sessions.push(session);
	return session;
}

async function waitForChatView(session: Session): Promise<void> {
	await session.waitForText("What can I do for you?", {
		timeout: LAUNCH_TIMEOUT_MS,
	});
}

/** Exit the TUI, tolerating a process that quits on the first Ctrl+C. */
async function exitTui(session: Session): Promise<void> {
	try {
		await session.press(["ctrl", "c"]);
		await session.press(["ctrl", "c"]);
	} catch {
		// Already exited after the first press.
	}
	await session.waitIdle({ timeout: 5_000 });
}

/** Open the /theme picker from the chat view. */
async function openThemePicker(session: Session): Promise<void> {
	await session.type("/theme");
	await session.waitForText("Change color theme", { timeout: UI_TIMEOUT_MS });
	await session.press("enter");
	await session.waitForText("preview, Enter to apply, Esc to cancel", {
		timeout: UI_TIMEOUT_MS,
	});
}

function globalSettingsPath(dataDir: string): string {
	return path.join(dataDir, "settings", "global-settings.json");
}

/** Create a throwaway git repo with one commit on `main`. */
function createGitRepo(): string {
	const repoDir = mkdtempSync(path.join(os.tmpdir(), "cli-blast-repo-"));
	tempDirs.push(repoDir);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
	execFileSync("git", ["init", "-q", "-b", "main", repoDir], {
		encoding: "utf8",
	});
	git("config", "user.email", "blast@test.local");
	git("config", "user.name", "Blast Radius");
	execFileSync("bash", [
		"-c",
		`echo hello > ${path.join(repoDir, "readme.md")}`,
	]);
	git("add", ".");
	git("commit", "-qm", "init");
	return repoDir;
}

function listFilesRecursively(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
		(entry) => !entry.endsWith(path.sep),
	);
}

describe("release blast-radius e2e", () => {
	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			try {
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

	// #12899 — the theme picker lists every built-in theme with Auto current.
	it("opens the /theme picker with all built-in themes", async () => {
		const session = await launchCli();
		await waitForChatView(session);
		await openThemePicker(session);

		const screen = await session.text({ trimEnd: true });
		for (const label of [
			"Auto",
			"Cline Dark",
			"Cline Light",
			"Tokyo Night",
			"Gruvbox Dark",
			"Nord",
			"Dracula",
			"Catppuccin Mocha",
			"One Dark",
			"Solarized Dark",
			"Solarized Light",
		]) {
			expect(screen).toContain(label);
		}
		// Auto is the default until the user applies something else.
		expect(screen).toMatch(/Auto\s+.*\(current\)/);
	});

	// #12899 — applying a theme persists it and a relaunch restores it.
	it("applies a theme, persists it, and restores it on relaunch", async () => {
		const { env, dataDir } = createCliEnv();
		const session = await launchCli([], env);
		await waitForChatView(session);
		await openThemePicker(session);

		// Auto -> Cline Dark -> Cline Light -> Tokyo Night
		await session.press("down");
		await session.press("down");
		await session.press("down");
		await session.waitForText("❯ Tokyo Night", { timeout: UI_TIMEOUT_MS });
		await session.press("enter");
		await session.text({
			waitFor: (text) => !text.includes("preview, Enter to apply"),
			timeout: UI_TIMEOUT_MS,
		});

		// The selection is written through to the shared global settings file.
		await session.waitIdle({ timeout: UI_TIMEOUT_MS });
		const settingsFile = globalSettingsPath(dataDir);
		expect(existsSync(settingsFile)).toBe(true);
		expect(readFileSync(settingsFile, "utf8")).toContain(
			'"tuiTheme": "tokyo-night"',
		);

		// Relaunch against the same data dir: the picker must show Tokyo Night
		// as both the pre-selected row and the "(current)" theme.
		await exitTui(session);

		const relaunched = await launchCli([], env);
		await waitForChatView(relaunched);
		await openThemePicker(relaunched);
		const screen = await relaunched.text({ trimEnd: true });
		expect(screen).toMatch(/❯ Tokyo Night\s+.*\(current\)/);
	});

	// #12899 — Escape cancels the picker without persisting the previewed theme.
	it("cancels theme preview with Escape without persisting", async () => {
		const { env, dataDir } = createCliEnv();
		const session = await launchCli([], env);
		await waitForChatView(session);
		await openThemePicker(session);

		await session.press("down");
		await session.press("escape");
		await session.text({
			waitFor: (text) => !text.includes("preview, Enter to apply"),
			timeout: UI_TIMEOUT_MS,
		});

		await session.waitIdle({ timeout: 5_000 });
		const settingsFile = globalSettingsPath(dataDir);
		if (existsSync(settingsFile)) {
			expect(readFileSync(settingsFile, "utf8")).not.toContain("tuiTheme");
		}
	});

	// #12899 — theme entry points: help dialog, command palette, settings row.
	it("exposes theme switching in help, command palette, and settings", async () => {
		const session = await launchCli();
		await waitForChatView(session);

		await session.type("/help");
		await session.waitForText("Show help", { timeout: UI_TIMEOUT_MS });
		await session.press("enter");
		await session.waitForText("Keyboard Shortcuts", { timeout: UI_TIMEOUT_MS });
		let screen = await session.text({ trimEnd: true });
		expect(screen).toContain("/theme");
		expect(screen).toContain("Change color theme");
		await session.press("escape");
		await session.text({
			waitFor: (text) => !text.includes("Keyboard Shortcuts"),
			timeout: UI_TIMEOUT_MS,
		});

		await session.press(["ctrl", "p"]);
		await session.waitForText("Command Palette", { timeout: UI_TIMEOUT_MS });
		screen = await session.text({ trimEnd: true });
		expect(screen).toContain("Change Theme");
		await session.press("escape");
		await session.text({
			waitFor: (text) => !text.includes("Command Palette"),
			timeout: UI_TIMEOUT_MS,
		});

		await session.type("/settings");
		await session.waitForText("Modify agent configuration", {
			timeout: UI_TIMEOUT_MS,
		});
		await session.press("enter");
		await session.waitForText("←/→ switch tabs", { timeout: UI_TIMEOUT_MS });
		screen = await session.text({ trimEnd: true });
		// The General tab gained a Theme row showing the active theme.
		expect(screen).toMatch(/Theme\s+Auto/);
	});

	// #12930 — the status bar picks up branch changes made outside the TUI.
	it("tracks external git branch changes in the status bar", async () => {
		const repoDir = createGitRepo();
		const session = await launchCli(["-c", repoDir]);
		await waitForChatView(session);
		await session.waitForText("(main)", { timeout: REPO_POLL_TIMEOUT_MS });

		execFileSync("git", [
			"-C",
			repoDir,
			"checkout",
			"-q",
			"-b",
			"feature/blast-radius",
		]);

		// The TUI polls repo status every 5s; the new branch must show up
		// without any agent turn or user interaction.
		await session.waitForText("(feature/blast-radius)", {
			timeout: REPO_POLL_TIMEOUT_MS,
		});
		const screen = await session.text({ trimEnd: true });
		expect(screen).not.toContain("(main)");
	});

	// #12807 — sessions persist lazily: nothing on disk until the first
	// accepted user turn, then the manifest + messages artifacts appear.
	it("persists the session only after the first user message", async () => {
		const { env, sessionDir } = createCliEnv();
		const session = await launchCli([], env);
		await waitForChatView(session);

		// Idle TUI: launching alone must not create any session artifacts.
		await session.waitIdle({ timeout: 5_000 });
		expect(listFilesRecursively(sessionDir)).toEqual([]);

		// The first user turn persists the session even though the provider
		// call itself fails (dummy API key).
		await session.type("hello blast radius");
		await session.press("enter");
		await session.waitForText("Error", { timeout: LAUNCH_TIMEOUT_MS });

		let files: string[] = [];
		const deadline = Date.now() + UI_TIMEOUT_MS;
		while (Date.now() < deadline) {
			files = listFilesRecursively(sessionDir);
			if (files.length > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		expect(files.some((file) => file.endsWith(".messages.json"))).toBe(true);
		expect(files.some((file) => /(?<!messages)\.json$/.test(file))).toBe(true);
	});

	// The provider onboarding screen (restyled with the theme work) still
	// renders when no provider is configured at all.
	it("shows the provider onboarding screen without credentials", async () => {
		const { env } = createCliEnv();
		const session = await launchCli([], env, []);
		await session.waitForText("Connect a model provider to get started.", {
			timeout: LAUNCH_TIMEOUT_MS,
		});
		const screen = await session.text({ trimEnd: true });
		expect(screen).toContain("Sign in with Cline");
		expect(screen).toContain("Bring your own provider");
		expect(screen).toContain("↑/↓ navigate, Enter to select, Ctrl+C to exit");
	});
});
