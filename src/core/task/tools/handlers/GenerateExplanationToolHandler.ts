import type { ToolUse } from "@core/assistant-message"
import {
	buildDiffContent,
	type ChangedFile,
	isBinaryFile,
	openDiffView,
	setupCommentController,
	streamAIExplanationComments,
	stringifyConversationHistory,
} from "@core/controller/task/explainChangesShared"
import { formatResponse } from "@core/prompts/responses"
import fs from "fs/promises"
import path from "path"
import simpleGit from "simple-git"
import type { ClineSayGenerateExplanation } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Helper to create a stringified ClineSayGenerateExplanation message
 */
function createExplanationMessage(
	title: string,
	fromRef: string,
	toRef: string,
	status: ClineSayGenerateExplanation["status"],
	error?: string,
): string {
	const message: ClineSayGenerateExplanation = { title, fromRef, toRef, status }
	if (error) {
		message.error = error
	}
	return JSON.stringify(message)
}

export class GenerateExplanationToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.GENERATE_EXPLANATION

	getDescription(block: ToolUse): string {
		const title = block.params.title || "code changes"
		return `[${block.name} for '${title}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Show loading message for partial blocks with available params
		const title = block.params.title || "code changes"
		const fromRef = block.params.from_ref || ""
		const toRef = block.params.to_ref || "working directory"
		const messageText = createExplanationMessage(title, fromRef, toRef, "generating")
		await uiHelpers.say("generate_explanation", messageText, undefined, undefined, true)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const title: string | undefined = block.params.title
		const fromRef: string | undefined = block.params.from_ref
		const toRef: string | undefined = block.params.to_ref // Optional - if not provided, compare to working directory

		// Validate required parameters
		if (!title) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "title")
		}

		if (!fromRef) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "from_ref")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show loading message with title and refs (auto-approved, no user prompt needed)
		const toRefDisplay = toRef || "working directory"
		await config.callbacks.say(
			"generate_explanation",
			createExplanationMessage(title, fromRef, toRefDisplay, "generating"),
			undefined,
			undefined,
			true, // partial=true so it can be updated later
		)

		// Get API configuration
		const apiConfiguration = config.services.stateManager.getApiConfiguration()
		if (!apiConfiguration) {
			await config.callbacks.say(
				"generate_explanation",
				createExplanationMessage(title, fromRef, toRefDisplay, "error", "API configuration not available"),
				undefined,
				undefined,
				false,
			)
			return formatResponse.toolError("API configuration not available")
		}

		try {
			// Use simple-git to get the diff between the two refs
			const cwd = config.cwd
			const git = simpleGit(cwd)

			// Verify it's a git repository
			const isRepo = await git.checkIsRepo()
			if (!isRepo) {
				const errorMsg = `The current directory (${cwd}) is not a git repository. This tool requires git to compare changes.`
				await config.callbacks.say(
					"generate_explanation",
					createExplanationMessage(title, fromRef, toRefDisplay, "error", errorMsg),
					undefined,
					undefined,
					false,
				)
				return formatResponse.toolError(errorMsg)
			}

			// Validate the refs exist
			try {
				await git.revparse([fromRef])
			} catch {
				const errorMsg = `Invalid git reference '${fromRef}'. Please provide a valid commit hash, branch name, tag, or relative reference (e.g., HEAD~1).`
				await config.callbacks.say(
					"generate_explanation",
					createExplanationMessage(title, fromRef, toRefDisplay, "error", errorMsg),
					undefined,
					undefined,
					false,
				)
				return formatResponse.toolError(errorMsg)
			}

			if (toRef) {
				try {
					await git.revparse([toRef])
				} catch {
					const errorMsg = `Invalid git reference '${toRef}'. Please provide a valid commit hash, branch name, tag, or relative reference.`
					await config.callbacks.say(
						"generate_explanation",
						createExplanationMessage(title, fromRef, toRefDisplay, "error", errorMsg),
						undefined,
						undefined,
						false,
					)
					return formatResponse.toolError(errorMsg)
				}
			}

			// Get the diff summary to find changed files
			const diffRange = toRef ? `${fromRef}..${toRef}` : fromRef
			const diffSummary = await git.diffSummary([diffRange])

			if (diffSummary.files.length === 0) {
				return formatResponse.toolResult(`No changes found between '${fromRef}' and '${toRef || "working directory"}'.`)
			}

			// Get before/after content for each changed file
			const changedFiles: ChangedFile[] = []

			for (const file of diffSummary.files) {
				const filePath = file.file
				const absolutePath = path.join(cwd, filePath)

				// Skip binary files - they can't be displayed properly in diff view
				if (isBinaryFile(filePath)) {
					continue
				}

				let beforeContent = ""
				try {
					beforeContent = await git.show([`${fromRef}:${filePath}`])
				} catch {
					// File didn't exist in the 'from' ref (new file)
				}

				let afterContent = ""
				if (toRef) {
					try {
						afterContent = await git.show([`${toRef}:${filePath}`])
					} catch {
						// File doesn't exist in the 'to' ref (deleted file)
					}
				} else {
					// Compare to working directory
					try {
						afterContent = await fs.readFile(absolutePath, "utf8")
					} catch {
						// File was deleted in working directory
					}
				}

				changedFiles.push({
					relativePath: filePath,
					absolutePath,
					before: beforeContent,
					after: afterContent,
				})
			}

			if (changedFiles.length === 0) {
				return formatResponse.toolResult(
					`All changed files between '${fromRef}' and '${toRef || "working directory"}' are binary files that cannot be displayed.`,
				)
			}

			// Get conversation context from the task's API conversation history
			const apiConversationHistory = config.messageState.getApiConversationHistory()
			const conversationContext = stringifyConversationHistory(apiConversationHistory)

			// Set up the comment controller with reply handler
			const commentController = await setupCommentController(apiConfiguration, changedFiles, conversationContext)

			// Build the diff content for the AI
			const diffContent = buildDiffContent(changedFiles)

			// For 3+ files, cycle through each file showing comments as they stream
			// For 2 or fewer files, just open the multi-diff view directly
			const shouldRevealComments = changedFiles.length >= 3

			// If 2 or fewer files, open the diff view first so user sees it immediately
			if (!shouldRevealComments) {
				await openDiffView(title, changedFiles)
			}

			// Stream AI explanation comments
			// Each comment will open its virtual doc and scroll to show the comment (if 3+ files)
			const commentCount = await streamAIExplanationComments(
				apiConfiguration,
				diffContent,
				`${title}\n\n${conversationContext}`,
				changedFiles,
				// onCommentStart: Create the comment UI immediately when we know the location
				(filePath, startLine, endLine) => {
					const matchingFile = changedFiles.find((f) => f.absolutePath === filePath)
					commentController.startStreamingComment(
						filePath,
						startLine,
						endLine,
						matchingFile?.relativePath,
						matchingFile?.after,
						shouldRevealComments, // Only cycle through files if 3+ files
					)
				},
				// onCommentChunk: Append text as it streams in
				(chunk) => {
					commentController.appendToStreamingComment(chunk)
				},
				// onCommentEnd: Finalize the comment
				() => {
					commentController.endStreamingComment()
				},
				// shouldAbort: Check if task was cancelled
				() => config.taskState.abort === true,
			)

			// Check if we were aborted during streaming
			if (config.taskState.abort) {
				// Close diff views and clear comments when cancelled
				commentController.clearAllComments()
				await commentController.closeDiffViews()
				return formatResponse.toolResult("Explanation generation was cancelled.")
			}

			// After all comments are done, open the multi-diff view to show everything together (if 3+ files)
			if (shouldRevealComments) {
				await openDiffView(title, changedFiles)
			}

			// Mark the UI as complete
			await config.callbacks.say(
				"generate_explanation",
				createExplanationMessage(title, fromRef, toRefDisplay, "complete"),
				undefined,
				undefined,
				false,
			)

			const refDescription = toRef ? `'${fromRef}' and '${toRef}'` : `'${fromRef}' and working directory`
			return formatResponse.toolResult(
				`Successfully generated ${commentCount} explanation comment${commentCount === 1 ? "" : "s"} for ${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"} between ${refDescription}. The diff view is now open with inline explanations.`,
			)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Error in generate_explanation:", errorMessage)
			await config.callbacks.say(
				"generate_explanation",
				createExplanationMessage(
					title,
					fromRef,
					toRefDisplay,
					"error",
					`Failed to generate explanations: ${errorMessage}`,
				),
				undefined,
				undefined,
				false,
			)
			return formatResponse.toolError(`Failed to generate explanations: ${errorMessage}`)
		}
	}
}
