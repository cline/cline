import { expect, test } from "@microsoft/tui-test"
import { CLINE_BIN } from "./helpers/constants.js"
import { expectVisible, sleep, testEnv, typeAndSubmit } from "./utils.js"

test.describe("cline interactive basics", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: testEnv("default"),
	})

	test("shows logo, prompt, mode toggles, and hints", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?")
		await expectVisible(terminal, "@@@@@@")
		await expectVisible(terminal, "Plan")
		await expectVisible(terminal, "Act")
		await expectVisible(terminal, "@ for files")
		await expectVisible(terminal, "Tab")
	})

	test("matches terminal snapshot", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?")
		await expect(terminal).toMatchSnapshot()
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

		// API tab
		await expectVisible(terminal, [
			"API  Auto-approve  Features  Account  Other",
			"Provider:",
			"Model ID:",
			"Use separate models for Plan and Act",
		])

		// Auto-approve tab
		terminal.keyRight()
		await sleep(300)
		await expectVisible(terminal, [
			"Read project files",
			"Execute safe commands",
			"Edit project files",
			"Execute safe commands",
		])

		// Features tab
		terminal.keyRight()
		await sleep(300)
		await expectVisible(terminal, [
			"Subagents",
			"Auto-condense",
			"Web tools",
			"Strict plan mode",
			"Native tool call",
			"Parallel tool calling",
			"Double-check completion",
		])

		// Account tab
		terminal.keyRight()
		await sleep(300)
		// default config is not signed in to cline
		await expectVisible(terminal, ["Sign in to access Cline features", "Sign in with Cline"])

		// Other tab
		terminal.keyRight()
		await sleep(300)
		await expectVisible(terminal, ["Preferred language:", "Cline v"])

		// Left once from Other should move back to Account
		terminal.keyLeft()
		await sleep(300)
		await expectVisible(terminal, "Sign in to access Cline features")

		terminal.keyRight()
		await sleep(300)
		terminal.keyRight()
		await expectVisible(terminal, "Provider")
	})
})

test.skip("cline interactive prompt submission", () => {
	test.use({
		program: { file: CLINE_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: testEnv("claude-sonnet-4.6"),
	})

	test("submits 'just say hello' and LLM responds with 'hello'", async ({ terminal }) => {
		await expectVisible(terminal, "What can I do for you?")

		await typeAndSubmit(terminal, "just say hello")

		await expectVisible(terminal, ["Start New Task", "Exit"], {
			timeout: 10000,
		})

		await typeAndSubmit(terminal, "now say goodbye")

		await expectVisible(terminal, "Acting...")
		await expectVisible(terminal, ["Start New Task", "Exit"], {
			timeout: 10000,
		})
	})
})
