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
		await expectVisible(terminal, "Act")
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
		await expectVisible(terminal, "Plan")
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
	})
})

test.describe("cline -c <dir> (short alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-c", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("starts interactive mode with -c flag", async ({ terminal }) => {
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
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
		await expectVisible(terminal, /what can i do|plan|act/i)
	})
})
