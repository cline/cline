// ---------------------------------------------------------------------------
// CLI flag behavioral tests
//
// These tests verify the runtime behavior of each CLI flag — not just that
// the flag appears in --help output (that's covered in tests/flags.test.ts),
// but that the flag actually changes what cline does.
//
// Tests marked ⚠️ in the spec reflect known gaps where the flag is accepted
// but currently has no observable effect. They are still written so the
// behavior can be asserted once the implementation catches up.
//
// Tests tagged @live require a configured provider and are skipped by default.
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../utils.js"

// ---------------------------------------------------------------------------
// cline --act
// Starts cline in Act mode regardless of globalState
// ---------------------------------------------------------------------------
test.describe("cline --act", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--act"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts in Act mode", async ({ terminal }) => {
		await expectVisible(terminal, "Act", { timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// cline --plan
// Starts cline in Plan mode regardless of globalState
// ---------------------------------------------------------------------------
test.describe("cline --plan", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--plan"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts in Plan mode", async ({ terminal }) => {
		await expectVisible(terminal, "Plan", { timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// cline --timeout <n>  ⚠️
// Current behavior: starts interactive mode and ignores timeout value
// ---------------------------------------------------------------------------
test.describe("cline --timeout (interactive mode, flag ignored) ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--timeout", "30"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode (timeout value currently ignored)", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --model <model-id>  ⚠️
// Current behavior: starts interactive mode and ignores model value
// ---------------------------------------------------------------------------
test.describe("cline --model (interactive mode, flag ignored) ⚠️", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--model", "claude-3-5-haiku-20241022"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode (model value currently ignored)", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --verbose  ⚠️
// Current behavior: starts interactive mode and ignores verbose value
// ---------------------------------------------------------------------------
test.describe("cline --verbose (interactive mode, flag ignored) ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--verbose"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode (verbose value currently ignored)", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline -c / cline --cwd <dir>  ⚠️
// Starts cline in interactive mode with the cwd present in the client footer
// ---------------------------------------------------------------------------
test.describe("cline --cwd <dir>", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--cwd", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with --cwd flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})

	test.skip("shows /tmp in the client footer ⚠️", async ({ terminal }) => {
		// TODO: assert /tmp appears in footer once --cwd is wired to the footer
		await expectVisible(terminal, /tmp/, { timeout: 10_000 })
	})
})

test.describe("cline -c <dir> (short alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-c", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with -c flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --config <dir>
// Starts cline in interactive mode using settings from the custom config dir
// ---------------------------------------------------------------------------
test.describe("cline --config (claude-sonnet-4.6)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--config", "configs/claude-sonnet-4.6"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test("starts interactive mode with custom config directory", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --thinking  ⚠️
// Starts cline in interactive mode with thinking turned on regardless of globalState
// (if thinking not supported, this flag is a no-op)
// ---------------------------------------------------------------------------
test.describe("cline --thinking ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--thinking"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with --thinking flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --reasoning-effort <level>  ⚠️
// Starts cline in interactive mode with reasoning turned on regardless of globalState
// (if reasoning not supported, this flag is a no-op)
// ---------------------------------------------------------------------------
test.describe("cline --reasoning-effort ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--reasoning-effort", "high"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with --reasoning-effort flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --max-consecutive-mistakes <n>
// ---------------------------------------------------------------------------
test.describe("cline --max-consecutive-mistakes", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--max-consecutive-mistakes", "5"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with --max-consecutive-mistakes flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --double-check-completion
// ---------------------------------------------------------------------------
test.describe("cline --double-check-completion", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--double-check-completion"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with --double-check-completion flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline --acp
// Starts cline in headless ACP mode
// ---------------------------------------------------------------------------
test.describe("cline --acp", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--acp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test.skip("starts cline in headless ACP mode", async ({ terminal }) => {
		// TODO: define expected ACP mode output/behavior
		await expectVisible(terminal, /acp|ready/i, { timeout: 10_000 })
	})
})

// ---------------------------------------------------------------------------
// cline -T / cline --taskId <id>
// Starts cline in interactive mode pre-populated with the conversation for <taskId>
// ---------------------------------------------------------------------------
test.describe("cline --taskId (valid task)", () => {
	// Use the claude-sonnet-4.6 fixture which has real task history
	const KNOWN_TASK_ID = "1772581042933"

	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--taskId", KNOWN_TASK_ID],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("starts interactive mode pre-populated with task conversation @live", async ({ terminal }) => {
		// TODO: assert conversation history is shown for the given taskId
		await expectVisible(terminal, /what can i do|plan|act|task/i, {
			timeout: 10_000,
		})
	})
})

test.describe("cline -T (short alias for --taskId)", () => {
	const KNOWN_TASK_ID = "1772581042933"

	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-T", KNOWN_TASK_ID],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("starts interactive mode pre-populated with task conversation @live", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act|task/i, {
			timeout: 10_000,
		})
	})
})
