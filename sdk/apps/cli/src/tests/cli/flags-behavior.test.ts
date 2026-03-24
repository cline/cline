// ---------------------------------------------------------------------------
// CLI flag behavioral tests
//
// These tests verify the runtime behavior of each CLI flag — not just that
// the flag appears in --help output (that's covered in tests/flags.test.ts),
// but that the flag actually changes what cline does.
//
// Tests marked ⚠️ in the spec reflect known gaps where the flag is accepted
// but currently has no observable effect. They are still written so the
// behavior can be asserted once the implementation catches up.
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { waitForChatReady } from "../helpers/page-objects/chat.js";
import { expectVisible } from "../helpers/terminal.js";

test.describe("cline --act", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--act"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("starts in Act mode", async ({ terminal }) => {
		await expectVisible(terminal, "○ Plan ● Act");
	});
});

test.describe("cline --plan", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--plan"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("starts in Plan mode", async ({ terminal }) => {
		await expectVisible(terminal, "● Plan ○ Act");
	});
});

test.describe("cline --model (interactive mode, flag ignored) ⚠️", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--model", "openai/gpt-5.3-codex"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("starts interactive mode", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "openai/gpt-5.3-codex");
	});
});

test.describe("cline --cwd <dir>", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--cwd", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("starts interactive mode with --cwd flag", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "tmp");
	});
});

test.describe("cline -c <dir> (short alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-c", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test("starts interactive mode with -c flag", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, "tmp");
	});
});

test.describe("cline --config (claude-sonnet-4.6)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--config", "configs/claude-sonnet-4.6"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});

	test("starts interactive mode with custom config directory", async ({
		terminal,
	}) => {
		await expectVisible(terminal, "anthropic/claude-sonnet-4.6");
	});
});

// ---------------------------------------------------------------------------
// cline --json "prompt"
// Starts cline in headless yolo mode with all output conforming to JSON
// ---------------------------------------------------------------------------
test.describe("cline --json (headless yolo mode)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("starts in headless yolo mode with JSON output", async ({
		terminal,
	}) => {
		// --json implies headless yolo; unauthenticated should produce a JSON error line
		await expectVisible(terminal, /Missing API key/i);
	});
});
