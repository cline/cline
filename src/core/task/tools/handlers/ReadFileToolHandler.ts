import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { extractFileContent, type FileContentResult } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export const DEFAULT_MAX_LINES = 1000
const FILE_TRUNCATED_MARKER = "\n\n---\n\n[FILE TRUNCATED:"

/**
 * Slice file content to the requested line range, add one-based `N |` line labels,
 * and append a continuation hint when the file has more lines to read.
 */
export function formatFileContentWithLineNumbers(content: string, startLine?: number, endLine?: number): string {
	if (!content) {
		return content
	}

	// Separate any byte-truncation notice appended by content-limits.ts
	let body = content
	let truncationSuffix = ""
	const truncationIndex = content.indexOf(FILE_TRUNCATED_MARKER)
	if (truncationIndex !== -1) {
		body = content.slice(0, truncationIndex)
		truncationSuffix = content.slice(truncationIndex)
	}

	const lines = body.split(/\r?\n/)
	if (body.endsWith("\n") && lines.length > 0) {
		lines.pop()
	}
	const totalLines = lines.length

	const requestedStart = Math.max(1, startLine ?? 1)
	const requestedEnd = endLine !== undefined ? Math.max(1, endLine) : requestedStart + DEFAULT_MAX_LINES - 1
	const shouldSwapBounds = endLine !== undefined && requestedEnd < requestedStart
	const start = shouldSwapBounds ? requestedEnd : requestedStart
	const end = Math.min(totalLines, shouldSwapBounds ? requestedStart : requestedEnd)

	const slice = lines.slice(start - 1, end)
	const labeled = slice.map((line, i) => `${start + i} | ${line}`).join("\n")

	let suffix = truncationSuffix
	if (!truncationSuffix) {
		if (end < totalLines) {
			suffix = `\n\n(Showing lines ${start}-${end} of ${totalLines} total. Use start_line=${end + 1} to continue reading.)`
		} else {
			suffix = `\n\n(File has ${totalLines} lines total.)`
		}
	}

	return labeled + suffix
}

function parseRequestedLineRange(block: ToolUse): { startLine?: number; endLine?: number } {
	const startLine = block.params.start_line ? Number.parseInt(block.params.start_line, 10) : undefined
	const endLine = block.params.end_line ? Number.parseInt(block.params.end_line, 10) : undefined

	return {
		startLine: startLine !== undefined && !Number.isNaN(startLine) ? startLine : undefined,
		endLine: endLine !== undefined && !Number.isNaN(endLine) ? endLine : undefined,
	}
}

