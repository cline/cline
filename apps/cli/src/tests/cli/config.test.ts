// ---------------------------------------------------------------------------
// cline config - CLI tests
//
// Covers:
//   - `cline config --config <dir>` - shows config for specific directory
//   - `cline config --help`         - help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectVisible } from "../helpers/terminal.js";

test.describe("cline config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("shows config help page", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"]);
	});
});
