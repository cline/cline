// ---------------------------------------------------------------------------
// cline update — CLI tests
//
// Covers:
//   - `cline update --verbose`
//     Shows: "New version available: x.x.x (current: x.x.x). Do you want to update now?"
//     Or:    "You are already on the latest version"
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

test.describe("cline update --verbose", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--verbose"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("shows update status (new version available or already latest)", async ({ terminal }) => {
		// Either "New version available" or "already on the latest version"
		await expectVisible(terminal, /new version available|already on the latest version/i, { timeout: 15_000 })
	})
})
