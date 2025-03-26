import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Browser, Page, ScreenshotOptions, TimeoutError, launch, connect } from "puppeteer-core"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import pWaitFor from "p-wait-for"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import axios from "axios"
import { fileExistsAtPath } from "../../utils/fs"
import { BrowserActionResult } from "../../shared/ExtensionMessage"
import { BrowserSettings } from "../../shared/BrowserSettings"
import { discoverChromeInstances, testBrowserConnection } from "./browserDiscovery"
import * as chromeLauncher from "chrome-launcher"

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

const DEBUG_PORT = 9222 // Chrome's default debugging port

export class BrowserSession {
	private context: vscode.ExtensionContext
	private browser?: Browser
	private page?: Page
	private currentMousePosition?: string
	private cachedWebSocketEndpoint?: string
	private lastConnectionAttempt: number = 0
	browserSettings: BrowserSettings

	constructor(context: vscode.ExtensionContext, browserSettings: BrowserSettings) {
		this.context = context
		this.browserSettings = browserSettings
	}

	// Tests remote browser connection
	async testConnection(host: string): Promise<{ success: boolean; message: string; endpoint?: string }> {
		return testBrowserConnection(host)
	}

	private async ensureChromiumExists(): Promise<PCRStats> {
		const globalStoragePath = this.context?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}

		const puppeteerDir = path.join(globalStoragePath, "puppeteer")
		const dirExists = await fileExistsAtPath(puppeteerDir)
		if (!dirExists) {
			await fs.mkdir(puppeteerDir, { recursive: true })
		}

		const chromeExecutablePath = vscode.workspace.getConfiguration("cline").get<string>("chromeExecutablePath")
		if (chromeExecutablePath && !(await fileExistsAtPath(chromeExecutablePath))) {
			throw new Error(`Chrome executable not found at path: ${chromeExecutablePath}`)
		}
		const stats: PCRStats = chromeExecutablePath
			? { puppeteer: require("puppeteer-core"), executablePath: chromeExecutablePath }
			: // if chromium doesn't exist, this will download it to path.join(puppeteerDir, ".chromium-browser-snapshots")
				// if it does exist it will return the path to existing chromium
				await PCR({ downloadPath: puppeteerDir })

