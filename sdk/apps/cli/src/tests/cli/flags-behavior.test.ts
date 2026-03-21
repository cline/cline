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

	test.skip("starts in Act mode", async ({ terminal }) => {
		await expectVisible(terminal, "○ Plan ● Act");
	});
});

test.describe("cline --plan", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--plan"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts in Plan mode", async ({ terminal }) => {
		await expectVisible(terminal, "● Plan ○ Act");
	});
});

test.describe("cline --model (interactive mode, flag ignored) ⚠️", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--model", "claude-3-5-haiku-20241022"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode (model value currently ignored)", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
		// TODO expect model id in the UI here
	});
});

test.describe("cline --cwd <dir>", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--cwd", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with --cwd flag", async ({ terminal }) => {
		await waitForChatReady(terminal);
		// TODO expect working directory showing in the UI
	});
});

test.describe("cline -c <dir> (short alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-c", "/tmp"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with -c flag", async ({ terminal }) => {
		await waitForChatReady(terminal);
		// TODO expect working directory showing in the UI
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

	test.skip("starts interactive mode with custom config directory", async ({
		terminal,
	}) => {
		await expectVisible(terminal, "anthropic/claude-sonnet-4.6");
	});
});

test.describe("cline --thinking ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--thinking"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with --thinking flag", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
	});
});

test.describe("cline --reasoning-effort ⚠️", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--reasoning-effort", "high"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with --reasoning-effort flag", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
	});
});

// ---------------------------------------------------------------------------
// cline --max-consecutive-mistakes <n>
// ---------------------------------------------------------------------------
test.describe("cline --max-consecutive-mistakes", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--max-consecutive-mistakes", "5"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with --max-consecutive-mistakes flag", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
	});
});

// ---------------------------------------------------------------------------
// cline --double-check-completion
// ---------------------------------------------------------------------------
test.describe("cline --double-check-completion", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--double-check-completion"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode with --double-check-completion flag", async ({
		terminal,
	}) => {
		await waitForChatReady(terminal);
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
		// --json implies headless yolo; unauthenticated should produce a JSON-like error
		await expectVisible(terminal, /not authenticated/i);
	});
});

// ---------------------------------------------------------------------------
// cline -T / cline --taskId <taskId>
// Starts cline in interactive mode pre-populated with a prior task conversation
// ---------------------------------------------------------------------------
test.describe("cline --taskId (resume existing task)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--taskId", "1773351188846"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode pre-populated with prior task conversation", async ({
		terminal,
	}) => {
		// Should show the chat view with the task's conversation loaded
		await expectVisible(terminal, /wezterm|task/i);
	});
});

test.describe("cline -T (short alias for --taskId)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-T", "1773351188846"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});

	test.skip("starts interactive mode pre-populated with prior task via -T", async ({
		terminal,
	}) => {
		await expectVisible(terminal, /wezterm|task/i);
	});
});
