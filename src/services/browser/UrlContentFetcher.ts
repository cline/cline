import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Browser, Page, launch } from "puppeteer-core"
import * as cheerio from "cheerio"
import TurndownService from "turndown"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import { fileExistsAtPath } from "../../utils/fs"
import { serializeError } from "serialize-error"

// Timeout constants
const URL_FETCH_TIMEOUT = 30_000 // 30 seconds
const URL_FETCH_FALLBACK_TIMEOUT = 20_000 // 20 seconds for fallback

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

export class UrlContentFetcher {
	private context: vscode.ExtensionContext
	private browser?: Browser
	private page?: Page

	constructor(context: vscode.ExtensionContext) {
		this.context = context
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
		if (this.browser) {
			return
		}
		const stats = await this.ensureChromiumExists()
		this.browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				"--disable-dev-shm-usage",
				"--disable-accelerated-2d-canvas",
				"--no-first-run",
				"--disable-gpu",
				"--disable-features=VizDisplayCompositor",
			],
			executablePath: stats.executablePath,
		})
		// (latest version of puppeteer does not add headless to user agent)
		this.page = await this.browser?.newPage()

		// Set additional page configurations to improve loading success
		if (this.page) {
			await this.page.setViewport({ width: 1280, height: 720 })
			await this.page.setExtraHTTPHeaders({
				"Accept-Language": "en-US,en;q=0.9",
			})
		}
	}

	async closeBrowser(): Promise<void> {
		await this.browser?.close()
		this.browser = undefined
		this.page = undefined
	}

	// must make sure to call launchBrowser before and closeBrowser after using this
	async urlToMarkdown(url: string): Promise<string> {
		if (!this.browser || !this.page) {
			throw new Error("Browser not initialized")
		}
		/*
		- networkidle2 is equivalent to playwright's networkidle where it waits until there are no more than 2 network connections for at least 500 ms.
		- domcontentloaded is when the basic DOM is loaded
		this should be sufficient for most doc sites
		*/
		try {
			await this.page.goto(url, {
				timeout: URL_FETCH_TIMEOUT,
				waitUntil: ["domcontentloaded", "networkidle2"],
			})
		} catch (error) {
			// Use serialize-error to safely extract error information
			const serializedError = serializeError(error)
			const errorMessage = serializedError.message || String(error)
			const errorName = serializedError.name

			// Only retry for timeout or network-related errors
			const shouldRetry =
				errorMessage.includes("timeout") ||
				errorMessage.includes("net::") ||
				errorMessage.includes("NetworkError") ||
				errorMessage.includes("ERR_") ||
				errorName === "TimeoutError"

			if (shouldRetry) {
				// If networkidle2 fails due to timeout/network issues, try with just domcontentloaded as fallback
				console.warn(
					`Failed to load ${url} with networkidle2, retrying with domcontentloaded only: ${errorMessage}`,
				)
				await this.page.goto(url, {
					timeout: URL_FETCH_FALLBACK_TIMEOUT,
					waitUntil: ["domcontentloaded"],
				})
			} else {
				// For other errors, throw them as-is
				throw error
			}
		}

		const content = await this.page.content()

		// use cheerio to parse and clean up the HTML
		const $ = cheerio.load(content)
		$("script, style, nav, footer, header").remove()

		// convert cleaned HTML to markdown
		const turndownService = new TurndownService()
		const markdown = turndownService.turndown($.html())

		return markdown
	}
}
