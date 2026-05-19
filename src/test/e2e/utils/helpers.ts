import type { ChildProcess } from "node:child_process"
import { mkdtempSync, type PathLike, type RmOptions, readdirSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ElectronApplication, expect, type Frame, type Page, test } from "@playwright/test"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { _electron } from "playwright"
import { ClineApiServerMock } from "../fixtures/server"

interface E2ETestDirectories {
	workspaceDir: string
	multiRootWorkspaceDir: string
	userDataDir: string
	extensionsDir: string
}

export interface E2ETestConfigs {
	workspaceType: "single" | "multi"
	channel: "stable" | "insiders"
}

export class E2ETestHelper {
	// Constants
	public static readonly CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
	public static readonly E2E_TESTS_DIR = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "e2e")
	private static readonly TEARDOWN_TIMEOUT_MS = 10_000
	private static readonly WINDOW_DIAGNOSTIC_TIMEOUT_MS = 1_000
	private static readonly PROCESS_EXIT_TIMEOUT_MS = 2_000

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

	public static async waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 10000): Promise<void> {
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

		// Use longer timeout (30s) for sidebar - macOS CI runners can be slow
		await E2ETestHelper.waitUntil(async () => (await findSidebarFrame()) !== null, 30000)
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

	private static async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
		let timeout: ReturnType<typeof setTimeout> | undefined
		let timedOut = false

		try {
			const value = await Promise.race([
				promise.then((value) => ({ timedOut: false as const, value })),
				new Promise<{ timedOut: true }>((resolve) => {
					timeout = setTimeout(() => {
						timedOut = true
						resolve({ timedOut: true })
					}, timeoutMs)
				}),
			])

			return value
		} finally {
			if (timeout) {
				clearTimeout(timeout)
			}
			if (timedOut) {
				void promise.catch(() => undefined)
			}
		}
	}

	private static async getWindowDiagnostics(app: ElectronApplication): Promise<string> {
		const windows = app.windows()
		const titles = await Promise.all(
			windows.map(async (window, index) => {
				if (window.isClosed()) {
					return `#${index}: closed`
				}

				const title = await E2ETestHelper.withTimeout(window.title(), E2ETestHelper.WINDOW_DIAGNOSTIC_TIMEOUT_MS)
				return title.timedOut ? `#${index}: title timed out` : `#${index}: ${title.value || "<untitled>"}`
			}),
		)

		return titles.length > 0 ? titles.join(", ") : "no windows"
	}

	private static async waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
		if (process.exitCode !== null || process.signalCode !== null) {
			return true
		}

		return new Promise((resolve) => {
			const onExit = () => {
				clearTimeout(timeout)
				resolve(true)
			}
			const timeout = setTimeout(() => {
				process.off("exit", onExit)
				resolve(process.exitCode !== null || process.signalCode !== null)
			}, timeoutMs)

			process.once("exit", onExit)
		})
	}

	public static async closePageForTeardown(page: Page): Promise<void> {
		if (page.isClosed()) {
			return
		}

		const result = await E2ETestHelper.withTimeout(page.close(), E2ETestHelper.TEARDOWN_TIMEOUT_MS).catch((error) => {
			console.warn(`[e2e teardown] page.close() failed: ${error}`)
			return { timedOut: false as const, value: undefined }
		})
		if (result.timedOut) {
			console.warn(`[e2e teardown] page.close() exceeded ${E2ETestHelper.TEARDOWN_TIMEOUT_MS}ms; continuing to app cleanup`)
		}
	}

	public static async closeAppForTeardown(app: ElectronApplication): Promise<void> {
		const process = app.process()
		const getProcessSummary = () =>
			process
				? `pid=${process.pid ?? "unknown"} exitCode=${process.exitCode ?? "null"} signalCode=${process.signalCode ?? "null"} killed=${process.killed}`
				: "process unavailable"

		const closeResult = await E2ETestHelper.withTimeout(app.close(), E2ETestHelper.TEARDOWN_TIMEOUT_MS).catch((error) => {
			console.warn(`[e2e teardown] app.close() failed: ${error}`)
			return { timedOut: true as const }
		})
		if (!closeResult.timedOut) {
			return
		}

		const windowDiagnostics = await E2ETestHelper.getWindowDiagnostics(app).catch(
			(error) => `window diagnostics failed: ${error}`,
		)
		console.warn(
			`[e2e teardown] app.close() exceeded ${E2ETestHelper.TEARDOWN_TIMEOUT_MS}ms; forcing VS Code/Electron shutdown (${getProcessSummary()}; windows: ${windowDiagnostics})`,
		)

		if (!process || process.killed || process.exitCode !== null) {
			return
		}

		try {
			if (process.kill("SIGKILL")) {
				const exited = await E2ETestHelper.waitForProcessExit(process, E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS)
				if (!exited) {
					console.warn(
						`[e2e teardown] VS Code/Electron process did not report exit within ${E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS}ms after SIGKILL (${getProcessSummary()})`,
					)
				}
				return
			}

			console.warn(
				`[e2e teardown] SIGKILL returned false for VS Code/Electron process; skipping SIGTERM (${getProcessSummary()})`,
			)
			return
		} catch (error) {
			console.warn(`[e2e teardown] SIGKILL failed for VS Code/Electron process: ${error}`)
		}

		try {
			if (process.exitCode === null && process.signalCode === null && process.kill("SIGTERM")) {
				await E2ETestHelper.waitForProcessExit(process, E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS)
			}
		} catch (error) {
			console.warn(`[e2e teardown] SIGTERM failed for VS Code/Electron process: ${error}`)
		}
	}

	public async signin(webview: Frame): Promise<void> {
		await webview.getByRole("button", { name: "Login to Cline" }).click({ delay: 100 })

		// Verify start up page is no longer visible
		await expect(webview.getByRole("button", { name: "Login to Cline" })).not.toBeVisible()

		const closeButton = webview.getByRole("button", { name: "Close" })
		let shouldCloseModal = false
		try {
			await closeButton.waitFor({ state: "visible", timeout: 5_000 })
			shouldCloseModal = true
		} catch {
			// No blocking modal appeared after sign-in.
		}
		if (shouldCloseModal) {
			await closeButton.click({ delay: 50 })
		}
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
 * NOTE: Default to run in single-root workspace; use `e2eMultiRoot` for multi-root workspace tests.
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
			// Start server if it doesn't exist
			if (!ClineApiServerMock.globalSharedServer) {
				await ClineApiServerMock.startGlobalServer()
			}
			await use(ClineApiServerMock.globalSharedServer)
		},
	})
	.extend<E2ETestDirectories>({
		workspaceDir: async ({}, use) => {
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"))
		},
		multiRootWorkspaceDir: async ({}, use) => {
			// DOCS: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "multiroots.code-workspace"))
		},
		userDataDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
		extensionsDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
	})
	.extend<E2ETestConfigs>({
		workspaceType: "single",
		channel: "stable",
	})
	.extend<{ openVSCode: (workspacePath: string) => Promise<ElectronApplication> }>({
		openVSCode: async ({ userDataDir, channel }, use, testInfo) => {
			const executablePath = await downloadAndUnzipVSCode(channel, undefined, new SilentReporter())

			await use(async (workspacePath: string) => {
				// Create isolated Cline data directory for this test
				const clineTestDir = mkdtempSync(path.join(os.tmpdir(), "cline-e2e-"))

				const app = await _electron.launch({
					executablePath,
					env: {
						...process.env,
						TEMP_PROFILE: "true",
						E2E_TEST: "true",
						CLINE_ENVIRONMENT: "local",
						CLINE_DIR: clineTestDir, // Isolate test data from user's ~/.cline
						GRPC_RECORDER_FILE_NAME: E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name),
						// GRPC_RECORDER_ENABLED: "true",
						// GRPC_RECORDER_TESTS_FILTERS_ENABLED: "true"
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
						"--disable-extensions", // Run VS Code with all extensions disabled other than the one under test.
						"--skip-welcome",
						"--skip-release-notes",
						`--user-data-dir=${userDataDir}`,
						`--install-extension=${path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
						`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`,
						workspacePath,
					],
				})
				await E2ETestHelper.waitUntil(() => app.windows().length > 0)
				return app
			})
		},
	})
	.extend<{ app: ElectronApplication; clineTestDir: string }>({
		app: async ({ openVSCode, userDataDir, extensionsDir, workspaceType, workspaceDir, multiRootWorkspaceDir }, use) => {
			const workspacePath = workspaceType === "single" ? workspaceDir : multiRootWorkspaceDir

			const app = await openVSCode(workspacePath)

			try {
				await use(app)
			} finally {
				await E2ETestHelper.closeAppForTeardown(app)
				// Cleanup in parallel after the app process has been asked to exit.
				const cleanupTasks = [
					E2ETestHelper.rmForRetries(userDataDir, { recursive: true }),
					E2ETestHelper.rmForRetries(extensionsDir, { recursive: true }),
				]

				// Clean up the isolated Cline data directory
				// Find all temp directories matching our pattern
				const tmpDir = os.tmpdir()
				try {
					const entries = readdirSync(tmpDir)
					for (const entry of entries) {
						if (entry.startsWith("cline-e2e-")) {
							cleanupTasks.push(E2ETestHelper.rmForRetries(path.join(tmpDir, entry), { recursive: true }))
						}
					}
				} catch (error) {
					// Ignore cleanup errors
				}

				await Promise.allSettled(cleanupTasks)
			}
		},
		clineTestDir: async ({}, use) => {
			// This will be set by the openVSCode fixture
			await use("")
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
			try {
				await use(page)
			} finally {
				await E2ETestHelper.closePageForTeardown(page)
			}
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page, helper }, use) => {
			await E2ETestHelper.openClineSidebar(page)
			const sidebar = await helper.getSidebar(page)
			await use(sidebar)
		},
	})

export const E2E_WORKSPACE_TYPES = [
	{ title: "Single Root", workspaceType: "single" },
	{ title: "Multi-Roots", workspaceType: "multi" },
] as const
