import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

// ---------------------------------------------------------------------------
// clite --version  (root flag)
// ---------------------------------------------------------------------------
test.describe("clite --version", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints the version string", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// clite -V  (short flag)
// ---------------------------------------------------------------------------
test.describe("clite -V", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-V"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints the version string with short flag", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// clite version  (subcommand)
// ---------------------------------------------------------------------------
test.describe("clite version subcommand", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints 'Cline CLI version:' message", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});
