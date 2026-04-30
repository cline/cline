import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

const HELP_TERMINAL = { columns: 120, rows: 50 };

// ===========================================================================
// clite --help  (root help)
// ===========================================================================
test.describe("clite --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows Usage line and lists all subcommands", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"history|h",
			"auth [options]",
			"version",
			"update [options]",
			"dev ",
		]);
	});

	test("shows all root-level option flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"--act",
			"--plan",
			"--timeout",
			"--model",
			"--verbose",
			"--cwd",
			"--config",
			"--thinking",
			"--reasoning-effort",
			"--retries",
			"--json",
			"--acp",
			"--update",
		]);
	});
});

// ===========================================================================
// cline -h  (short help flag)
// ===========================================================================
test.describe("cline -h", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-h"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows Usage line with short flag", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:");
	});
});

// ===========================================================================
// clite history --help
// ===========================================================================
test.describe("clite history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows history usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit", "--page", "--config"]);
	});
});

// ===========================================================================
// cline h --help  (history alias)
// ===========================================================================
test.describe("cline h --help (history alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["h", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows history usage and flags via alias", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit"]);
	});
});

// ===========================================================================
// clite config --help
// ===========================================================================
test.describe("clite config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows config usage and --config flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"]);
	});
});

// ===========================================================================
// clite auth --help
// ===========================================================================
test.describe("clite auth --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows auth usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"--provider",
			"--apikey",
			"--modelid",
			"--baseurl",
			"--config",
		]);
	});
});

// ===========================================================================
// clite version --help
// ===========================================================================
test.describe("clite version --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows version command usage", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:");
	});
});

// ===========================================================================
// clite update --help
// ===========================================================================
test.describe("clite update --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows update usage and --verbose flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--verbose"]);
	});
});

// ===========================================================================
// clite dev --help
// ===========================================================================
test.describe("clite dev --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["dev", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows dev usage and lists log subcommand", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "log"]);
	});
});
