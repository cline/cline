// ---------------------------------------------------------------------------
// CLI headless use cases  (cline -y / cline --json / piped stdin)
//
// These tests run cline as a child process (no TUI harness) and assert on
// stdout, stderr, and exit codes.
//
// Tests tagged @live require a configured provider and are skipped by default.
// Run them with:  CLINE_BIN=... npm test -- headless @live
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import {
	CLINE_BIN,
	EXIT_CODE_FAIL,
	EXIT_CODE_SUCCESS,
	TERMINAL_WIDE,
} from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectExitCode, expectVisible } from "../helpers/terminal.js";

// ---------------------------------------------------------------------------
// cline -y "tell me a joke"
// Golden path: prints only LLM output (no chrome), then exits 0.
// Unauthenticated: prints "Not authenticated" and exits 1.
// ---------------------------------------------------------------------------
test.describe("cline -y (headless yolo mode) — unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("prints Not authenticated and exits 1", async ({ terminal }) => {
		await expectVisible(terminal, /Missing API key/i);
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

// ---------------------------------------------------------------------------
// echo "max paulus" | cline -y "print only the second word I gave you"
// Piped stdin test — uses TUI harness with stdin pre-written
// ---------------------------------------------------------------------------
test.describe("piped stdin | cline -y — unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: [
				"-c",
				`echo "max paulus" | ${CLINE_BIN} -y "print only the second word I gave you"`,
			],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("prints Not Authenticated for piped stdin", async ({ terminal }) => {
		await expectVisible(terminal, /Missing API key/i);
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

// ---------------------------------------------------------------------------
// cline -y --verbose "tell me a joke" 2>&1
// Golden path: prints model info, prompt, api request, reasoning, task_completion lines
// ---------------------------------------------------------------------------
test.describe("cline -y --verbose — unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `${CLINE_BIN} -y --verbose "tell me a joke" 2>&1`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("shows verbose output or not-authenticated", async ({ terminal }) => {
		await expectVisible(terminal, /Missing API key/i);
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

// ---------------------------------------------------------------------------
// cline --json "tell me a joke"
// All output must conform to JSON (one JSON object per line)
// ---------------------------------------------------------------------------
test.describe("cline --json — unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("outputs JSON error for unauthenticated", async ({ terminal }) => {
		// cline --json when unauthenticated outputs a plain "unauthorized" message
		await expectVisible(terminal, /{"type":"error"/i);
		await expectVisible(terminal, /Missing API key/i);
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

test.describe("cline -y (headless yolo mode) — authenticated @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-yolo-basic.json",
		}),
	});

	test("prints only LLM output", async ({ terminal }) => {
		// In headless non-verbose mode, only the LLM response text is printed.
		await expectVisible(terminal, /why/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);
	});
});

// ---------------------------------------------------------------------------
// echo "max paulus" | cline -y "..." — authenticated
// Piped stdin test with valid credentials
// ---------------------------------------------------------------------------
test.describe("piped stdin | cline -y — authenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: [
				"-c",
				`echo "butterfly horse country" | ${CLINE_BIN} -y "print only the second word I gave you"`,
			],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-piped-stdin.json",
		}),
	});

	test("prints only LLM output for piped stdin", async ({ terminal }) => {
		// In headless non-verbose mode, only the LLM response text is printed.
		await expectVisible(terminal, /horse/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);
	});
});

// ---------------------------------------------------------------------------
// cline -y --verbose "tell me a joke" 2>&1 — authenticated
// Golden path: prints model info, prompt, api request, reasoning, task_completion
// ---------------------------------------------------------------------------
test.describe("cline -y --verbose — authenticated @live", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `${CLINE_BIN} -y --verbose "tell me a joke" 2>&1`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-verbose.json",
		}),
	});

	test("shows verbose output with model info and LLM response", async ({
		terminal,
	}) => {
		// In verbose mode, extra chrome like model info is printed.
		await expectVisible(terminal, /\[model\]/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);
	});
});

// ---------------------------------------------------------------------------
// cline --json "tell me a joke" — authenticated
// All output must conform to JSON (one JSON object per line)
// ---------------------------------------------------------------------------
test.describe("cline --json — authenticated @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-json.json",
		}),
	});

	test("outputs JSON-formatted messages", async ({ terminal }) => {
		await expectVisible(terminal, /\{.*"type"/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);
	});
});

// ---------------------------------------------------------------------------
// cline -t 2 -y "tell me a joke"
// Timeout: should print "Error: Timeout" and exit 1
// ---------------------------------------------------------------------------
test.describe("cline -t (timeout) — headless yolo", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-t", "2", "-y", "tell me a long detailed joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-timeout.json",
		}),
	});

	test("prints timeout error when timeout exceeded", async ({ terminal }) => {
		await expectVisible(terminal, /timed out|timeout/i, { timeout: 15_000 });
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

test.describe("cline --json -t (timeout) — JSON mode", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--json", "-t", "2", "tell me a long detailed joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-json-timeout.json",
		}),
	});

	test("outputs JSON timeout error", async ({ terminal }) => {
		await expectVisible(terminal, /timeout/i, { timeout: 15_000 });
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

// ---------------------------------------------------------------------------
// cline -y -m <model-id> "what model are you"
// Model flag in headless mode — should use specified model but not persist
// ---------------------------------------------------------------------------
test.describe("cline -y -m (model flag in headless) @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-y", "-m", "anthropic/claude-sonnet-4", "what model are you"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-model-flag.json",
		}),
	});

	test("prints a message and exits 0 with --model flag", async ({
		terminal,
	}) => {
		await expectVisible(terminal, /Cline/i);
		await expectExitCode(terminal, EXIT_CODE_SUCCESS);
	});
});
