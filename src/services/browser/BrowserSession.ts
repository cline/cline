import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { Controller } from "@core/controller"
import { BrowserActionResult } from "@shared/ExtensionMessage"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import { spawn } from "child_process"
import * as chromeLauncher from "chrome-launcher"
import os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
// @ts-ignore
import type { ConsoleMessage, ScreenshotOptions } from "puppeteer-core"
import { Browser, connect, launch, Page, TimeoutError } from "puppeteer-core"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { telemetryService } from "@/services/telemetry"
import { discoverChromeInstances, isPortOpen, testBrowserConnection } from "./BrowserDiscovery"
import { ensureChromiumExists } from "./utils"

// Define browser connection info interface
export interface BrowserConnectionInfo {
	isConnected: boolean
	isRemote: boolean
	host?: string
}

const DEBUG_PORT = 9222 // Chrome's default debugging port

// helper function required to append custom browser arguments from UI
function splitArgs(str?: string | null): string[] {
	if (!str) {
		return []
	}
	// split on spaces but keep quoted chunks; strip quotes
	return (str.match(/"[^"]+"|\S+/g) || []).map((s) => s.replace(/^"(.*)"$/, "$1"))
}

export class BrowserSession {
	private browser?: Browser
	private page?: Page
	private currentMousePosition?: string
	private cachedWebSocketEndpoint?: string
	private lastConnectionAttempt: number = 0
	private isConnectedToRemote: boolean = false
	private useWebp: boolean

	// Telemetry tracking properties
	private sessionStartTime: number = 0
	private browserActions: string[] = []
	private ulid?: string
	private stateManager: StateManager

	constructor(stateManager: StateManager, useWebp: boolean = true) {
		this.stateManager = stateManager
		this.useWebp = useWebp
	}

	// Tests remote browser connection
	async testConnection(host: string): Promise<{ success: boolean; message: string; endpoint?: string }> {
		return testBrowserConnection(host)
	}

	/**
	 * Get current browser connection information
	 */
	getConnectionInfo(): BrowserConnectionInfo {
		return {
			isConnected: !!this.browser,
			isRemote: this.isConnectedToRemote,
			host: this.isConnectedToRemote
				? this.stateManager.getGlobalSettingsKey("browserSettings").remoteBrowserHost
				: undefined,
		}
	}

	/**
	 * Migrates the chromeExecutablePath setting from VSCode configuration to browserSettings
	 */
	private async migrateChromeExecutablePathSetting(): Promise<void> {
		const config = vscode.workspace.getConfiguration("cline")
		const configPath = vscode.workspace.getConfiguration("cline").get<string>("chromeExecutablePath")

		if (configPath !== undefined) {
			this.stateManager.getGlobalSettingsKey("browserSettings").chromeExecutablePath = configPath
			// Remove from VSCode configuration
			await config.update("chromeExecutablePath", undefined, true)
		}
	}

	async getDetectedChromePath(): Promise<{ path: string; isBundled: boolean }> {
		// First check browserSettings (from UI, stored in global state)
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		await this.migrateChromeExecutablePathSetting()
		if (browserSettings.chromeExecutablePath && (await fileExistsAtPath(browserSettings.chromeExecutablePath))) {
			return {
				path: browserSettings.chromeExecutablePath,
				isBundled: false,
			}
		}

		// Then try to find system Chrome
		try {
			const systemPath = chromeLauncher.Launcher.getFirstInstallation()
			// Add validation to ensure path is not in Trash - This can happen on Mac OS due to the way the chrome-launcher library works
			if (systemPath && !systemPath.includes(".Trash") && (await fileExistsAtPath(systemPath))) {
				return { path: systemPath, isBundled: false }
			}
		} catch (error) {
			console.info("Could not find system Chrome:", error)
		}

		// Finally fall back to PCR's bundled version
		const stats = await ensureChromiumExists()
		return { path: stats.executablePath, isBundled: true }
	}

	async relaunchChromeDebugMode(_controller: Controller): Promise<string> {
		try {
			const userDataDir = path.join(os.tmpdir(), "chrome-debug-profile")
			const installation = chromeLauncher.Launcher.getFirstInstallation()
			if (!installation) {
				throw new Error("Could not find Chrome installation on this system")
			}
			console.info("chrome installation", installation)

			const userArgs = splitArgs(this.stateManager.getGlobalSettingsKey("browserSettings").customArgs)

			const args = [
				`--remote-debugging-port=${DEBUG_PORT}`,
				`--user-data-dir=${userDataDir}`,
				"--disable-notifications",
				...userArgs,
				"chrome://newtab",
			]

			// Spawn Chrome as a detached process
			const chromeProcess = spawn(installation, args, {
				detached: true, // This is key - makes the process independent of parent
				stdio: "ignore", // Detach stdio to prevent hanging
				shell: false, // Don't run in a shell
			})

			// Unref the process to allow Node to exit independently
			chromeProcess.unref()

			// Wait a moment to ensure Chrome has time to start
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Test if Chrome is actually running with debug port
			const isRunning = await isPortOpen("localhost", DEBUG_PORT, 2000)

			if (!isRunning) {
				throw new Error("Chrome was launched but debug port is not responding")
			}

			return `Browser successfully launched with debug mode\nUsing: ${installation}`
		} catch (error) {
			throw new Error(`Failed to relaunch Chrome: ${error instanceof Error ? error.message : globalThis.String(error)}`)
		}
	}

	/**
	 * Set the ULID for telemetry tracking
	 * @param ulid The task ID to associate with browser actions
	 */
	setUlid(ulid: string) {
		this.ulid = ulid
	}

	async launchBrowser() {
		if (this.browser) {
			await this.closeBrowser() // this may happen when the model launches a browser again after having used it already before
		}

		// Reset tracking properties
		this.sessionStartTime = Date.now()
		this.browserActions = []

		// Reset remote connection status
		this.isConnectedToRemote = false

		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")

		if (browserSettings.remoteBrowserEnabled) {
			console.log(`launch browser called -- remote host mode (non-headless)`)
			try {
				await this.launchRemoteBrowser()
				// Don't create a new page here, as we'll create it in launchRemoteBrowser

				// Send telemetry for browser tool start
				if (this.ulid) {
					telemetryService.captureBrowserToolStart(this.ulid, browserSettings)
				}

				return
			} catch (error) {
				console.error("Failed to launch remote browser, falling back to local mode:", error)

				// Capture error telemetry
				if (this.ulid) {
					telemetryService.captureBrowserError(
						this.ulid,
						"remote_browser_launch_error",
						error instanceof Error ? error.message : String(error),
						{
							isRemote: true,
							remoteBrowserHost: browserSettings.remoteBrowserHost,
						},
					)
				}

				await this.launchLocalBrowser()
			}
		} else {
			console.log(`launch browser called -- local mode (headless)`)
			await this.launchLocalBrowser()
		}

		this.page = await this.browser?.newPage()

		// Send telemetry for browser tool start
		if (this.ulid) {
			telemetryService.captureBrowserToolStart(this.ulid, browserSettings)
		}
	}

	async launchLocalBrowser() {
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const { path } = await this.getDetectedChromePath()
		const userArgs = splitArgs(browserSettings.customArgs)
		this.browser = await launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				...userArgs,
			],
			executablePath: path,
			defaultViewport: browserSettings.viewport,
			headless: "shell", // Always use headless mode for local connections
		})
		this.isConnectedToRemote = false
	}

	async launchRemoteBrowser() {
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		let remoteBrowserHost = browserSettings.remoteBrowserHost
		let browserWSEndpoint: string | undefined = this.cachedWebSocketEndpoint
		let _reconnectionAttempted = false

		const getViewport = () => {
			return browserSettings.viewport
		}

		// First try auto-discovery if no host is provided
		if (!remoteBrowserHost) {
			try {
				console.info("No remote browser host provided, trying auto-discovery")
				const discoveredHost = await discoverChromeInstances()

				if (discoveredHost) {
					console.info(`Auto-discovered Chrome at ${discoveredHost}`)
					remoteBrowserHost = discoveredHost
				}
			} catch (error) {
				console.log(`Auto-discovery failed: ${error}`)
			}
		}

		// Try to connect with cached endpoint first if it exists and is recent (less than 1 hour old)
		if (browserWSEndpoint && Date.now() - this.lastConnectionAttempt < 3600000) {
			try {
				console.info(`Attempting to connect using cached WebSocket endpoint: ${browserWSEndpoint}`)
				this.browser = await connect({
					browserWSEndpoint,
					defaultViewport: getViewport(),
				})
				this.page = await this.browser?.newPage()
				this.isConnectedToRemote = true
				return
			} catch (error) {
				console.log(`Failed to connect using cached endpoint: ${error}`)

				// Capture error telemetry
				if (this.ulid) {
					telemetryService.captureBrowserError(
						this.ulid,
						"cached_endpoint_connection_error",
						error instanceof Error ? error.message : String(error),
						{
							isRemote: true,
							endpoint: browserWSEndpoint,
						},
					)
				}

				// Clear the cached endpoint since it's no longer valid
				this.cachedWebSocketEndpoint = undefined
				// User wants to give up after one reconnection attempt
				if (remoteBrowserHost) {
					_reconnectionAttempted = true
				}
			}
		}

		// Try to connect with host (either user-provided or auto-discovered)
		if (remoteBrowserHost) {
			try {
				// Fetch the WebSocket endpoint from the Chrome DevTools Protocol
				const versionUrl = `${remoteBrowserHost.replace(/\/$/, "")}/json/version`
				console.info(`Fetching WebSocket endpoint from ${versionUrl}`)

				const response = await axios.get(versionUrl)
				browserWSEndpoint = response.data.webSocketDebuggerUrl

				if (!browserWSEndpoint) {
					throw new Error("Could not find webSocketDebuggerUrl in the response")
				}

				console.info(`Found WebSocket browser endpoint: ${browserWSEndpoint}`)

				// Cache the successful endpoint
				this.cachedWebSocketEndpoint = browserWSEndpoint
				this.lastConnectionAttempt = Date.now()

				this.browser = await connect({
					browserWSEndpoint,
					defaultViewport: getViewport(),
				})
				this.page = await this.browser?.newPage()
				this.isConnectedToRemote = true
				return
			} catch (error) {
				console.log(`Failed to connect to remote browser: ${error}`)

				// Capture error telemetry
				if (this.ulid) {
					telemetryService.captureBrowserError(
						this.ulid,
						"remote_host_connection_error",
						error instanceof Error ? error.message : String(error),
						{
							isRemote: true,
							remoteBrowserHost,
						},
					)
				}
			}
		}

		// If we get here, all connection attempts failed
		throw new Error(
			"Failed to connect to remote browser. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
		)
	}

	async closeBrowser(): Promise<BrowserActionResult> {
		if (this.browser || this.page) {
			// Send telemetry for browser tool end if we have a task ID and session was started
			if (this.ulid && this.sessionStartTime > 0) {
				const sessionDuration = Date.now() - this.sessionStartTime
				telemetryService.captureBrowserToolEnd(this.ulid, {
					actionCount: this.browserActions.length,
					duration: sessionDuration,
					actions: this.browserActions,
				})
			}

			if (this.isConnectedToRemote && this.browser) {
				// Close the page/tab first if it exists
				if (this.page) {
					await this.page.close().catch(() => {})
					console.info("closed remote browser tab...")
				}
				await this.browser.disconnect().catch(() => {})
				console.info("disconnected from remote browser...")
				// do not close the browser
			} else if (this.isConnectedToRemote === false) {
				await this.browser?.close().catch(() => {})
				console.info("closed local browser...")
			}

			this.browser = undefined
			this.page = undefined
			this.currentMousePosition = undefined
			this.isConnectedToRemote = false

			// Reset tracking properties
			this.sessionStartTime = 0
			this.browserActions = []
		}
		return {}
	}

	async doAction(action: (page: Page) => Promise<void>): Promise<BrowserActionResult> {
		if (!this.page) {
			throw new Error(
				"Browser is not launched. This may occur if the browser was automatically closed by a non-`browser_action` tool.",
			)
		}

		const logs: string[] = []
		let lastLogTs = Date.now()

		const consoleListener = (msg: ConsoleMessage) => {
			if (msg.type() === "log") {
				logs.push(msg.text())
			} else {
				logs.push(`[${msg.type()}] ${msg.text()}`)
			}
			lastLogTs = Date.now()
		}

		const errorListener = (err: Error) => {
			logs.push(`[Page Error] ${err.toString()}`)
			lastLogTs = Date.now()
		}

		// Add the listeners
		this.page.on("console", consoleListener)
		this.page.on("pageerror", errorListener)

		try {
			await action(this.page)
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err)

			if (!(err instanceof TimeoutError)) {
				logs.push(`[Error] ${errorMessage}`)

				// Capture error telemetry
				if (this.ulid) {
					telemetryService.captureBrowserError(this.ulid, "browser_action_error", errorMessage, {
						isRemote: this.isConnectedToRemote,
						action: this.browserActions[this.browserActions.length - 1],
					})
				}
			}
		}

		// Wait for console inactivity, with a timeout
		await pWaitFor(() => Date.now() - lastLogTs >= 500, {
			timeout: 3_000,
			interval: 100,
		}).catch(() => {})

		const options: ScreenshotOptions = {
			encoding: "base64",

			// clip: {
			// 	x: 0,
			// 	y: 0,
			// 	width: 900,
			// 	height: 600,
			// },
		}

		const screenshotType = this.useWebp ? "webp" : "png"
		let screenshotBase64 = await this.page.screenshot({
			...options,
			type: screenshotType,
		})
		let screenshot = `data:image/${screenshotType};base64,${screenshotBase64}`

		if (!screenshotBase64) {
			// choosing to try screenshot again, regardless of the initial type
			console.info(`${screenshotType} screenshot failed, trying png`)
			screenshotBase64 = await this.page.screenshot({
				...options,
				type: "png",
			})
			screenshot = `data:image/png;base64,${screenshotBase64}`
		}

		if (!screenshotBase64) {
			// Capture error telemetry
			if (this.ulid) {
				telemetryService.captureBrowserError(this.ulid, "screenshot_error", "Failed to take screenshot", {
					isRemote: this.isConnectedToRemote,
					action: this.browserActions[this.browserActions.length - 1],
				})
			}
			throw new Error("Failed to take screenshot.")
		}

		// this.page.removeAllListeners() <- causes the page to crash!
		this.page.off("console", consoleListener)
		this.page.off("pageerror", errorListener)

		return {
			screenshot,
			logs: logs.join("\n"),
			currentUrl: this.page.url(),
			currentMousePosition: this.currentMousePosition,
		}
	}

	async navigateToUrl(url: string): Promise<BrowserActionResult> {
		this.browserActions.push(`navigate: url`)

		return this.doAction(async (page) => {
			// networkidle2 isn't good enough since page may take some time to load. we can assume locally running dev sites will reach networkidle0 in a reasonable amount of time
			await page.goto(url, {
				timeout: 7_000,
				waitUntil: ["domcontentloaded", "networkidle2"],
			})
			// await page.goto(url, { timeout: 10_000, waitUntil: "load" })
			await this.waitTillHTMLStable(page) // in case the page is loading more resources
		})
	}

	// page.goto { waitUntil: "networkidle0" } may not ever resolve, and not waiting could return page content too early before js has loaded
	// https://stackoverflow.com/questions/52497252/puppeteer-wait-until-page-is-completely-loaded/61304202#61304202
	private async waitTillHTMLStable(page: Page, timeout = 5_000) {
		const checkDurationMsecs = 500 // 1000
		const maxChecks = timeout / checkDurationMsecs
		let lastHTMLSize = 0
		let checkCounts = 1
		let countStableSizeIterations = 0
		const minStableSizeIterations = 3

		while (checkCounts++ <= maxChecks) {
			const html = await page.content()
			const currentHTMLSize = html.length

			// let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length)
			console.info("last: ", lastHTMLSize, " <> curr: ", currentHTMLSize)

			if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
				countStableSizeIterations++
			} else {
				countStableSizeIterations = 0 //reset the counter
			}

			if (countStableSizeIterations >= minStableSizeIterations) {
				console.info("Page rendered fully...")
				break
			}

			lastHTMLSize = currentHTMLSize
			await setTimeoutPromise(checkDurationMsecs)
		}
	}

	async click(coordinate: string): Promise<BrowserActionResult> {
		this.browserActions.push(`click: coordinate`)

		const [x, y] = coordinate.split(",").map(Number)
		return this.doAction(async (page) => {
			// Set up network request monitoring
			let hasNetworkActivity = false
			const requestListener = () => {
				hasNetworkActivity = true
			}
			page.on("request", requestListener)

			// Perform the click
			await page.mouse.click(x, y)
			this.currentMousePosition = coordinate

			// Small delay to check if click triggered any network activity
			await setTimeoutPromise(100)

			if (hasNetworkActivity) {
				// If we detected network activity, wait for navigation/loading
				await page
					.waitForNavigation({
						waitUntil: ["domcontentloaded", "networkidle2"],
						timeout: 7000,
					})
					.catch(() => {})
				await this.waitTillHTMLStable(page)
			}

			// Clean up listener
			page.off("request", requestListener)
		})
	}

	async type(text: string): Promise<BrowserActionResult> {
		this.browserActions.push(`type:${text.length} chars`)

		return this.doAction(async (page) => {
			await page.keyboard.type(text)
		})
	}

	async scrollDown(): Promise<BrowserActionResult> {
		this.browserActions.push("scrollDown")

		return this.doAction(async (page) => {
			await page.evaluate(() => {
				window.scrollBy({
					top: 600,
					behavior: "auto",
				})
			})
			await setTimeoutPromise(300)
		})
	}

	async scrollUp(): Promise<BrowserActionResult> {
		this.browserActions.push("scrollUp")

		return this.doAction(async (page) => {
			await page.evaluate(() => {
				window.scrollBy({
					top: -600,
					behavior: "auto",
				})
			})
			await setTimeoutPromise(300)
		})
	}

	async dispose() {
		await this.closeBrowser()
	}
}
