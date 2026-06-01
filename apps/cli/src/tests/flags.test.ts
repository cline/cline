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
			"Run in plan mode",
			"timeout in seconds",
			"Model to use",
			"verbose output",
			"Working directory",
			"Configuration directory",
			"Set reasoning effort level",
			"consecutive mistakes",
			"Output messages as JSON",
			"ACP",
			"Check for updates and install if available",
			"Run the kanban app",
		]);
	});

	test("all short flag aliases are shown", async ({ terminal }) => {
		// `-a` and `-y` are intentionally hidden from help (still accepted at parse time).
		await expectVisible(terminal, ["-p", "-t", "-m", "-v", "-c"]);
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
			"Provider ID",
			"API key",
			"Model ID",
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