function buildReadResponse(block: ToolUse, fileContent: FileContentResult, prefix?: string): string {
	const { startLine, endLine } = parseRequestedLineRange(block)
	const text = fileContent.imageBlock
		? fileContent.text
		: formatFileContentWithLineNumbers(fileContent.text, startLine, endLine)

	return prefix ? `${prefix}\n${text}` : text
}

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.FILE_READ

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) {
			return
		}

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path

		// Extract provider information for telemetry
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Check clineignore access
		const accessValidation = this.validator.checkClineIgnorePath(relPath!)
		if (!accessValidation.ok) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("clineignore_error", relPath)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(relPath!))
		}

		// Resolve the absolute path based on multi-workspace configuration
		const pathResult = resolveWorkspacePath(config, relPath!, "ReadFileToolHandler.execute")
		const { absolutePath, displayPath } =
			typeof pathResult === "string" ? { absolutePath: pathResult, displayPath: relPath! } : pathResult

		// Determine workspace context for telemetry
		const fallbackAbsolutePath = path.resolve(config.cwd, relPath ?? "")
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: typeof pathResult !== "string", // multi-root path result indicates hint usage
			resolvedToNonPrimary: !arePathsEqual(absolutePath, fallbackAbsolutePath),
			resolutionMethod: (typeof pathResult !== "string" ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Handle approval flow
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, displayPath),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath!),
		} satisfies ClineSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		const shouldAutoApprove =
			config.isSubagentExecution || (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath))
		if (shouldAutoApprove) {
			// Auto-approval flow
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			}

			// Capture telemetry
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to read ${getWorkspaceBasename(absolutePath, "ReadFileToolHandler.notification")}`

			// Show notification
			showNotificationForApproval(notificationMessage, config.autoApprovalSettings.enableNotifications)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		// Run PreToolUse hook after approval but before execution
		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		// === File Read Deduplication ===
		// Check if we've already read this exact file in this task.
		// This prevents the model from endlessly reading the same file, which wastes API tokens.
		// The cache stores only metadata (readCount, mtime, imageBlock) — not file content —
		// to keep memory usage minimal. On cache hits we re-read from disk to return fresh content.
		const cacheKey = absolutePath.toLowerCase()
		const cached = config.taskState.fileReadCache.get(cacheKey)

		if (cached) {
			// Check if the file has been modified externally (e.g. user edited in their editor)
			// by comparing the mtime. If it changed, treat this as a fresh read.
			try {
				const stat = await import("node:fs/promises").then((fs) => fs.stat(absolutePath))
				if (stat.mtimeMs !== cached.mtime) {
					// File was modified externally — evict cache entry and fall through to fresh read
					config.taskState.fileReadCache.delete(cacheKey)
				}
			} catch {
				// If we can't stat the file, evict the cache and let extractFileContent handle the error
				config.taskState.fileReadCache.delete(cacheKey)
			}
		}

		// Re-check after possible mtime eviction
		const validCached = config.taskState.fileReadCache.get(cacheKey)

		if (validCached) {
			validCached.readCount++

			// Re-push image block for multimodal models so image context is not lost on cached reads
			if (validCached.imageBlock) {
				config.taskState.userMessageContent.push(validCached.imageBlock)
			}

			// Re-read from disk (cache doesn't store content to save memory)
			const supportsImages = config.api.getModel().info.supportsImages ?? false
			let fileContent: FileContentResult
			try {
				fileContent = await extractFileContent(absolutePath, supportsImages)
			} catch (error) {
				config.taskState.consecutiveMistakeCount++
				const errorMessage = error instanceof Error ? error.message : String(error)
				const normalizedMessage = errorMessage.startsWith("Error reading file:")
					? errorMessage
					: `Error reading file: ${errorMessage}`
				return formatResponse.toolError(normalizedMessage)
			}

			if (validCached.readCount >= 3) {
				return buildReadResponse(
					block,
					fileContent,
					`[DUPLICATE READ] You have already read '${displayPath}' ${validCached.readCount} times in this conversation. The content has not changed since your last read. Please use the information you already have and proceed with your task.`,
				)
			}

			return buildReadResponse(
				block,
				fileContent,
				`[File already read] The file '${displayPath}' was already read earlier in this conversation. Returning content:`,
			)
		}

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		let fileContent: FileContentResult
		try {
			fileContent = await extractFileContent(absolutePath, supportsImages)
		} catch (error) {
			// Return a graceful tool error instead of crashing. This allows the
			// model to see the error (e.g. "File not found") and recover by
			// trying a different path, rather than terminating the entire task.
			config.taskState.consecutiveMistakeCount++
			const errorMessage = error instanceof Error ? error.message : String(error)
			const normalizedMessage = errorMessage.startsWith("Error reading file:")
				? errorMessage
				: `Error reading file: ${errorMessage}`
			return formatResponse.toolError(normalizedMessage)
		}

		// Only reset mistake count after a successful read, so that repeated
		// file-not-found errors accumulate toward the yolo-mode mistake limit.
		config.taskState.consecutiveMistakeCount = 0

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Cache metadata for deduplication (no content stored — saves memory)
		let mtime = 0
		try {
			const stat = await import("node:fs/promises").then((fs) => fs.stat(absolutePath))
			mtime = stat.mtimeMs
		} catch {
			// If stat fails, use 0 — the next cache hit will evict due to mtime mismatch
		}
		config.taskState.fileReadCache.set(cacheKey, {
			readCount: 1,
			mtime,
			imageBlock: fileContent.imageBlock,
		})

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (fileContent.imageBlock) {
			config.taskState.userMessageContent.push(fileContent.imageBlock)
			return buildReadResponse(block, fileContent)
		}

		return buildReadResponse(block, fileContent)
	}
}
