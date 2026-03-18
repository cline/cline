// ---------------------------------------------------------------------------
// CLI Interactive use cases — main chat view
//
// Covers:
//   - `cline` launches interactive view (authed / unauthed)
//   - /settings navigation and tab verification
//   - /models view
//   - /history view
//   - /skills view
//   - Plan/Act mode toggle (Tab)
//   - Plan task → toggle to Act → task executes
//   - Act task → file edit permission prompt → Save / Reject
//   - Task completed → Start New Task / Exit buttons
//   - Auto-approve settings
//   - Subagents
//   - Web tools
//   - Auto-approve all (Shift+Tab)
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test"
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js"
import { clineEnv } from "../helpers/env.js"
import {
	openHistory,
	openModels,
	openSettings,
	openSkills,
	toggleAutoApproveAll,
	togglePlanAct,
	waitForChatReady,
} from "../helpers/page-objects/chat.js"
import {
	assertApiTab,
	assertAutoApproveTab,
	assertFeaturesTab,
	assertOtherTab,
	goToSettingsTab,
} from "../helpers/page-objects/settings.js"
import { expectVisible } from "../helpers/terminal.js"

// ---------------------------------------------------------------------------
// cline (unauthenticated) → shows interactive auth view
// ---------------------------------------------------------------------------
test.describe("cline (unauthenticated) — shows auth view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	})

	test("shows interactive auth view when not authenticated", async ({ terminal }) => {
		await expectVisible(terminal, /sign in|authenticate|api key/i, {
			timeout: 10_000,
		})
	})
})

// ---------------------------------------------------------------------------
// cline (authenticated) → shows main chat view
// ---------------------------------------------------------------------------
test.describe("cline (authenticated) — shows chat view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test("shows interactive chat view", async ({ terminal }) => {
		await waitForChatReady(terminal)
	})
})

// ---------------------------------------------------------------------------
// /settings — tab navigation
// ---------------------------------------------------------------------------
test.describe("/settings — tab navigation", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test("opens settings and shows API tab by default", async ({ terminal }) => {
		await openSettings(terminal)
		await assertApiTab(terminal)
	})

	test("can navigate to Auto-approve tab with keyRight", async ({ terminal }) => {
		await openSettings(terminal)
		terminal.keyRight()
		await assertAutoApproveTab(terminal)
	})

	test("can navigate to Features tab", async ({ terminal }) => {
		await openSettings(terminal)
		await goToSettingsTab(terminal, "Features")
		await assertFeaturesTab(terminal)
	})

	test("can navigate to Other tab", async ({ terminal }) => {
		await openSettings(terminal)
		await goToSettingsTab(terminal, "Other")
		await assertOtherTab(terminal)
	})

	test("pressing Escape closes settings", async ({ terminal }) => {
		await openSettings(terminal)
		terminal.keyEscape()
		await waitForChatReady(terminal)
	})
})

// ---------------------------------------------------------------------------
// /models — browse models
// ---------------------------------------------------------------------------
test.describe("/models — model browser", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test("opens models view with featured models", async ({ terminal }) => {
		await openModels(terminal)
		await expectVisible(terminal, "Browse all models...")
	})

	test("pressing Escape returns to chat view", async ({ terminal }) => {
		await openModels(terminal)
		await expectVisible(terminal, /model|browse/i, { timeout: 5000 })
		terminal.keyEscape()
		await waitForChatReady(terminal)
	})
})

// ---------------------------------------------------------------------------
// /history — task history
// ---------------------------------------------------------------------------
test.describe("/history — task history", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	})

	test("opens history view", async ({ terminal }) => {
		await openHistory(terminal)
		await expectVisible(terminal, /history|task/i)
	})

	test("pressing Escape closes history", async ({ terminal }) => {
		await openHistory(terminal)
		await expectVisible(terminal, /history|task/i)
		terminal.keyEscape()
		await waitForChatReady(terminal)
	})
})

// ---------------------------------------------------------------------------
// /skills — skills view
// ---------------------------------------------------------------------------
test.describe("/skills — skills view", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("opens skills view", async ({ terminal }) => {
		await openSkills(terminal)
		await expectVisible(terminal, "Skills (Esc to close)")
	})

	test("pressing Escape closes skills", async ({ terminal }) => {
		await openSkills(terminal)
		await expectVisible(terminal, "Skills (Esc to close)")
		terminal.keyEscape()
		await waitForChatReady(terminal)
	})
})

// ---------------------------------------------------------------------------
// Plan/Act mode toggle
// ---------------------------------------------------------------------------
test.describe("Plan/Act mode toggle", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("pressing Tab toggles between Plan and Act mode", async ({ terminal }) => {
		await waitForChatReady(terminal)
		// Default should show Act
		await expectVisible(terminal, "○ Plan ● Act")
		await togglePlanAct(terminal)
		// After toggle, the other mode should be active
		await expectVisible(terminal, "● Plan ○ Act")
	})
})

// ---------------------------------------------------------------------------
// Auto-approve all (Shift+Tab)
// ---------------------------------------------------------------------------
test.describe("Auto-approve all — Shift+Tab toggle", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	})

	test("Shift+Tab toggles auto-approve-all setting", async ({ terminal }) => {
		await waitForChatReady(terminal)
		await expectVisible(terminal, "Auto-approve all disabled")
		await toggleAutoApproveAll(terminal)
		// TODO: verify config store is updated
		await expectVisible(terminal, "Auto-approve all enabled")
	})
})
