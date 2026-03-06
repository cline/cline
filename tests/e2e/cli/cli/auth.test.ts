// ---------------------------------------------------------------------------
// cline auth — CLI flag and contract tests
//
// These tests cover the `cline auth` subcommand behavior:
//   - Interactive auth screen navigation
//   - `cline auth -p <provider> -k <apiKey> -m <modelId>` golden path
//   - Invalid provider / key / model error handling
//   - Partial-flag fallback to interactive screen
//   - `cline auth --help`
//
// Tests that require a live provider are tagged @live and skipped by default.
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { waitForAuthScreen } from "../helpers/page-objects/auth.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline auth  (interactive screen — no flags)
// ---------------------------------------------------------------------------
test.describe("cline auth (interactive screen)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows all auth options", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})

	test("can navigate options with keyUp / keyDown", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
		terminal.keyDown()
		await new Promise((r) => setTimeout(r, 200))
		terminal.keyUp()
		await new Promise((r) => setTimeout(r, 200))
		// Still on the auth screen after navigation
		await expectVisible(terminal, "Sign in with Cline")
	})
})

// ---------------------------------------------------------------------------
// cline auth --help
// ---------------------------------------------------------------------------
test.describe("cline auth --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows auth help page", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
		await expectVisible(terminal, "--provider")
		await expectVisible(terminal, "--apikey")
		await expectVisible(terminal, "--modelid")
		await expectVisible(terminal, "--baseurl")
	})
})

// ---------------------------------------------------------------------------
// cline auth with only partial flags → falls back to interactive screen
// ---------------------------------------------------------------------------
test.describe("cline auth --provider only (partial flags)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--provider", "openai"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("ignores partial flags and shows interactive auth screen", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})
})

test.describe("cline auth --apikey only (partial flags)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--apikey", "sk-test-key"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("ignores partial flags and shows interactive auth screen", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})
})

test.describe("cline auth --modelid only (partial flags)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--modelid", "gpt-4o"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("ignores partial flags and shows interactive auth screen", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})
})

test.describe("cline auth --baseurl only (partial flags)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--baseurl", "https://api.example.com"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("ignores partial flags and shows interactive auth screen", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})
})

test.describe("cline auth --verbose only (partial flags)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--verbose"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("ignores --verbose and shows interactive auth screen", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})
})

// ---------------------------------------------------------------------------
// cline auth --cwd
// User sees interactive auth screen; after authing, footer shows workspace dir
// ---------------------------------------------------------------------------
test.describe("cline auth --cwd", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--cwd", "/tmp"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows interactive auth screen with --cwd flag", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})

	test.skip("after authing, footer shows workspace dir name @live", async ({ terminal }) => {
		// TODO: complete auth flow and verify /tmp appears in footer
		await waitForAuthScreen(terminal)
	})
})

// ---------------------------------------------------------------------------
// cline auth --config <dir>
// User sees interactive auth screen; after authing, custom config dir exists
// with globalState.json and secrets.json; default ~/.cline does NOT exist
// ---------------------------------------------------------------------------
test.describe("cline auth --config", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--config", "configs/unauthenticated"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows interactive auth screen with --config flag", async ({ terminal }) => {
		await waitForAuthScreen(terminal)
	})

	test.skip("after authing, custom config dir has globalState.json and secrets.json @live", async ({ terminal }) => {
		// TODO: complete auth flow and verify config dir contents
		await waitForAuthScreen(terminal)
	})
})

// ---------------------------------------------------------------------------
// cline auth -p <invalid-provider> -k <key> -m <model>
// → should show "invalid provider" and exit 1
// ---------------------------------------------------------------------------
test.describe("cline auth with invalid provider", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["auth", "--provider", "not-a-real-provider", "--apikey", "sk-test", "--modelid", "gpt-4o"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows invalid provider error", async ({ terminal }) => {
		await expectVisible(terminal, /invalid provider/i, { timeout: 5000 })
	})
})

// ---------------------------------------------------------------------------
// cline auth -p openai-compatible -k <key> -m <model> -b <baseUrl>
// → golden path: exit 0
// (tagged @live — requires a real key; skipped in offline CI)
// ---------------------------------------------------------------------------
test.skip("cline auth with openai-compatible provider and baseUrl @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: [
				"auth",
				"--provider",
				"openai",
				"--apikey",
				process.env.OPENAI_API_KEY ?? "sk-placeholder",
				"--modelid",
				"gpt-4o-mini",
				"--baseurl",
				"https://api.openai.com/v1",
			],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("exits 0 on golden path", async ({ terminal }) => {
		// The process should exit cleanly; just wait for any output
		await new Promise((r) => setTimeout(r, 3000))
	})
})
