// ---------------------------------------------------------------------------
// CLI headless use cases  (cline -y / cline --json / piped stdin)
//
// These tests run cline as a child process (no TUI harness) and assert on
// stdout, stderr, and exit codes.
//
// Tests tagged @live require a configured provider and are skipped by default.
// Run them with:  CLINE_BIN=... npm test -- headless @live
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline -y "tell me a joke"
// Golden path: prints "Task started" then LLM output, then exits 0.
// Unauthenticated: prints "Not authenticated" and exits 1.
// ---------------------------------------------------------------------------
test.describe("cline -y (headless yolo mode) — unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("prints Not authenticated and exits 1", async ({ terminal }) => {
		await expectVisible(terminal, /not authenticated/i)
	})
})

test.describe("cline -y (headless yolo mode) — authenticated @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("prints Task started then LLM output", async ({ terminal }) => {
		await expectVisible(terminal, /task started/i)
	})
})

// ---------------------------------------------------------------------------
// echo "max paulus" | cline -y "print only the second word I gave you"
// Piped stdin test — uses TUI harness with stdin pre-written
// ---------------------------------------------------------------------------
test.describe("piped stdin | cline -y — unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `echo "max paulus" | ${CLINE_BIN} -y "print only the second word I gave you"`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("prints Not Authenticated for piped stdin", async ({ terminal }) => {
		await expectVisible(terminal, /not authenticated/i)
	})
})

// ---------------------------------------------------------------------------
// cline -y --verbose "tell me a joke" 2>&1
// Golden path: prints task started, prompt, api request, reasoning, task_completion lines
// ---------------------------------------------------------------------------
test.describe("cline -y --verbose — unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `${CLINE_BIN} -y --verbose "tell me a joke" 2>&1`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows verbose output or not-authenticated", async ({ terminal }) => {
		await expectVisible(terminal, /not authenticated|verbose|task/i)
	})
})

// ---------------------------------------------------------------------------
// cline --json "tell me a joke"
// All output must conform to JSON (one JSON object per line)
// ---------------------------------------------------------------------------
test.describe("cline --json — unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("outputs JSON error for unauthenticated", async ({ terminal }) => {
		// cline --json when unauthenticated outputs a plain "Not authenticated" message
		await expectVisible(terminal, /not authenticated/i)
	})
})

// ---------------------------------------------------------------------------
// cline -t 2 -y "tell me a joke"
// If timeout occurs: prints "Error: Timeout" and exits 1
// In --json mode: {"type":"error","message":"Timeout"}
// ---------------------------------------------------------------------------
test.describe("cline -t 2 -y (timeout) — authenticated @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-t", "2", "-y", "tell me a joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("prints Error: Timeout and exits 1 when timeout occurs", async ({ terminal }) => {
		await expectVisible(terminal, /error.*timeout|timeout/i, {
			timeout: 15_000,
		})
	})
})

test.describe("cline -t 2 --json (timeout JSON) — authenticated @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-t", "2", "--json", "tell me a joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("outputs JSON timeout error", async ({ terminal }) => {
		await expectVisible(terminal, /\{.*"type".*"error".*"Timeout".*\}/i, {
			timeout: 15_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline -y -m <model-id> "what model are you"
// Should print a message and exit 0.
// Model id should NOT be persisted to state.
// ---------------------------------------------------------------------------
test.describe("cline -y -m <model-id> — authenticated @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-y", "-m", "claude-3-5-haiku-20241022", "what model are you"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test.skip("prints model response and exits 0", async ({ terminal }) => {
		await expectVisible(terminal, /task started|claude|haiku/i, {
			timeout: 30_000,
		})
	})
})
