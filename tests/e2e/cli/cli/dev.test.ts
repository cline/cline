// ---------------------------------------------------------------------------
// cline dev — CLI tests
//
// Covers:
//   - `cline dev log`
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

test.describe("cline dev log", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["dev", "log"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test.skip("shows dev log output", async ({ terminal }) => {
		// TODO: define expected output format for `cline dev log`
		await expectVisible(terminal, /log|dev/i, { timeout: 5000 })
	})
})
