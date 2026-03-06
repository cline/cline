import { test } from "@microsoft/tui-test"
import { CLINE_BIN } from "./helpers/constants.js"
import { expectVisible, testEnv } from "./utils.js"

const HELP_TERMINAL = { columns: 120, rows: 50 }

// ===========================================================================
// Root-level flag descriptions
// ===========================================================================
test.describe("root flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("all root flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, "Run in act mode")
		await expectVisible(terminal, "Run in plan mode")
		await expectVisible(terminal, "yolo mode")
		await expectVisible(terminal, "timeout in seconds")
		await expectVisible(terminal, "Model to use")
		await expectVisible(terminal, "verbose output")
		await expectVisible(terminal, "Working directory")
		await expectVisible(terminal, "Configuration directory")
		await expectVisible(terminal, "extended thinking")
		await expectVisible(terminal, "Reasoning effort")
		await expectVisible(terminal, "consecutive mistakes")
		await expectVisible(terminal, "Output messages as JSON")
		await expectVisible(terminal, "first completion attempt")
		await expectVisible(terminal, "ACP")
		await expectVisible(terminal, "Resume an existing task")
	})

	test("all short flag aliases are shown", async ({ terminal }) => {
		await expectVisible(terminal, "-a")
		await expectVisible(terminal, "-p")
		await expectVisible(terminal, "-y")
		await expectVisible(terminal, "-t")
		await expectVisible(terminal, "-m")
		await expectVisible(terminal, "-v")
		await expectVisible(terminal, "-c")
		await expectVisible(terminal, "-T")
	})
})

// ===========================================================================
// Task subcommand flag descriptions
// ===========================================================================
test.describe("task flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["task", "--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("all task flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, "Run in act mode")
		await expectVisible(terminal, "Run in plan mode")
		await expectVisible(terminal, "yolo mode")
		await expectVisible(terminal, "timeout in seconds")
		await expectVisible(terminal, "Model to use")
		await expectVisible(terminal, "verbose output")
		await expectVisible(terminal, "Working directory")
		await expectVisible(terminal, "configuration directory")
		await expectVisible(terminal, "extended thinking")
		await expectVisible(terminal, "Reasoning effort")
		await expectVisible(terminal, "consecutive mistakes")
		await expectVisible(terminal, "Output messages as JSON")
		await expectVisible(terminal, "first completion attempt")
		await expectVisible(terminal, "Resume an existing task")
	})
})

// ===========================================================================
// History subcommand flag descriptions
// ===========================================================================
test.describe("history flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("all history flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, "Number of tasks to show")
		await expectVisible(terminal, "Page number")
		await expectVisible(terminal, "configuration directory")
	})
})

// ===========================================================================
// Auth subcommand flag descriptions
// ===========================================================================
test.describe("auth flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("all auth flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, "Provider ID")
		await expectVisible(terminal, "API key")
		await expectVisible(terminal, "Model ID")
		await expectVisible(terminal, "Base URL")
		await expectVisible(terminal, "verbose output")
		await expectVisible(terminal, "Working directory")
		await expectVisible(terminal, "configuration directory")
	})
})

// ===========================================================================
// Config subcommand flag descriptions
// ===========================================================================
test.describe("config flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("config --config flag description", async ({ terminal }) => {
		await expectVisible(terminal, "configuration directory")
	})
})

// ===========================================================================
// Update subcommand flag descriptions
// ===========================================================================
test.describe("update flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: testEnv("default"),
		...HELP_TERMINAL,
	})

	test("update --verbose flag description", async ({ terminal }) => {
		await expectVisible(terminal, "verbose output")
	})
})
