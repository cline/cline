// ---------------------------------------------------------------------------
// clite config - CLI tests
//
// Covers:
//   - `clite config --config <dir>` - shows config for specific directory
//   - `clite config --help`         - help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectVisible } from "../helpers/terminal.js";

test.describe("clite config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("shows config help page", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"]);
	});
});
