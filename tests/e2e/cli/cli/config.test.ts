// ---------------------------------------------------------------------------
// cline config — CLI tests
//
// Covers:
//   - `cline config --config <dir>` — shows config for specific directory
//   - `cline config --help`         — help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline config --help
// ---------------------------------------------------------------------------
test.describe("cline config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("shows config help page", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
		await expectVisible(terminal, "--config")
	})
})

// ---------------------------------------------------------------------------
// cline config --config <dir>
// Shows interactive config view for the specified directory
// ---------------------------------------------------------------------------
test.describe("cline config (default config)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test.skip("shows interactive config view", async ({ terminal }) => {
		// TODO: assert config view content once the fixture is stable
		await expectVisible(terminal, /config/i, { timeout: 5000 })
	})
})

test.describe("cline config --config (claude-sonnet-4.6)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["config", "--config", "configs/claude-sonnet-4.6"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("shows config for claude-sonnet-4.6 directory", async ({ terminal }) => {
		// TODO: assert provider/model shown matches claude-sonnet-4.6 globalState
		await expectVisible(terminal, /claude/i, { timeout: 5000 })
	})
})
