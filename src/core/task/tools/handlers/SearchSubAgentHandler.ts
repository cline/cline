import type { ToolUse } from "@core/assistant-message"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { SearchAgent } from "@/core/agents/SearchAgent"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class SearchSubAgentHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.SEARCH_AGENT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	private async buildToolMessage(config: TaskConfig, block: ToolUse, content: string, parsedPath: string): Promise<string> {
		const sharedProps: ClineSayTool = {
			tool: block.params.input ? "searchAgent" : "searchFiles",
			path: getReadablePath(config.cwd, block.params.path),
			content,
			regex: block.params.regex,
			filePattern: block.params.input || block.params.file_pattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		}

		return JSON.stringify(sharedProps)
	}

	private async buildPartialToolMessage(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<string> {
		const config = uiHelpers.getConfig()
		const sharedProps: ClineSayTool = {
			tool: block.params.input ? "searchAgent" : "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", block.params.path)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", block.params.regex),
			filePattern: block.params.input || uiHelpers.removeClosingTag(block, "file_pattern", block.params.file_pattern),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
		}

		return JSON.stringify(sharedProps)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = await this.buildPartialToolMessage(block, uiHelpers)
		const isAutoApprove = await uiHelpers.shouldAutoApproveToolWithPath(block.name, block.params.path)

		if (isAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const searchInput: string | undefined = block.params.input

		if (!searchInput) {
			throw new Error("Search input is required for SearchSubAgentHandler.")
		}

		return await this.performNaturalLanguageSearch(config, block, searchInput)
	}

	private async performNaturalLanguageSearch(config: TaskConfig, block: ToolUse, searchInput: string): Promise<ToolResponse> {
		try {
			const agent = new SearchAgent(config, 3, async (update) => {
				// Build a partial message showing the progress
				const progress = `[${update.iteration + 1}/${update.maxIterations}]`
				let statusText = progress

				if (update.message) {
					statusText += ` - ${update.message}`
				}

				if (update.actions) {
					const toolCallCount = update.actions.toolCalls.length
					const contextFileCount = update.actions.contextFiles.length

					if (update.actions.isReadyToAnswer) {
						statusText += ` - Ready to answer`
						if (contextFileCount > 0) {
							statusText += ` with ${contextFileCount} file${contextFileCount > 1 ? "s" : ""}`
						}
					} else if (toolCallCount > 0) {
						statusText += ` - Executing ${toolCallCount} tool call${toolCallCount > 1 ? "s" : ""}`
					}
				}

				const partialMessage = await this.buildToolMessage(config, block, statusText, block.params.path || "")
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", partialMessage, undefined, undefined, true)
			})

			const searchResults = await agent.execute(searchInput)
			const formattedResults = Array.isArray(searchResults)
				? searchResults?.map((r) => (r.type === "text" ? r.text : ""))?.join("\n\n")
				: searchResults
			const completeMessage = await this.buildToolMessage(config, block, formattedResults, block.params.path || "")
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			return searchResults
		} catch (error) {
			console.error("Natural language search error:", error)
			return `Natural language search error: ${error instanceof Error ? error.message : String(error)}`
		}
	}
}
