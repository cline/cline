// ---------------------------------------------------------------------------
// cline history — CLI tests
//
// Covers:
//   - `cline history --limit X`  — pagination limit
//   - `cline history --page N`   — page selection
//   - `cline history --config`   — custom config directory
//   - `cline history --help`     — help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline history --help
// ---------------------------------------------------------------------------
test.describe("cline history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("shows history help page with all flags", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:")
		await expectVisible(terminal, "--limit")
		await expectVisible(terminal, "--page")
		await expectVisible(terminal, "--config")
	})
})

// ---------------------------------------------------------------------------
// cline history --limit X
// (requires seeded history fixture — see configs/history-9-items)
// ---------------------------------------------------------------------------
test.describe("cline history --limit 3 (seeded 9 items)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--limit", "3"] },
		...TERMINAL_WIDE,
		env: clineEnv("history-9-items"),
	})

	test.skip("shows first page of 3 results", async ({ terminal }) => {
		// TODO: seed history-9-items fixture and assert pagination
		await expectVisible(terminal, /1.*of.*3/i, { timeout: 5000 })
	})
})

// ---------------------------------------------------------------------------
// cline history --page N
// (requires seeded history fixture — see configs/history-25-items)
// ---------------------------------------------------------------------------
test.describe("cline history --page 2 (seeded 25 items)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["history", "--page", "2", "--limit", "10"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("history-25-items"),
	})

	test.skip("shows entries 11-20 for page 2", async ({ terminal }) => {
		// TODO: seed history-25-items fixture and assert page 2 content
		await expectVisible(terminal, /page 2/i, { timeout: 5000 })
	})
})

// ---------------------------------------------------------------------------
// cline history --config <dir>
// Different config dirs should show different histories
// ---------------------------------------------------------------------------
test.describe("cline history --config (custom config dir)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["history", "--config", "configs/default"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test.skip("shows history for the specified config directory", async ({ terminal }) => {
		// TODO: assert history content specific to the config dir
		await expectVisible(terminal, /history/i, { timeout: 5000 })
	})
})
