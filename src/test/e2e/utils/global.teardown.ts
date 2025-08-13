import { test as teardown } from "@playwright/test"
import { ClineApiServerMock } from "../fixtures/server"

teardown("cleanup test environment", async ({ page }) => {
	// Stop server without blocking teardown
	ClineApiServerMock.stopGlobalServer().catch((error) => console.error("Error stopping ClineApiServerMock:", error))

	await page.close()
})
