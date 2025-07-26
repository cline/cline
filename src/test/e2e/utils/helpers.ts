import { type ElectronApplication, type Frame, type Page, test, expect } from "@playwright/test"
import { type PathLike, type RmOptions, mkdtempSync, rmSync } from "node:fs"
import { _electron } from "playwright"
import { SilentReporter, downloadAndUnzipVSCode } from "@vscode/test-electron"
import * as os from "node:os"
import * as path from "node:path"

interface E2ETestDirectories {
	workspaceDir: string
	userDataDir: string
	extensionsDir: string
}

// Constants
const CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
const E2E_TESTS_DIR = path.join(CODEBASE_ROOT_DIR, "src", "test", "e2e")

// Path utilities
const escapeToPath = (text: string): string => text.trim().toLowerCase().replaceAll(/\W/g, "_")
const getResultsDir = (testName = "", label?: string): string => {
	const testDir = path.join(CODEBASE_ROOT_DIR, "test-results", "playwright", escapeToPath(testName))
	return label ? path.join(testDir, label) : testDir
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 5000): Promise<void> {
	let delay = 10
	const start = Date.now()

	while (!(await predicate())) {
		if (Date.now() - start > maxDelay) {
			throw new Error(`waitUntil timeout after ${maxDelay}ms`)
		}
		await new Promise((resolve) => setTimeout(resolve, delay))
		delay = Math.min(delay << 1, 1000) // Cap at 1s
	}
}

export async function getSidebar(page: Page): Promise<Frame> {
	let cachedFrame: Frame | null = null

	const findSidebarFrame = async (): Promise<Frame | null> => {
		// Check cached frame first
		if (cachedFrame && !cachedFrame.isDetached()) {
			return cachedFrame
		}

		for (const frame of page.frames()) {
			if (frame.isDetached()) {
				continue
			}

			try {
				const title = await frame.title()
				if (title.startsWith("Cline")) {
					cachedFrame = frame
					return frame
				}
			} catch (error: any) {
				if (!error.message.includes("detached") && !error.message.includes("navigation")) {
					throw error
				}
			}
		}
		return null
	}

	await waitUntil(async () => (await findSidebarFrame()) !== null)
	return (await findSidebarFrame()) || page.mainFrame()
}

export async function rmForRetries(path: PathLike, options?: RmOptions): Promise<void> {
	const maxAttempts = 3 // Reduced from 5

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			rmSync(path, options)
			return
		} catch (error) {
			if (attempt === maxAttempts) {
				throw new Error(`Failed to rmSync ${path} after ${maxAttempts} attempts: ${error}`)
			}
			await new Promise((resolve) => setTimeout(resolve, 50 * attempt)) // Progressive delay
		}
	}
}

export async function signin(webview: Frame): Promise<void> {
	const byokButton = webview.getByRole("button", { name: "Use your own API key" })
	await expect(byokButton).toBeVisible()

	await byokButton.click()

	// Complete setup with OpenRouter
	const apiKeyInput = webview.getByRole("textbox", { name: "OpenRouter API Key" })
	await apiKeyInput.fill("test-api-key")
	await webview.getByRole("button", { name: "Let's go!" }).click()

	// Verify start up page is no longer visible
	await expect(webview.locator("#api-provider div").first()).not.toBeVisible()
	await expect(byokButton).not.toBeVisible()
}

export async function openClineSidebar(page: Page): Promise<void> {
	await page.getByRole("tab", { name: /Cline/ }).locator("a").click()
}

export async function runCommandPalette(page: Page, command: string): Promise<void> {
	await page.locator("li").filter({ hasText: "[Extension Development Host]" }).first().click()
	const editorSearchBar = page.getByRole("textbox", { name: "Search files by name (append" })
	await expect(editorSearchBar).toBeVisible()
	await editorSearchBar.click()
	await editorSearchBar.fill(`>${command}`)
	await page.keyboard.press("Enter")
}

// Test configuration
export const e2e = test
	.extend<E2ETestDirectories>({
		workspaceDir: async ({}, use) => {
			await use(path.join(E2E_TESTS_DIR, "fixtures", "workspace"))
		},
		userDataDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
		extensionsDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
	})
	.extend<{ openVSCode: () => Promise<ElectronApplication> }>({
		openVSCode: async ({ workspaceDir, userDataDir, extensionsDir }, use, testInfo) => {
			const executablePath = await downloadAndUnzipVSCode("stable", undefined, new SilentReporter())

			await use(async () => {
				const app = await _electron.launch({
					executablePath,
					env: { ...process.env, TEMP_PROFILE: "true", E2E_TEST: "true" },
					recordVideo: { dir: getResultsDir(testInfo.title, "recordings") },
					args: [
						"--no-sandbox",
						"--disable-updates",
						"--disable-workspace-trust",
						"--skip-welcome",
						"--skip-release-notes",
						`--user-data-dir=${userDataDir}`,
						`--extensions-dir=${extensionsDir}`,
						`--install-extension=${path.join(CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
						`--extensionDevelopmentPath=${CODEBASE_ROOT_DIR}`,
						workspaceDir,
					],
				})
				await waitUntil(() => app.windows().length > 0)
				return app
			})
		},
	})
	.extend<{ app: ElectronApplication }>({
		app: async ({ openVSCode, userDataDir, extensionsDir }, use) => {
			const app = await openVSCode()

			try {
				await use(app)
			} finally {
				await app.close()
				// Cleanup in parallel
				await Promise.allSettled([
					rmForRetries(userDataDir, { recursive: true }),
					rmForRetries(extensionsDir, { recursive: true }),
				])
			}
		},
	})
	.extend({
		page: async ({ app }, use) => {
			const page = await app.firstWindow()
			await runCommandPalette(page, "notifications: toggle do not disturb")
			await openClineSidebar(page)
			await use(page)
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page }, use) => {
			const sidebar = await getSidebar(page)
			await use(sidebar)
		},
	})

export { getResultsDir }