		return stats
	}

	async relaunchChromeDebugMode(webview?: vscode.Webview) {
		const result = await vscode.window.showWarningMessage(
			"This will close your existing Chrome tabs and relaunch Chrome in debug mode. Are you sure?",
			{ modal: true },
			"Yes",
		)

		if (result !== "Yes") {
			webview?.postMessage({ type: "browserRelaunchResult", success: false, text: "Operation cancelled by user" })
			return
		}

		try {
			// Kill any existing Chrome instances
			await chromeLauncher.killAll()

			// Launch Chrome with debug port
			const launcher = new chromeLauncher.Launcher({
				port: DEBUG_PORT,
				chromeFlags: ["--remote-debugging-port=" + DEBUG_PORT, "--no-first-run", "--no-default-browser-check"],
			})

			await launcher.launch()
			const installation = chromeLauncher.Launcher.getFirstInstallation()
			if (!installation) {
				throw new Error("Could not find Chrome installation on this system")
			}
			console.log("chrome installation", installation)

			webview?.postMessage({
				type: "browserRelaunchResult",
				success: true,
				text: "Browser successfully launched in debug mode",
			})
		} catch (error) {
			webview?.postMessage({
				type: "browserRelaunchResult",
				success: false,
				text: `Failed to relaunch Chrome: ${error instanceof Error ? error.message : String(error)}`,
			})
		}
	}

	//private async getSystemChromeExecutablePath(): Promise<string> {
	//	// Find installed Chrome
	//	const installation = chromeLauncher.Launcher.getFirstInstallation()
	//	if (!installation) {
	//		throw new Error("Could not find Chrome installation on this system")
	//	}
	//	console.log("chrome installation", installation)
	//	return installation
	//}

	async launchBrowser() {
		if (this.browser) {
			await this.closeBrowser() // this may happen when the model launches a browser again after having used it already before
		}

		if (this.browserSettings.remoteBrowserEnabled) {
			console.log(`launch browser called -- remote host mode (headless: ${this.browserSettings.headless})`)
			try {
				await this.launchRemoteBrowser()
				// Don't create a new page here, as we'll create it in launchRemoteBrowser
				return
			} catch (error) {
				console.error("Failed to launch remote browser, falling back to headless:", error)
				await this.launchLocalBrowser()
			}
		} else {
			console.log(`launch browser called -- local mode (headless: ${this.browserSettings.headless})`)
			await this.launchLocalBrowser()
		}

		this.page = await this.browser?.newPage()
	}

	async launchLocalBrowser() {
		const stats = await this.ensureChromiumExists()
		this.browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
			],
			executablePath: stats.executablePath,
			defaultViewport: this.browserSettings.viewport,
			headless: this.browserSettings.headless,
		})
	}

	async launchRemoteBrowser() {
		let remoteBrowserHost = this.browserSettings.remoteBrowserHost
		let browserWSEndpoint: string | undefined = this.cachedWebSocketEndpoint
		let reconnectionAttempted = false

		const getViewport = () => {
			const size = (this.context.globalState.get("browserViewportSize") as string | undefined) || "900x600"
			const [width, height] = size.split("x").map(Number)
			return { width, height }
		}

		// First try auto-discovery if no host is provided
		if (!remoteBrowserHost) {
			try {
				console.log("No remote browser host provided, trying auto-discovery")
				const discoveredHost = await discoverChromeInstances()

				if (discoveredHost) {
					console.log(`Auto-discovered Chrome at ${discoveredHost}`)
					remoteBrowserHost = discoveredHost
				}
			} catch (error) {
				console.log(`Auto-discovery failed: ${error}`)
			}
		}

		// Try to connect with cached endpoint first if it exists and is recent (less than 1 hour old)
		if (browserWSEndpoint && Date.now() - this.lastConnectionAttempt < 3600000) {
			try {
				console.log(`Attempting to connect using cached WebSocket endpoint: ${browserWSEndpoint}`)
				this.browser = await connect({
					browserWSEndpoint,
					defaultViewport: getViewport(),
				})
				this.page = await this.browser?.newPage()
				return
			} catch (error) {
				console.log(`Failed to connect using cached endpoint: ${error}`)
				// Clear the cached endpoint since it's no longer valid
				this.cachedWebSocketEndpoint = undefined
				// User wants to give up after one reconnection attempt
				if (remoteBrowserHost) {
					reconnectionAttempted = true
				}
			}
		}

		// Try to connect with host (either user-provided or auto-discovered)
		if (remoteBrowserHost) {
			try {
				// Fetch the WebSocket endpoint from the Chrome DevTools Protocol
				const versionUrl = `${remoteBrowserHost.replace(/\/$/, "")}/json/version`
				console.log(`Fetching WebSocket endpoint from ${versionUrl}`)

				const response = await axios.get(versionUrl)
				browserWSEndpoint = response.data.webSocketDebuggerUrl

				if (!browserWSEndpoint) {
					throw new Error("Could not find webSocketDebuggerUrl in the response")
				}

				console.log(`Found WebSocket browser endpoint: ${browserWSEndpoint}`)

				// Cache the successful endpoint
				this.cachedWebSocketEndpoint = browserWSEndpoint
				this.lastConnectionAttempt = Date.now()

				this.browser = await connect({
					browserWSEndpoint,
					defaultViewport: getViewport(),
				})
				this.page = await this.browser?.newPage()
				return
			} catch (error) {
				console.log(`Failed to connect to remote browser: ${error}`)
			}
		}

		// If we get here, all connection attempts failed
		throw new Error(
			"Failed to connect to remote browser. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
		)
	}

	async closeBrowser(): Promise<BrowserActionResult> {
		if (this.browser || this.page) {
			if (this.browserSettings.remoteBrowserEnabled && this.browser) {
				await this.browser.disconnect().catch(() => {})
				console.log("disconnected from remote browser...")
			} else {
				await this.browser?.close().catch(() => {})
				console.log("closed local browser...")
			}

			this.browser = undefined
			this.page = undefined
			this.currentMousePosition = undefined
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

		const consoleListener = (msg: any) => {
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
			if (!(err instanceof TimeoutError)) {
				logs.push(`[Error] ${err.toString()}`)
			}
		}

		// Wait for console inactivity, with a timeout
		await pWaitFor(() => Date.now() - lastLogTs >= 500, {
			timeout: 3_000,
			interval: 100,
		}).catch(() => {})

		let options: ScreenshotOptions = {
			encoding: "base64",

			// clip: {
			// 	x: 0,
			// 	y: 0,
			// 	width: 900,
			// 	height: 600,
			// },
		}

		let screenshotBase64 = await this.page.screenshot({
			...options,
			type: "webp",
		})
		let screenshot = `data:image/webp;base64,${screenshotBase64}`

		if (!screenshotBase64) {
			console.log("webp screenshot failed, trying png")
			screenshotBase64 = await this.page.screenshot({
				...options,
				type: "png",
			})
			screenshot = `data:image/png;base64,${screenshotBase64}`
		}

		if (!screenshotBase64) {
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
			let html = await page.content()
			let currentHTMLSize = html.length

			// let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length)
			console.log("last: ", lastHTMLSize, " <> curr: ", currentHTMLSize)

			if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
				countStableSizeIterations++
			} else {
				countStableSizeIterations = 0 //reset the counter
			}

			if (countStableSizeIterations >= minStableSizeIterations) {
				console.log("Page rendered fully...")
				break
			}

			lastHTMLSize = currentHTMLSize
			await setTimeoutPromise(checkDurationMsecs)
		}
	}

	async click(coordinate: string): Promise<BrowserActionResult> {
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
		return this.doAction(async (page) => {
			await page.keyboard.type(text)
		})
	}

	async scrollDown(): Promise<BrowserActionResult> {
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
}
