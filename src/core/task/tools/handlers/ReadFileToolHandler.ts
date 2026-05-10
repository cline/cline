import path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { getWorkspaceBasename, resolveWorkspacePath } from "@core/workspace"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { AiHydroSayTool } from "@/shared/ExtensionMessage"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.FILE_READ

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

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

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		// Check aihydroignore access
		const accessValidation = this.validator.checkAiHydroIgnorePath(relPath!)
		if (!accessValidation.ok) {
			await config.callbacks.say("aihydroignore_error", relPath)
			return formatResponse.toolError(formatResponse.aihydroIgnoreError(relPath!))
		}

		config.taskState.consecutiveMistakeCount = 0

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
		} satisfies AiHydroSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			if (!config.yoloModeToggled) {
				config.taskState.consecutiveAutoApprovedRequestsCount++
			}

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true, workspaceContext)
		} else {
			// Manual approval flow
			const notificationMessage = `AI-Hydro wants to read ${getWorkspaceBasename(absolutePath, "ReadFileToolHandler.notification")}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					false,
					false,
					workspaceContext,
				)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					false,
					true,
					workspaceContext,
				)
			}
		}

		// === File Read Deduplication ===
		// Check if we've already read this exact file in this task.
		// Cache stores only metadata (readCount, mtime) — not content — to keep memory usage minimal.
		// On cache hits we re-read from disk to return fresh content.
		const cacheKey = absolutePath.toLowerCase()
		const cached = config.taskState.fileReadCache.get(cacheKey)

		if (cached) {
			// Check if the file has been modified externally (e.g. user edited in their editor)
			try {
				const { stat } = await import("node:fs/promises")
				const fileStat = await stat(absolutePath)
				if (fileStat.mtimeMs !== cached.mtime) {
					config.taskState.fileReadCache.delete(cacheKey)
				}
			} catch {
				config.taskState.fileReadCache.delete(cacheKey)
			}
		}

		const validCached = config.taskState.fileReadCache.get(cacheKey)

		if (validCached) {
			validCached.readCount++

			if (validCached.imageBlock) {
				config.taskState.userMessageContent.push(validCached.imageBlock)
			}

			const supportsImagesForCache = config.api.getModel().info.supportsImages ?? false
			let cachedFileContent: { text: string; imageBlock?: any }
			try {
				cachedFileContent = await extractFileContent(absolutePath, supportsImagesForCache)
			} catch (error) {
				config.taskState.consecutiveMistakeCount++
				const errorMessage = error instanceof Error ? error.message : String(error)
				const normalizedMessage = errorMessage.startsWith("Error reading file:")
					? errorMessage
					: `Error reading file: ${errorMessage}`
				return formatResponse.toolError(normalizedMessage)
			}

			await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

			if (validCached.readCount >= 3) {
				return `[DUPLICATE READ] You have already read '${displayPath}' ${validCached.readCount} times in this conversation. The content has not changed since your last read. Please use the information you already have and proceed with your task.\n\n${cachedFileContent.text}`
			}

			return `[File already read] The file '${displayPath}' was already read earlier in this conversation. Returning content:\n${cachedFileContent.text}`
		}

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		const fileContent = await extractFileContent(absolutePath, supportsImages)

		// Cache metadata for deduplication (no content stored — saves memory)
		let mtime = 0
		try {
			const { stat } = await import("node:fs/promises")
			const fileStat = await stat(absolutePath)
			mtime = fileStat.mtimeMs
		} catch {
			// If stat fails, use 0 — the next cache hit will evict due to mtime mismatch
		}
		config.taskState.fileReadCache.set(cacheKey, {
			readCount: 1,
			mtime,
			imageBlock: fileContent.imageBlock,
		})

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (fileContent.imageBlock) {
			config.taskState.userMessageContent.push(fileContent.imageBlock)
		}

		return fileContent.text
	}
}
