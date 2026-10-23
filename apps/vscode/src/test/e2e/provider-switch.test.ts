import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

function readSessionManifests(clineDir: string): Array<{ id: string; provider: string }> {
	const sessionsDir = path.join(clineDir, "data", "sessions")
	try {
		return readdirSync(sessionsDir).map((id) => {
			const record = JSON.parse(readFileSync(path.join(sessionsDir, id, `${id}.json`), "utf8"))
			return { id, provider: record.provider }
		})
	} catch {
		return []
	}
}

// A mid-task provider switch restarts the session under the same id, and the
// SDK's resume path reuses the existing on-disk manifest wholesale — so
// without the coordinator's post-restart connection sync, the record keeps
// the provider the task STARTED with forever, and everything keyed on it
// (history cost display, session listings) reports the wrong provider.
e2e("Provider switch - mid-task switch updates the session manifest", async ({ app, page, helper, server: _server }, testInfo) => {
	testInfo.setTimeout(120_000)
	const clineDir = (await app.evaluate(() => process.env.CLINE_DIR)) as string
	expect(clineDir).toBeTruthy()

	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await helper.signin(sidebar)

	// Run a task on the mock cline provider and let the turn complete.
	const inputbox = sidebar.getByTestId("chat-input")
	await inputbox.fill("Hello, Cline!")
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText("mock Cline API response")).toBeVisible()

	// The persisted session record starts out on the cline provider.
	await expect.poll(() => readSessionManifests(clineDir).map((s) => s.provider)).toContain("cline")
	const before = readSessionManifests(clineDir)

	// Switch to OpenRouter mid-task via the settings view (the chat
	// model-picker button opens it).
	await sidebar.getByRole("button", { name: /^cline:/ }).click({ delay: 100 })
	const providerSelectorInput = sidebar.getByTestId("provider-selector-input")
	await expect(providerSelectorInput).toBeVisible()
	await providerSelectorInput.click({ delay: 100 })
	await sidebar.getByTestId("provider-option-openrouter").click({ delay: 100 })
	await sidebar.getByRole("textbox", { name: "OpenRouter API Key" }).fill("test-api-key")
	await sidebar.getByRole("button", { name: "Done" }).click({ delay: 100 })

	// The switch committed: the model-picker relabels.
	await expect(sidebar.getByRole("button", { name: /^openrouter/ })).toBeVisible({ timeout: 10_000 })

	// The SAME session's manifest re-labels to the new provider once the
	// idle restart and its connection sync have run.
	await expect
		.poll(() => readSessionManifests(clineDir).map((s) => s.provider), { timeout: 30_000 })
		.toContain("openrouter")
	const after = readSessionManifests(clineDir)
	expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id))
})
