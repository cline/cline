import { corporateResearchRequest } from "@bedrock-coder/core"
import * as cheerio from "cheerio"
import TurndownService from "turndown"

export class UrlContentFetcher {
	async launchBrowser(): Promise<void> {
		// Kept for the existing mention-parser lifecycle. Corporate-safe URL
		// retrieval does not launch a browser or inherit cookies/profile state.
	}

	async closeBrowser(): Promise<void> {}

	async urlToMarkdown(url: string): Promise<string> {
		const response = await corporateResearchRequest(url, {
			method: "GET",
			timeoutMs: 10_000,
			maxResponseBytes: 2_000_000,
			maxRedirects: 3,
		})
		const content = new TextDecoder("utf-8").decode(response.body)
		const contentType = response.headers.get("content-type") ?? ""
		if (!contentType.includes("html") && !contentType.includes("xhtml")) {
			return content
		}

		// use cheerio to parse and clean up the HTML
		const $ = cheerio.load(content)
		$("script, style, nav, footer, header").remove()

		// convert cleaned HTML to markdown
		const turndownService = new TurndownService()
		const markdown = turndownService.turndown($.html())

		return markdown
	}
}
