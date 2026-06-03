import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

// ---------------------------------------------------------------------------
// cline --version  (root flag)
// ---------------------------------------------------------------------------
test.describe("cline --version", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints the version string", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// cline -V  (short flag)
// ---------------------------------------------------------------------------
test.describe("cline -V", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-V"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints the version string with short flag", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// cline version  (subcommand)
// ---------------------------------------------------------------------------
test.describe("cline version subcommand", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("prints 'Cline CLI version:' message", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});
