import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Browser, Page, launch } from "puppeteer-core"
import * as cheerio from "cheerio"
import TurndownService from "turndown"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import { fileExistsAtPath } from "@utils/fs"
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings" // Import the interface and defaults

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

		// Read browser settings from globalState (custom storage)
		const browserSettings = this.context.globalState.get<BrowserSettings>("browserSettings", DEFAULT_BROWSER_SETTINGS)
		const settingExecutablePath = browserSettings.chromeExecutablePath || ""
		const customArgsStr = browserSettings.customArgs || ""
		const customArgs = customArgsStr.trim() ? customArgsStr.split(/\s+/) : []

		let executablePath: string
		let puppeteerLaunch: typeof launch

		if (settingExecutablePath) {
			// Use user-provided executable path (e.g., system Chrome)
			executablePath = settingExecutablePath
			puppeteerLaunch = launch // From puppeteer-core
		} else {
			// Fall back to PCR for auto-detection/download
			const stats = await this.ensureChromiumExists()
			executablePath = stats.executablePath
			puppeteerLaunch = stats.puppeteer.launch
		}

		this.browser = await puppeteerLaunch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				...customArgs, // Append user-provided custom arguments
			],
			executablePath
		})
		// (latest version of puppeteer does not add headless to user agent)
		this.page = await this.browser?.newPage()
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
		await this.page.goto(url, {
			timeout: 10_000,
			waitUntil: ["domcontentloaded", "networkidle2"],
		})
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
