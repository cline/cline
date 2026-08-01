import { existsSync, lstatSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Terminal - background execution uses Store-installed PowerShell 7", async ({ helper, page, sidebar }, testInfo) => {
	e2e.skip(process.platform !== "win32", "PowerShell Store installation is Windows-specific")
	const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files"
	const storeAlias = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "pwsh.exe")
	const hasPreferredInstall = [
		path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
		path.join(programFiles, "PowerShell", "6", "pwsh.exe"),
	].some(existsSync)
	let hasStoreAlias = false
	try {
		hasStoreAlias = lstatSync(storeAlias).isSymbolicLink()
	} catch {
		// The Store alias is not installed or enabled.
	}
	e2e.skip(!hasStoreAlias || hasPreferredInstall, "Requires a Store-only PowerShell 7 installation")

	await helper.signin(sidebar)

	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await sidebar.getByTestId("tab-terminal").click()
	await expect(sidebar.getByText("Terminal Settings", { exact: true })).toBeVisible()

	const executionMode = sidebar.locator("#terminal-execution-mode")
	await executionMode.click()
	await sidebar.getByRole("option", { name: "Background Exec" }).click()

	const terminalProfile = sidebar.locator("#default-terminal-profile")
	await terminalProfile.click()
	await sidebar.getByRole("option", { name: "PowerShell 7" }).click()

	await expect(executionMode).toHaveAttribute("current-value", "backgroundExec")
	await expect(terminalProfile).toHaveAttribute("current-value", "powershell-7")
	await page.screenshot({ path: testInfo.outputPath("powershell-background-settings.png"), fullPage: true })

	await sidebar.getByRole("button", { name: "Done" }).click()
	const inputbox = sidebar.getByTestId("chat-input")
	await inputbox.fill("powershell_store_request")
	await sidebar.getByTestId("send-button").click()
	await sidebar.getByRole("button", { name: "Run Command" }).click()

	const commandOutput = sidebar.locator("code").filter({ hasText: /VERSION=7\./ })
	await expect(commandOutput).toBeVisible({ timeout: 30_000 })
	await expect(commandOutput).toContainText(/PSHOME=.*WindowsApps.*Microsoft\.PowerShell_/i)
	await expect(commandOutput).toContainText("UNICODE=中文")
	await expect(sidebar.getByText("PowerShell background execution diagnostic completed.")).toBeVisible()
	await page.screenshot({ path: testInfo.outputPath("powershell-background-success.png"), fullPage: true })
})
