import fs from "fs/promises"
import { WebviewProvider } from "@/core/webview"
import { writeLgWebhookConfig, writeLgWebhookHooks } from "@/services/lg-cns-integration/webhook-hooks"
import { Logger } from "@/shared/services/Logger"

export const TASK_URI_PATH = "/task"
export const LG_TASK_URI_PATH = "/lg-task"

/**
 * Shared URI handler that processes both VSCode URI events and HTTP server callbacks
 */
export class SharedUriHandler {
	/**
	 * Processes a URI and routes it to the appropriate handler
	 * @param url The URI to process (can be from VSCode or converted from HTTP)
	 * @returns Promise<boolean> indicating success (true) or failure (false)
	 */
	public static async handleUri(url: string): Promise<boolean> {
		const parsedUrl = new URL(url)
		const path = parsedUrl.pathname

		// Create URLSearchParams from the query string, but preserve plus signs
		// by replacing them with a placeholder before parsing
		const queryString = parsedUrl.search.slice(1) // Remove leading '?'
		const query = new URLSearchParams(queryString.replace(/\+/g, "%2B"))

		Logger.info(
			"SharedUriHandler: Processing URI:" +
				JSON.stringify({
					path: path,
					query: query,
					scheme: parsedUrl.protocol,
				}),
		)

		const visibleWebview = WebviewProvider.getVisibleInstance()

		if (!visibleWebview) {
			Logger.warn("SharedUriHandler: No visible webview found")
			return false
		}

		try {
			switch (path) {
				case TASK_URI_PATH: {
					const prompt = query.get("prompt")
					if (prompt) {
						await visibleWebview.controller.handleTaskCreation(prompt)
						return true
					}
					Logger.warn("SharedUriHandler: Missing prompt parameter for task creation")
					return false
				}
				case LG_TASK_URI_PATH: {
					const promptFile = query.get("prompt-file")
					const webhookUrl = query.get("webhook-url")
					const webhookToken = query.get("webhook-token")

					if (!promptFile || !webhookUrl || !webhookToken) {
						Logger.warn("SharedUriHandler: Missing required parameters for LG task creation")
						return false
					}

					const specContents = await fs.readFile(promptFile, "utf-8")
					const prompt = [
						`The following file contains the development specification you must implement: ${promptFile}`,
						"",
						"Start by reading that file from disk. If context compaction happens later, re-read the same file path so you can continue tracking progress against the original requirements.",
						"",
						"For convenience, here is the current file content:",
						"",
						specContents,
					].join("\n")
					await writeLgWebhookConfig(webhookUrl, webhookToken)
					await writeLgWebhookHooks()
					await visibleWebview.controller.handleTaskCreation(prompt)
					return true
				}
				default:
					Logger.warn(`SharedUriHandler: Unknown path: ${path}`)
					return false
			}
		} catch (error) {
			Logger.error("SharedUriHandler: Error processing URI:", error)
			return false
		}
	}
}
