import fs from "fs/promises"
import path from "path"
import { ensureHooksDirectoryExists, getDocumentsPath } from "@/core/storage/disk"
import { WebviewProvider } from "@/core/webview"
import { Logger } from "@/shared/services/Logger"
import { getLgWebhookHookScripts } from "./lgWebhookHooks"

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
				case "/openrouter": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleOpenRouterCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for OpenRouter callback")
					return false
				}
				case "/requesty": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleRequestyCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Requesty callback")
					return false
				}
				case "/auth": {
					const provider = query.get("provider")

					Logger.info(`SharedUriHandler - Auth callback received for ${provider} - ${path}`)

					const token = query.get("refreshToken") || query.get("idToken") || query.get("code")
					if (token) {
						await visibleWebview.controller.handleAuthCallback(token, provider)
						return true
					}
					Logger.warn("SharedUriHandler: Missing idToken parameter for auth callback")
					return false
				}
				case "/auth/oca": {
					Logger.log("SharedUriHandler: Oca Auth callback received:", { path: path })

					const code = query.get("code")
					const state = query.get("state")

					if (code && state) {
						await visibleWebview.controller.handleOcaAuthCallback(code, state)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for auth callback")
					return false
				}
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
					await SharedUriHandler.writeLgWebhookConfig(webhookUrl, webhookToken)
					await SharedUriHandler.writeLgWebhookHooks()
					await visibleWebview.controller.handleTaskCreation(prompt)
					return true
				}
				// Match /mcp-auth/callback/{hash}
				case path.match(/^\/mcp-auth\/callback\/[^/]+$/)?.input: {
					const serverHash = path.split("/").pop()
					const code = query.get("code")
					const state = query.get("state")

					if (!code || !serverHash) {
						Logger.warn("SharedUriHandler: Missing code or hash in MCP OAuth callback")
						return false
					}

					await visibleWebview.controller.handleMcpOAuthCallback(serverHash, code, state)
					return true
				}
				case "/hicap": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleHicapCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Hicap callback")
					return false
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

	private static async writeLgWebhookConfig(webhookUrl: string, webhookToken: string): Promise<void> {
		const documentsPath = await getDocumentsPath()
		const clineDir = path.join(documentsPath, "Cline")
		const configPath = path.join(clineDir, "webhook_config.json")

		await fs.mkdir(clineDir, { recursive: true })
		await fs.writeFile(
			configPath,
			JSON.stringify(
				{
					webhook_url: webhookUrl,
					webhook_token: webhookToken,
					created_at: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf-8",
		)
	}

	private static async writeLgWebhookHooks(): Promise<void> {
		const hooksDir = await ensureHooksDirectoryExists()
		const hooks = getLgWebhookHookScripts()

		for (const hook of hooks) {
			const hookPath = path.join(hooksDir, hook.fileName)
			await fs.writeFile(hookPath, hook.content, "utf-8")
			if (hook.mode !== undefined) {
				await fs.chmod(hookPath, hook.mode)
			}
		}
	}
}
