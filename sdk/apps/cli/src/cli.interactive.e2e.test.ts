import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

type CliResult = ReturnType<typeof spawnSync>;

interface KeyStep {
	delaySeconds: number;
	input: string;
}

const INITIAL_RENDER_DELAY_SECONDS = 2.5;
const POST_ACTION_SETTLE_SECONDS = 1.0;
const INTERACTIVE_TEST_TIMEOUT_MS = 40_000;

function normalizeTerminalOutput(output: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex intentionally strips ANSI escape sequences
	const ansiCsiRegex = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex intentionally strips OSC sequences
	const ansiOscRegex = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
	const carriageReturnRegex = /\r/g;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex intentionally strips backspace control bytes
	const backspaceRegex = /\u0008/g;
	return (
		output
			// Strip ANSI CSI/OSC escapes.
			.replace(ansiCsiRegex, "")
			.replace(ansiOscRegex, "")
			// Remove CR + backspace artifacts from `script`.
			.replace(carriageReturnRegex, "")
			.replace(backspaceRegex, "")
	);
}

function toShellSingleQuotedLiteral(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildScriptCommand(scriptedInput: string, launchArgs: string): string {
	const quietFlag = "-q";
	if (process.platform === "linux") {
		return `(${scriptedInput}) | script ${quietFlag} /dev/null -- ${toShellSingleQuotedLiteral(bunExec)} ${launchArgs}`;
	}

	return `(${scriptedInput}) | script ${quietFlag} /dev/null ${toShellSingleQuotedLiteral(bunExec)} ${launchArgs}`;
}

function runInteractiveCli(
	steps: KeyStep[],
	options?: { launchConfigView?: boolean },
): CliResult {
	const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-int-home-"));
	const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-int-data-"));
	const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-int-sessions-"));
	const teamDir = mkdtempSync(path.join(os.tmpdir(), "cli-int-teams-"));
	tempDirs.push(homeDir, dataDir, sessionDir, teamDir);

	const scriptedInput = [
		...steps,
		// Exit each interactive run explicitly so tests do not idle until timeout.
		{ delaySeconds: 0.2, input: "\u0003" },
	]
		.map(
			(step) =>
				`sleep ${step.delaySeconds}; printf ${toShellSingleQuotedLiteral(step.input)}`,
		)
		.join("; ");
	const baseArgs = [
		cliEntry,
		"--provider",
		"anthropic",
		"-m",
		"claude-sonnet-4-6",
		"-k",
		"test-key",
	];
	const launchArgs = [
		...(options?.launchConfigView ? [...baseArgs, "config"] : baseArgs),
	]
		.map((arg) => toShellSingleQuotedLiteral(arg))
		.join(" ");
	const command = buildScriptCommand(scriptedInput, launchArgs);

	return spawnSync("bash", ["-lc", command], {
		cwd: cliRoot,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: homeDir,
			CLINE_DATA_DIR: dataDir,
			CLINE_SESSION_DATA_DIR: sessionDir,
			CLINE_TEAM_DATA_DIR: teamDir,
			CLINE_SESSION_BACKEND_MODE: "local",
			CLINE_PROVIDER_SETTINGS_PATH: path.join(
				dataDir,
				"settings",
				"providers.json",
			),
			CLINE_HOOKS_LOG_PATH: path.join(dataDir, "hooks", "hooks.jsonl"),
		},
		timeout: INTERACTIVE_TEST_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024,
	});
}

function outputOf(result: CliResult): string {
	return normalizeTerminalOutput(
		`${typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8")}\n${
			typeof result.stderr === "string"
				? result.stderr
				: result.stderr.toString("utf8")
		}`,
	);
}

const tempDirs: string[] = [];

describe("cli interactive e2e", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows the interactive chat view on launch", () => {
		const result = runInteractiveCli([
			{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "" },
		]);
		const output = outputOf(result);
		expect(output).toContain("What can I do for you?");
		expect(output).toContain("○ Plan ● Act (Tab)");
		expect(output).toContain("Auto-approve all enabled (Shift+Tab)");
	});

	it("toggles plan/act mode with Tab", () => {
		const result = runInteractiveCli([
			{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "\t" },
			{ delaySeconds: POST_ACTION_SETTLE_SECONDS, input: "" },
		]);
		const output = outputOf(result);
		expect(output).toContain("○ Plan ● Act (Tab)");
		expect(output).toContain("● Plan ○ Act (Tab)");
	});

	it("toggles auto-approve-all with Shift+Tab", () => {
		const result = runInteractiveCli([
			{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "\u001b[Z" },
			{ delaySeconds: POST_ACTION_SETTLE_SECONDS, input: "" },
		]);
		const output = outputOf(result);
		expect(output).toContain("Auto-approve all enabled (Shift+Tab)");
		expect(output).toContain("Auto-approve all disabled (Shift+Tab)");
	});

	it("opens /settings and navigates tabs with Tab", () => {
		const result = runInteractiveCli([
			{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "/settings" },
			{ delaySeconds: 0.25, input: "\r" }, // accept slash completion
			{ delaySeconds: 0.25, input: "\r" }, // submit command
			{ delaySeconds: 0.7, input: "\t" },
			{ delaySeconds: POST_ACTION_SETTLE_SECONDS, input: "" },
		]);
		const output = outputOf(result);
		expect(output).toContain("Configuration");
		expect(output).toContain("Tools Plugins Agents Hooks [Skills] Rules MCP");
		expect(output).toContain("Tools Plugins Agents Hooks Skills [Rules] MCP");
	});

	it("closes /settings with Escape", () => {
		const result = runInteractiveCli([
			{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "/settings" },
			{ delaySeconds: 0.25, input: "\r" },
			{ delaySeconds: 0.25, input: "\r" },
			{ delaySeconds: POST_ACTION_SETTLE_SECONDS, input: "\u001b" },
			{ delaySeconds: POST_ACTION_SETTLE_SECONDS, input: "" },
		]);
		const output = outputOf(result);
		expect(output).toContain(
			"Config mode: Tab tabs · ↑/↓ navigate · Esc close",
		);
		expect(output).toContain("/ for commands · @ for files");
	});

	it("launches config view directly with `clite config`", () => {
		const result = runInteractiveCli(
			[{ delaySeconds: INITIAL_RENDER_DELAY_SECONDS, input: "" }],
			{
				launchConfigView: true,
			},
		);
		const output = outputOf(result);
		expect(output).toContain("Configuration");
		expect(output).toContain("Tools Plugins Agents Hooks [Skills] Rules MCP");
	});
});
