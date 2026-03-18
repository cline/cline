import { test } from "@microsoft/tui-test"
import { CLINE_BIN } from "./helpers/constants.js"
import { assertApiTab, assertAutoApproveTab, assertFeaturesTab, assertOtherTab } from "./helpers/page-objects/settings.js"
import { expectVisible, testEnv, typeAndSubmit } from "./utils.js"

test.describe("cline interactive basics", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: testEnv("default"),
	})

	test("shows logo, prompt, mode toggles, and hints", async ({ terminal }) => {
		await expectVisible(terminal, ["What can I do for you?", "@@@@@@", "Plan", "Act", "@ for files", "Tab"])
	})

	test("shows slash commands after / input", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?")
		await typeAndSubmit(terminal, "/")
		await expectVisible(terminal, ["/help", "/settings", "/models"], {
			timeout: 5000,
		})
	})

	test("opens /settings and navigates tabs with left/right arrows", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?")

		await typeAndSubmit(terminal, "/settings")

		await expectVisible(terminal, "Settings (Esc to close)")

		// API tab (default)
		await assertApiTab(terminal)
		await expectVisible(terminal, "Use separate models for Plan and Act")

		// Auto-approve tab
		terminal.keyRight()
		await assertAutoApproveTab(terminal)

		// Features tab
		terminal.keyRight()
		await assertFeaturesTab(terminal)
		await expectVisible(terminal, ["Strict plan mode", "Native tool call", "Parallel tool calling"])

		// Account tab
		terminal.keyRight()
		await expectVisible(terminal, ["Sign in to access Cline features", "Sign in with Cline"])

		// Other tab
		terminal.keyRight()
		await assertOtherTab(terminal)

		// Left once from Other should move back to Account
		terminal.keyLeft()
		await expectVisible(terminal, "Sign in to access Cline features")

		// Two rights from Account should wrap back to API
		terminal.keyRight()
		await assertOtherTab(terminal)
		terminal.keyRight()
		await assertApiTab(terminal)
	})
})
