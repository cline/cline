import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Browser, Page, ScreenshotOptions, TimeoutError, launch, connect } from "puppeteer-core"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import pWaitFor from "p-wait-for"
import delay from "delay"
import axios from "axios"
import { fileExistsAtPath } from "../../utils/fs"
import { BrowserActionResult } from "../../shared/ExtensionMessage"
import { discoverChromeInstances, testBrowserConnection } from "./browserDiscovery"

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

export class BrowserSession {
	private context: vscode.ExtensionContext
	private browser?: Browser
	private page?: Page
	private currentMousePosition?: string
	private cachedWebSocketEndpoint?: string
	private lastConnectionAttempt: number = 0

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	/**
	 * Test connection to a remote browser
	 */
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

		// if chromium doesn't exist, this will download it to path.join(puppeteerDir, ".chromium-browser-snapshots")
		// if it does exist it will return the path to existing chromium
		const stats: PCRStats = await PCR({
			downloadPath: puppeteerDir,
		})

		return stats
	}

	async launchBrowser(): Promise<void> {
		console.log("launch browser called")
		if (this.browser) {
			// throw new Error("Browser already launched")
			await this.closeBrowser() // this may happen when the model launches a browser again after having used it already before
		}

		// Function to get viewport size
		const getViewport = () => {
			const size = (this.context.globalState.get("browserViewportSize") as string | undefined) || "900x600"
			const [width, height] = size.split("x").map(Number)
			return { width, height }
		}

		// Check if remote browser connection is enabled
		const remoteBrowserEnabled = this.context.globalState.get("remoteBrowserEnabled") as boolean | undefined

		// If remote browser connection is not enabled, use local browser
		if (!remoteBrowserEnabled) {
			console.log("Remote browser connection is disabled, using local browser")
			const stats = await this.ensureChromiumExists()
			this.browser = await stats.puppeteer.launch({
				args: [
					"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				],
				executablePath: stats.executablePath,
				defaultViewport: getViewport(),
				// headless: false,
			})
			this.page = await this.browser?.newPage()
			return
		}
		// Remote browser connection is enabled
		let remoteBrowserHost = this.context.globalState.get("remoteBrowserHost") as string | undefined
		let browserWSEndpoint: string | undefined = this.cachedWebSocketEndpoint
		let reconnectionAttempted = false

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

		// If user provided a remote browser host, try to connect to it
		if (remoteBrowserHost && !reconnectionAttempted) {
			console.log(`Attempting to connect to remote browser at ${remoteBrowserHost}`)
			try {
				// Fetch the WebSocket endpoint from the Chrome DevTools Protocol
				const versionUrl = `${remoteBrowserHost.replace(/\/$/, "")}/json/version`
				console.log(`Fetching WebSocket endpoint from ${versionUrl}`)

				const response = await axios.get(versionUrl)
				browserWSEndpoint = response.data.webSocketDebuggerUrl

				if (!browserWSEndpoint) {
					throw new Error("Could not find webSocketDebuggerUrl in the response")
				}

				console.log(`Found WebSocket endpoint: ${browserWSEndpoint}`)

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
				console.error(`Failed to connect to remote browser: ${error}`)
				// Fall back to auto-discovery if remote connection fails
			}
		}

		// Always try auto-discovery if no custom URL is specified or if connection failed
		try {
			console.log("Attempting auto-discovery...")
			const discoveredHost = await discoverChromeInstances()

			if (discoveredHost) {
				console.log(`Auto-discovered Chrome at ${discoveredHost}`)

				// Don't save the discovered host to global state to avoid overriding user preference
				// We'll just use it for this session

				// Try to connect to the discovered host
				const testResult = await testBrowserConnection(discoveredHost)

				if (testResult.success && testResult.endpoint) {
					// Cache the successful endpoint
					this.cachedWebSocketEndpoint = testResult.endpoint
					this.lastConnectionAttempt = Date.now()

					this.browser = await connect({
						browserWSEndpoint: testResult.endpoint,
						defaultViewport: getViewport(),
					})
					this.page = await this.browser?.newPage()
					return
				}
			}
		} catch (error) {
			console.error(`Auto-discovery failed: ${error}`)
			// Fall back to local browser if auto-discovery fails
		}

		// If all remote connection attempts fail, fall back to local browser
		console.log("Falling back to local browser")
		const stats = await this.ensureChromiumExists()
		this.browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
			],
			executablePath: stats.executablePath,
			defaultViewport: getViewport(),
			// headless: false,
		})
		// (latest version of puppeteer does not add headless to user agent)
		this.page = await this.browser?.newPage()
	}

	async closeBrowser(): Promise<BrowserActionResult> {
		if (this.browser || this.page) {
			console.log("closing browser...")

			const remoteBrowserEnabled = this.context.globalState.get("remoteBrowserEnabled") as string | undefined
			if (remoteBrowserEnabled && this.browser) {
				await this.browser.disconnect().catch(() => {})
			} else {
				await this.browser?.close().catch(() => {})
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
			quality: ((await this.context.globalState.get("screenshotQuality")) as number | undefined) ?? 75,
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
			await page.goto(url, { timeout: 7_000, waitUntil: ["domcontentloaded", "networkidle2"] })
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
			await delay(checkDurationMsecs)
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
			await delay(100)

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
		const size = ((await this.context.globalState.get("browserViewportSize")) as string | undefined) || "900x600"
		const height = parseInt(size.split("x")[1])
		return this.doAction(async (page) => {
			await page.evaluate((scrollHeight) => {
				window.scrollBy({
					top: scrollHeight,
					behavior: "auto",
				})
			}, height)
			await delay(300)
		})
	}

	async scrollUp(): Promise<BrowserActionResult> {
		const size = ((await this.context.globalState.get("browserViewportSize")) as string | undefined) || "900x600"
		const height = parseInt(size.split("x")[1])
		return this.doAction(async (page) => {
			await page.evaluate((scrollHeight) => {
				window.scrollBy({
					top: -scrollHeight,
					behavior: "auto",
				})
			}, height)
			await delay(300)
		})
	}
}
