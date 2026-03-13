// ---------------------------------------------------------------------------
// cline history — CLI tests
//
// Covers:
//   - `cline history --limit X`  — pagination limit
//   - `cline history --page N`   — page selection
//   - `cline history --config`   — custom config directory
//   - `cline history --help`     — help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline history --help
// ---------------------------------------------------------------------------
test.describe("cline history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("shows history help page with all flags", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
		await expectVisible(terminal, "--limit")
		await expectVisible(terminal, "--page")
		await expectVisible(terminal, "--config")
	})
})
