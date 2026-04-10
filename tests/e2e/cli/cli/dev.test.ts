// ---------------------------------------------------------------------------
// cline dev — CLI tests
//
// Covers:
//   - `cline dev log`
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"

test.describe("cline dev log", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["dev", "log"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})
})
