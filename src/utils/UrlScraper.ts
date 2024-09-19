import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { Browser } from "puppeteer-core"
import * as cheerio from "cheerio"
import TurndownService from "turndown"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"

const PUPPETEER_DIR = "puppeteer"

export class UrlScraper {
	private context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	private async ensureChromiumExists(): Promise<void> {
		const globalStoragePath = this.context?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}

		const puppeteerDir = path.join(globalStoragePath, PUPPETEER_DIR)

		if (!(await fileExists(puppeteerDir))) {
			await fs.mkdir(puppeteerDir, { recursive: true })
		}

		const chromiumPath = path.join(puppeteerDir, ".chromium-browser-snapshots")

		if (!(await fileExists(chromiumPath))) {
			// If Chromium doesn't exist, download it
			await PCR({
				downloadPath: puppeteerDir,
			})
		}
	}

	async urlToMarkdown(url: string): Promise<string> {
		await this.ensureChromiumExists()

		const globalStoragePath = this.context?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const puppeteerDir = path.join(globalStoragePath, PUPPETEER_DIR)

		const stats = await PCR({
			downloadPath: puppeteerDir,
		})
		const browser: Browser = await stats.puppeteer.launch({
			args: [
				"--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36",
			],
			executablePath: stats.executablePath,
		})

		try {
			const page = await browser.newPage()

			/*
			- networkidle2 is equivalent to playwright's networkidle where it waits until there are no more than 2 network connections for at least 500 ms.
			- domcontentloaded is when the basic DOM is loaded
			this should be sufficient for most doc sites, but we can use the more elaborate waitTillHTMLRendered if we find users are scraping more dynamic complex sites
			*/
			await page.goto(url, { timeout: 10_000, waitUntil: ["domcontentloaded", "networkidle2"] })
			// await this.waitTillHTMLRendered(page)
			const content = await page.content()

			// Use Cheerio to parse and clean up the HTML
			const $ = cheerio.load(content)
			$("script, style, nav, footer").remove() // Remove unnecessary elements (todo: make this more robust)

			// Convert cleaned HTML to Markdown
			const turndownService = new TurndownService()
			const markdown = turndownService.turndown($.html())

			return markdown
		} finally {
			await browser.close()
		}
	}

	// page.goto { waitUntil: "networkidle0" } may not ever resolve, and not waiting could return page content too early before js has loaded
	// https://stackoverflow.com/questions/52497252/puppeteer-wait-until-page-is-completely-loaded/61304202#61304202
	/*
	private async waitTillHTMLRendered(page: Page, timeout = 10_000) {
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
	*/
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.access(path)
		return true
	} catch {
		return false
	}
}
