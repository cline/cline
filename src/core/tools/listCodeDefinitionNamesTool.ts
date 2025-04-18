import path from "path"
import fs from "fs/promises"

import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { parseSourceCodeForDefinitionsTopLevel, parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"

export async function listCodeDefinitionNamesTool(
	cline: Cline,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path

	const sharedMessageProps: ClineSayTool = {
		tool: "listCodeDefinitionNames",
		path: getReadablePath(cline.cwd, removeClosingTag("path", relPath)),
	}

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!relPath) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("list_code_definition_names")
				pushToolResult(await cline.sayAndCreateMissingParamError("list_code_definition_names", "path"))
				return
			}

			cline.consecutiveMistakeCount = 0

			const absolutePath = path.resolve(cline.cwd, relPath)
			let result: string

			try {
				const stats = await fs.stat(absolutePath)

				if (stats.isFile()) {
					const fileResult = await parseSourceCodeDefinitionsForFile(absolutePath, cline.rooIgnoreController)
					result = fileResult ?? "No source code definitions found in cline file."
				} else if (stats.isDirectory()) {
					result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, cline.rooIgnoreController)
				} else {
					result = "The specified path is neither a file nor a directory."
				}
			} catch {
				result = `${absolutePath}: does not exist or cannot be accessed.`
			}

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: result } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			if (relPath) {
				await cline.getFileContextTracker().trackFileContext(relPath, "read_tool" as RecordSource)
			}

			pushToolResult(result)
			return
		}
	} catch (error) {
		await handleError("parsing source code definitions", error)
		return
	}
}
