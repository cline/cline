import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { ToolResponse } from "../.."
import { ToolUse, ToolUseName } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { IToolHandler } from "../ToolExecutorCoordinator"

export class WebFetchToolHandler implements IToolHandler {
	name = "web_fetch"
	supportedTools: ToolUseName[] = ["web_fetch"]

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		const url: string | undefined = block.params.url

		if (!url) {
			throw new Error("URL is required for web_fetch")
		}

		const urlContentFetcher: UrlContentFetcher = config.urlContentFetcher

		try {
			// Fetch Markdown content
			await urlContentFetcher.launchBrowser()
			const markdownContent = await urlContentFetcher.urlToMarkdown(url)
			await urlContentFetcher.closeBrowser()

			// TODO: Implement secondary AI call to process markdownContent with prompt
			// For now, returning markdown directly.
			// This will be a significant sub-task.
			// Placeholder for processed summary:
			const processedSummary = `Fetched Markdown for ${url}:\n\n${markdownContent}`

			return formatResponse.toolResult(processedSummary)
		} catch (error) {
			// Ensure browser is closed on error
			await urlContentFetcher.closeBrowser()
			throw error
		}
	}
}
