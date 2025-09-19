import { spawnSync } from "node:child_process"
import os from "node:os"
import { expect, test } from "@playwright/test"
import { CredentialStorage } from "../../core/storage/credential"
import { e2e } from "./utils/helpers"

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") return true
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

e2e("Secrets - keychain get/store/delete via CredentialStorage", async () => {
	const platform = os.platform()

	if ((platform === "darwin" && !hasCommand("security")) || (platform === "linux" && !hasCommand("secret-tool"))) {
		console.warn("Skipping: required OS credential tool not available")
		return
	}

	const store = new CredentialStorage()
	const key = `e2e_secret_${Date.now()}`
	const value = "test-secret"

	// Ensure clean slate
	try {
		await store.delete(key)
	} catch {}

	await store.store(key, value)
	const fetched = await store.get(key)
	expect(fetched).toBe(value)

	await store.delete(key)
	const afterDelete = await store.get(key)
	expect(afterDelete).toBeUndefined()
})

test.describe("Standalone deps warning", () => {
	e2e("Toast presence matches EXPECT_DEPS env", async ({ page }) => {
		const expectDeps = process.env.EXPECT_DEPS === "true"
		const toastLocator = page.locator(".monaco-workbench .notifications-toasts .notification-list-item")
		if (expectDeps) {
			// With deps provisioned, no toast expected
			await page.waitForTimeout(2000)
			await expect(toastLocator).toHaveCount(0)
		} else {
			// Without deps, expect fallback toast
			await expect(toastLocator).toContainText(
				/Falling back to file storage|CredentialManager PowerShell module not available|secret-tool\/libsecret/i,
				{ timeout: 10000 },
			)
		}
	})
})
