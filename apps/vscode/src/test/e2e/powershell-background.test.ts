import { existsSync, lstatSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

const profiles = [
	{
		name: "Windows PowerShell 5.1",
		profileId: "powershell-legacy",
		profileName: "Windows PowerShell",
		version: /^VERSION=5\.1/,
		psHome: [/PSHOME=.*WindowsPowerShell/i, /v1\.0/i],
	},
	{
		name: "Store-installed PowerShell 7",
		profileId: "powershell-7",
		profileName: "PowerShell 7",
		version: /^VERSION=7\./,
		psHome: [/PSHOME=.*WindowsApps.*Microsoft\.PowerShell_/i],
		storeOnly: true,
	},
] as const

for (const profile of profiles) {
	e2e(`Terminal - background execution uses ${profile.name}`, async ({ helper, page, sidebar }, testInfo) => {
		e2e.skip(process.platform !== "win32", "PowerShell background execution is Windows-specific")
		if ("storeOnly" in profile) {
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
		}

		await helper.signin(sidebar)

		await page.getByRole("button", { name: "Settings", exact: true }).click()
		await sidebar.getByTestId("tab-terminal").click()
		await expect(sidebar.getByText("Terminal Settings", { exact: true })).toBeVisible()

		const executionMode = sidebar.locator("#terminal-execution-mode")
		await executionMode.click()
		await sidebar.getByRole("option", { name: "Background Exec" }).click()

		const terminalProfile = sidebar.locator("#default-terminal-profile")
		await terminalProfile.click()
		await sidebar.getByRole("option", { name: profile.profileName, exact: true }).click()

		await expect(executionMode).toHaveAttribute("current-value", "backgroundExec")
		await expect(terminalProfile).toHaveAttribute("current-value", profile.profileId)
		await page.screenshot({ path: testInfo.outputPath("powershell-background-settings.png"), fullPage: true })

		await sidebar.getByRole("button", { name: "Done" }).click()
		const inputbox = sidebar.getByTestId("chat-input")
		await inputbox.fill("powershell_background_request")
		await sidebar.getByTestId("send-button").click()
		await sidebar.getByRole("button", { name: "Run Command" }).click()

		const commandOutput = sidebar.locator("code").filter({ hasText: profile.version })
		await expect(commandOutput).toBeVisible({ timeout: 30_000 })
		for (const expectedPathPart of profile.psHome) {
			await expect(commandOutput).toContainText(expectedPathPart)
		}
		await expect(commandOutput).toContainText("UNICODE=中文")
		await expect(sidebar.getByText("PowerShell background execution diagnostic completed.")).toBeVisible()
		await page.screenshot({ path: testInfo.outputPath("powershell-background-success.png"), fullPage: true })
	})
}
