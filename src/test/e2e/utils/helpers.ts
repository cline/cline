import { mkdtempSync, type PathLike, type RmOptions, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ElectronApplication, expect, type Frame, type Page, test } from "@playwright/test"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { _electron } from "playwright"
import { ClineApiServerMock } from "../fixtures/server"

interface E2ETestDirectories {
	workspaceDir: string
	userDataDir: string
	extensionsDir: string
}

export class E2ETestHelper {
	// Constants
	public static readonly CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
	public static readonly E2E_TESTS_DIR = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "e2e")

	// Instance properties for caching
	private cachedFrame: Frame | null = null

	// Path utilities
	public static escapeToPath(text: string): string {
		return text.trim().toLowerCase().replaceAll(/\W/g, "_")
	}

	public static getResultsDir(testName = "", label?: string): string {
		const testDir = path.join(
			E2ETestHelper.CODEBASE_ROOT_DIR,
			"test-results",
			"playwright",
			E2ETestHelper.escapeToPath(testName),
		)
		return label ? path.join(testDir, label) : testDir
	}

	/**
	 * Generates a filename for gRPC recorder logs based on test information
	 * @param testTitle The title of the test
	 * @param projectName The name of the test project (optional)
	 * @returns A sanitized filename suitable for gRPC recorder logs
	 */
	public static generateTestFileName(testTitle: string, projectName?: string): string {
		// Create a base name from the test title
		const baseName = E2ETestHelper.escapeToPath(testTitle)

		// Add project name if provided and different from default
		const projectSuffix = projectName && projectName !== "e2e tests" ? `_${E2ETestHelper.escapeToPath(projectName)}` : ""

		return `${baseName}${projectSuffix}`
	}

	public static async waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 5000): Promise<void> {
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

	public async getSidebar(page: Page): Promise<Frame> {
		const findSidebarFrame = async (): Promise<Frame | null> => {
			// Check cached frame first
			if (this.cachedFrame && !this.cachedFrame.isDetached()) {
				return this.cachedFrame
			}

			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue
				}

				try {
					const title = await frame.title()
					if (title.startsWith("Cline")) {
						this.cachedFrame = frame
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

		await E2ETestHelper.waitUntil(async () => (await findSidebarFrame()) !== null)
		return (await findSidebarFrame()) || page.mainFrame()
	}

	public static async rmForRetries(path: PathLike, options?: RmOptions): Promise<void> {
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

	public async signin(webview: Frame): Promise<void> {
		const byokButton = webview.getByRole("button", {
			name: "Use your own API key",
		})
		await expect(byokButton).toBeVisible()

		await byokButton.click()

		// Complete setup with OpenRouter
		const apiKeyInput = webview.getByRole("textbox", {
			name: "OpenRouter API Key",
		})
		await apiKeyInput.fill("test-api-key")
		await webview.getByRole("button", { name: "Let's go!" }).click()

		// Verify start up page is no longer visible
		await expect(webview.locator("#api-provider div").first()).not.toBeVisible()
		await expect(byokButton).not.toBeVisible()
	}

	public static async openClineSidebar(page: Page): Promise<void> {
		await page.getByRole("tab", { name: /Cline/ }).locator("a").click()
	}

	public static async runCommandPalette(page: Page, command: string): Promise<void> {
		const editorMenu = page.locator("li").filter({ hasText: "[Extension Development Host]" }).first()
		await editorMenu.click({ delay: 100 })
		const editorSearchBar = page.getByRole("textbox", {
			name: "Search files by name (append",
		})
		await editorSearchBar.click({ delay: 100 }) // Ensure focus
		await editorSearchBar.fill(`>${command}`)
		await page.keyboard.press("Enter")
	}

	// Clear cached frame when needed
	public clearCachedFrame(): void {
		this.cachedFrame = null
	}
}

/**
 * NOTE: Use the `e2e` test fixture for all E2E tests to test the Cline extension.
 *
 * Extended Playwright test configuration for Cline E2E testing.
 *
 * This test configuration provides a comprehensive setup for end-to-end testing of the Cline VS Code extension,
 * including server mocking, temporary directories, VS Code instance management, and helper utilities.
 *
 * @extends test - Base Playwright test with multiple fixture extensions
 *
 * Fixtures provided:
 * - `server`: Shared ClineApiServerMock instance for API mocking (reused across all tests)
 * - `workspaceDir`: Path to the test workspace directory
 * - `userDataDir`: Temporary directory for VS Code user data
 * - `extensionsDir`: Temporary directory for VS Code extensions
 * - `openVSCode`: Function that returns a Promise resolving to an ElectronApplication instance
 * - `app`: ElectronApplication instance with automatic cleanup
 * - `helper`: E2ETestHelper instance for test utilities
 * - `page`: Playwright Page object representing the main VS Code window with Cline sidebar opened
 * - `sidebar`: Playwright Frame object representing the Cline extension's sidebar iframe
 *
 * @returns Extended test object with all fixtures available for E2E test scenarios:
 * - **server**: Automatically starts and manages a ClineApiServerMock instance
 * - **workspaceDir**: Sets up a test workspace directory from fixtures
 * - **userDataDir**: Creates a temporary directory for VS Code user data
 * - **extensionsDir**: Creates a temporary directory for VS Code extensions
 * - **openVSCode**: Factory function that launches VS Code with proper configuration for testing
 * - **app**: Manages the VS Code ElectronApplication lifecycle with automatic cleanup
 * - **helper**: Provides E2ETestHelper utilities for test operations
 * - **page**: Configures the main VS Code window with notifications disabled and Cline sidebar open
 * - **sidebar**: Provides access to the Cline extension's sidebar frame
 *
 * @example
 * ```typescript
 * e2e('should perform basic operations', async ({ sidebar, helper }) => {
 *   // Test implementation using the configured sidebar and helper
 * });
 * ```
 *
 * @remarks
 * - Automatically handles VS Code download and setup
 * - Installs the Cline extension in development mode
 * - Records test videos for debugging
 * - Performs cleanup of temporary directories after each test
 * - Configures VS Code with disabled updates, workspace trust, and welcome screens
 */
export const e2e = test
	.extend<{ server: ClineApiServerMock | null }>({
		server: async ({}, use) => {
			console.log("=== SERVER FIXTURE CALLED ===")
			// Start server if it doesn't exist
			if (!ClineApiServerMock.globalSharedServer) {
				console.log("Starting global server...")
				await ClineApiServerMock.startGlobalServer()
				console.log("Global server started successfully")
			} else {
				console.log("Using existing global server")
			}
			await use(ClineApiServerMock.globalSharedServer)
		},
	})
	.extend<E2ETestDirectories>({
		workspaceDir: async ({}, use) => {
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"))
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
					env: {
						...process.env,
						TEMP_PROFILE: "true",
						E2E_TEST: "true",
						CLINE_ENVIRONMENT: "local",
						GRPC_RECORDER_FILE_NAME: E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name),
						// GRPC_RECORDER_ENABLED: "true",
						// IS_DEV: "true",
						// DEV_WORKSPACE_FOLDER: E2ETestHelper.CODEBASE_ROOT_DIR,
					},
					recordVideo: {
						dir: E2ETestHelper.getResultsDir(testInfo.title, "recordings"),
					},
					args: [
						"--no-sandbox",
						"--disable-updates",
						"--disable-workspace-trust",
						"--skip-welcome",
						"--skip-release-notes",
						`--user-data-dir=${userDataDir}`,
						`--extensions-dir=${extensionsDir}`,
						`--install-extension=${path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
						`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`,
						workspaceDir,
					],
				})
				await E2ETestHelper.waitUntil(() => app.windows().length > 0)
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
					E2ETestHelper.rmForRetries(userDataDir, { recursive: true }),
					E2ETestHelper.rmForRetries(extensionsDir, { recursive: true }),
				])
			}
		},
	})
	.extend<{ helper: E2ETestHelper }>({
		helper: async ({}, use) => {
			const helper = new E2ETestHelper()
			await use(helper)
		},
	})
	.extend({
		page: async ({ app }, use) => {
			const page = await app.firstWindow()
			await use(page)
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page, helper, server }, use) => {
			await E2ETestHelper.openClineSidebar(page)
			const sidebar = await helper.getSidebar(page)
			await use(sidebar)
		},
	})

// Backward compatibility exports
export const getResultsDir = E2ETestHelper.getResultsDir
