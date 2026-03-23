import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

const HELP_TERMINAL = { columns: 120, rows: 50 };

// ===========================================================================
// Root-level flag descriptions
// ===========================================================================
test.describe("root flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("all root flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Run in act mode",
			"Run in plan mode",
			"yolo mode",
			"timeout in seconds",
			"Model to use",
			"verbose output",
			"Working directory",
			"Configuration directory",
			"extended thinking",
			"Reasoning effort",
			"consecutive mistakes",
			"Output messages as JSON",
			// "first completion attempt", // double check completion flag is not required
			"ACP",
			"Resume an existing task",
		]);
	});

	test("all short flag aliases are shown", async ({ terminal }) => {
		await expectVisible(terminal, [
			"-a",
			"-p",
			"-y",
			"-t",
			"-m",
			"-v",
			"-c",
			"-T",
		]);
	});
});

// ===========================================================================
// Task subcommand flag descriptions
// ===========================================================================
test.describe("task flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["task", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("all task flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Run in act mode",
			"Run in plan mode",
			"yolo mode",
			"timeout in seconds",
			"Model to use",
			"verbose output",
			"Working directory",
			"Configuration directory",
			"extended thinking",
			"Reasoning effort",
			"consecutive mistakes",
			"Output messages as JSON",
			// "first completion attempt",
			"Resume an existing task",
		]);
	});
});

// ===========================================================================
// History subcommand flag descriptions
// ===========================================================================
test.describe("history flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("all history flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, "number of sessions to show");
		await expectVisible(terminal, "Page number");
		await expectVisible(terminal, "configuration directory");
	});
});

// ===========================================================================
// Auth subcommand flag descriptions
// ===========================================================================
test.describe("auth flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("all auth flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Provider id",
			"API key",
			"Model id",
			"Base URL",
			"configuration directory",
		]);
	});
});

// ===========================================================================
// Config subcommand flag descriptions
// ===========================================================================
test.describe("config flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("config --config flag description", async ({ terminal }) => {
		await expectVisible(terminal, "configuration directory");
	});
});

// ===========================================================================
// Update subcommand flag descriptions
// ===========================================================================
test.describe("update flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("update --verbose flag description", async ({ terminal }) => {
		await expectVisible(terminal, "verbose output");
	});
});
