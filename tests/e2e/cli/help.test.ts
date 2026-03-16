import { test } from "@microsoft/tui-test"
import { CLINE_BIN } from "./helpers/constants.js"
import { expectVisible, testEnv } from "./utils.js"

const HELP_TERMINAL = { columns: 120, rows: 50 }

// ===========================================================================
// cline --help  (root help)
// ===========================================================================
test.describe("cline --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows Usage line and lists all subcommands", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"task|t",
			"history|h",
			"config [options]",
			"auth [options]",
			"version",
			"update [options]",
			"dev ",
		])
	})

	test("shows all root-level option flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"--act",
			"--plan",
			"--yolo",
			"--timeout",
			"--model",
			"--verbose",
			"--cwd",
			"--config",
			"--thinking",
			"--reasoning-effort",
			"--max-consecutive-mistakes",
			"--json",
			"--double-check-completion",
			"--acp",
			"--taskId",
		])
	})
})

// ===========================================================================
// cline -h  (short help flag)
// ===========================================================================
test.describe("cline -h", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-h"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows Usage line with short flag", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
	})
})

// ===========================================================================
// cline task --help
// ===========================================================================
test.describe("cline task --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["task", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows task usage, prompt argument, and all flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"prompt",
			"--act",
			"--plan",
			"--yolo",
			"--timeout",
			"--model",
			"--verbose",
			"--cwd",
			"--config",
			"--thinking",
			"--reasoning-effort",
			"--max-consecutive-mistakes",
			"--json",
			"--double-check-completion",
			"--taskId",
		])
	})
})

// ===========================================================================
// cline t --help  (task alias)
// ===========================================================================
test.describe("cline t --help (task alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["t", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows task usage and flags via alias", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--yolo"])
	})
})

// ===========================================================================
// cline history --help
// ===========================================================================
test.describe("cline history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows history usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit", "--page", "--config"])
	})
})

// ===========================================================================
// cline h --help  (history alias)
// ===========================================================================
test.describe("cline h --help (history alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["h", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows history usage and flags via alias", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit"])
	})
})

// ===========================================================================
// cline config --help
// ===========================================================================
test.describe("cline config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows config usage and --config flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"])
	})
})

// ===========================================================================
// cline auth --help
// ===========================================================================
test.describe("cline auth --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows auth usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"--provider",
			"--apikey",
			"--modelid",
			"--baseurl",
			"--verbose",
			"--cwd",
			"--config",
		])
	})
})

// ===========================================================================
// cline version --help
// ===========================================================================
test.describe("cline version --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows version command usage", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
	})
})

// ===========================================================================
// cline update --help
// ===========================================================================
test.describe("cline update --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows update usage and --verbose flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--verbose"])
	})
})

// ===========================================================================
// cline dev --help
// ===========================================================================
test.describe("cline dev --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["dev", "--help"] },
		env: testEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	})

	test("shows dev usage and lists log subcommand", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "log"])
	})
})
