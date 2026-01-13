import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings" // Import the interface and defaults
import * as cheerio from "cheerio"
import { Browser, Page } from "puppeteer-core"
import TurndownService from "turndown"
import * as vscode from "vscode"
import { ensureChromiumExists } from "./utils"

export class UrlContentFetcher {
	private context: vscode.ExtensionContext
	private browser?: Browser
	private page?: Page

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	async launchBrowser(): Promise<void> {
		if (this.browser) {
			return
		}
		const stats = await ensureChromiumExists()
		// Read browser settings from globalState for custom args only
		const browserSettings = this.context.globalState.get<BrowserSettings>("browserSettings", DEFAULT_BROWSER_SETTINGS)
		const customArgsStr = browserSettings.customArgs || ""
		const customArgs = customArgsStr.trim() ? customArgsStr.split(/\s+/) : []
		this.browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
				...customArgs, // Append user-provided custom arguments
			],
			executablePath: stats.executablePath,
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
