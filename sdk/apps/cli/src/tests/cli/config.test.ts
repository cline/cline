// ---------------------------------------------------------------------------
// cline config — CLI tests
//
// Covers:
//   - `cline config --config <dir>` — shows config for specific directory
//   - `cline config --help`         — help page
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

test.describe("cline config (default config)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("shows interactive config view for default config", async ({
		terminal,
	}) => {
		// Config view should display provider/model settings from the default config
		await expectVisible(terminal, /config|settings|provider|model/i);
	});
});

test.describe("cline config --config (claude-sonnet-4.6)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["config", "--config", "configs/claude-sonnet-4.6"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test.skip("shows interactive config view for claude-sonnet-4.6 config", async ({
		terminal,
	}) => {
		// Different config dir should show different configuration
		await expectVisible(terminal, /config|settings|provider|model/i);
	});
});
