import { HtmlPreviewMode, PreviewHtmlRequest, ShowHtmlPreviewRequest } from "@shared/proto/cline/html_preview"
import { AiHydroDefaultTool } from "@/shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class PreviewHtmlToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.PREVIEW_HTML

	/**
	 * Parse the HTML preview mode from tool parameters.
	 * Prefer new 'mode' param, fall back to deprecated 'interactive' for backward compatibility.
	 */
	static parseMode(modeRaw?: string, interactiveRaw?: string): HtmlPreviewMode {
		if (modeRaw) {
			const normalized = modeRaw.toLowerCase().trim()
			if (normalized === "interactive" || normalized === "1") {
				return HtmlPreviewMode.INTERACTIVE
			}
			if (normalized === "external_browser" || normalized === "external" || normalized === "2") {
				return HtmlPreviewMode.EXTERNAL_BROWSER
			}
			if (normalized === "safe" || normalized === "0") {
				return HtmlPreviewMode.SAFE
			}
		}
		if (!modeRaw && (interactiveRaw === "true" || interactiveRaw === "yes" || interactiveRaw === "1")) {
			return HtmlPreviewMode.INTERACTIVE
		}
		// Default: let the extension auto-detect (Folium/Plotly → interactive).
		return HtmlPreviewMode.UNSPECIFIED
	}

	getDescription(block: ToolUse): string {
		const title = block.params.title || "HTML Preview"
		return `[${block.name} - ${title}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// No streaming UI needed for preview_html - it's a one-shot action
		return
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const params = block.params as Record<string, string>
		const htmlContent: string | undefined = params.html
		const filePath: string | undefined = params.file_path
		const title: string | undefined = params.title
		const modeRaw: string | undefined = params.mode
		const interactiveRaw: string | undefined = params.interactive

		// Parse mode: prefer new 'mode' param, fall back to deprecated 'interactive' for backward compatibility
		const mode = PreviewHtmlToolHandler.parseMode(modeRaw, interactiveRaw)

		// Validate required parameters
		if (!htmlContent && !filePath) {
			config.taskState.consecutiveMistakeCount++
			return config.callbacks.sayAndCreateMissingParamError(this.name, "html or file_path")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Resolve file path if provided
		let resolvedContent = htmlContent
		if (filePath && !htmlContent) {
			try {
				const fs = await import("fs/promises")
				const path = await import("path")
				const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(config.cwd, filePath)
				resolvedContent = await fs.readFile(absolutePath, "utf-8")
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				await config.callbacks.say("error", `Failed to read HTML file: ${errorMessage}`)
				return formatResponse.toolError(`Failed to read HTML file at ${filePath}: ${errorMessage}`)
			}
		}

		if (!resolvedContent) {
			config.taskState.consecutiveMistakeCount++
			return config.callbacks.sayAndCreateMissingParamError(this.name, "html or file_path")
		}

		// Handle external_browser mode: open in system default browser
		if (mode === HtmlPreviewMode.EXTERNAL_BROWSER) {
			try {
				const vscode = await import("vscode")
				const tmpDir = vscode.Uri.file(config.cwd).fsPath
				const tmpFileName = `aihydro-preview-${Date.now()}.html`
				const { writeFileSync } = await import("fs")
				const path = await import("path")
				const tmpPath = path.join(tmpDir, tmpFileName)
				writeFileSync(tmpPath, resolvedContent, "utf-8")

				const uri = vscode.Uri.file(tmpPath)
				await vscode.env.openExternal(uri)

				await config.callbacks.say(
					"html_preview",
					JSON.stringify({
						title: title || "HTML Preview",
						filePath,
						mode: "external_browser",
						size: resolvedContent.length,
					}),
				)

				return formatResponse.toolResult(
					`HTML preview opened in your default external browser.${title ? ` Title: "${title}"` : ""}`,
				)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				await config.callbacks.say("error", `Failed to open HTML in external browser: ${errorMessage}`)
				return formatResponse.toolError(`Failed to open HTML in external browser: ${errorMessage}`)
			}
		}

		// Send preview to controller which will broadcast to all subscribers
		try {
			const { previewHtml } = await import("../../../controller/htmlPreview/previewHtml")
			await previewHtml(
				config.services.controller,
				PreviewHtmlRequest.create({
					htmlContent: resolvedContent,
					filePath: filePath || "",
					title: title || (filePath ? `Preview: ${filePath.split("/").pop()}` : "HTML Preview"),
					interactive: mode === HtmlPreviewMode.INTERACTIVE,
					mode,
				}),
			)

			// Auto-show the HTML preview panel
			const { showHtmlPreview } = await import("../../../controller/htmlPreview/showHtmlPreview")
			await showHtmlPreview(config.services.controller, ShowHtmlPreviewRequest.create({}))

			await config.callbacks.say(
				"html_preview",
				JSON.stringify({
					title: title || "HTML Preview",
					filePath,
					size: resolvedContent.length,
				}),
			)

			return formatResponse.toolResult("HTML preview opened in the AI-Hydro Preview panel.")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await config.callbacks.say("error", `Failed to preview HTML: ${errorMessage}`)
			return formatResponse.toolError(`Failed to preview HTML: ${errorMessage}`)
		}
	}
}
