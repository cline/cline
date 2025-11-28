import { buildApiHandler } from "@core/api"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { findLast } from "@shared/array"
import { Empty } from "@shared/proto/cline/common"
import { ExplainChangesRequest } from "@shared/proto/cline/task"
import { HostProvider } from "@/hosts/host-provider"
import { getCommentReviewController } from "@/hosts/vscode/review/CommentReviewController"
import { formatContentBlockToMarkdown } from "@/integrations/misc/export-markdown"
import { ApiConfiguration } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from ".."
import { sendRelinquishControlEvent } from "../ui/subscribeToRelinquishControl"

/**
 * Explains the changes made by the AI and adds inline comments explaining them.
 *
 * This handler streams comments in real-time:
 * 1. Gets the diff from the checkpoint tracker
 * 2. Opens the diff view IMMEDIATELY so user sees progress
 * 3. Streams the AI response and adds comments as they're generated
 * 4. Each comment appears in the diff view as soon as it's parsed
 */
export async function explainChanges(controller: Controller, request: ExplainChangesRequest): Promise<Empty> {
	const relinquishButton = () => {
		sendRelinquishControlEvent()
	}

	try {
		// Validate we have an active task with checkpoint manager
		if (!controller.task) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No active task",
			})
			relinquishButton()
			return Empty.create({})
		}

		const checkpointManager = controller.task.checkpointManager as any
		if (!checkpointManager) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Checkpoints not enabled",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Check if checkpoints are enabled
		if (!checkpointManager.config?.enableCheckpoints) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Checkpoints are disabled in settings. Cannot review changes.",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get message state handler
		const messageStateHandler = checkpointManager.services?.messageStateHandler
		if (!messageStateHandler) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Message state handler not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Find the message
		const clineMessages = messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m: any) => m.ts === request.messageTs)
		const message = clineMessages[messageIndex]

		if (!message) {
			console.error(`[explainChanges] Message not found for timestamp ${request.messageTs}`)
			relinquishButton()
			return Empty.create({})
		}

		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error(`[explainChanges] No checkpoint hash found for message ${request.messageTs}`)
			relinquishButton()
			return Empty.create({})
		}

		// Initialize checkpoint tracker if needed (same logic as presentMultifileDiff)
		if (
			!checkpointManager.state?.checkpointTracker &&
			checkpointManager.config?.enableCheckpoints &&
			!checkpointManager.state?.checkpointManagerErrorMessage
		) {
			try {
				const workspacePath = await checkpointManager.getWorkspacePath()
				checkpointManager.state.checkpointTracker = await CheckpointTracker.create(
					checkpointManager.task.taskId,
					checkpointManager.config.enableCheckpoints,
					workspacePath,
				)
				messageStateHandler.setCheckpointTracker(checkpointManager.state.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error(`[explainChanges] Failed to initialize checkpoint tracker:`, errorMessage)
				checkpointManager.state.checkpointManagerErrorMessage = errorMessage
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: errorMessage,
				})
				relinquishButton()
				return Empty.create({})
			}
		}

		const checkpointTracker = checkpointManager.state?.checkpointTracker as CheckpointTracker | undefined
		if (!checkpointTracker) {
			console.error(`[explainChanges] Checkpoint tracker not available`)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Checkpoint tracker not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get changed files (using seeNewChangesSinceLastTaskCompletion logic)
		const lastTaskCompletedMessageCheckpointHash = findLast(
			clineMessages.slice(0, messageIndex),
			(m: any) => m.say === "completion_result",
		)?.lastCheckpointHash

		const firstCheckpointMessageCheckpointHash = clineMessages.find(
			(m: any) => m.say === "checkpoint_created",
		)?.lastCheckpointHash

		const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

		if (!previousCheckpointHash) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Unexpected error: No checkpoint hash found",
			})
			relinquishButton()
			return Empty.create({})
		}

		const changedFiles = await checkpointTracker.getDiffSet(previousCheckpointHash, hash)
		if (!changedFiles?.length) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "No changes found to review",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get API configuration
		const apiConfiguration = controller.stateManager.getApiConfiguration()
		if (!apiConfiguration) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "API configuration not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Open the diff view
		await HostProvider.diff.openMultiFileDiff({
			title: "Explain Changes",
			diffs: changedFiles.map((file) => ({
				filePath: file.absolutePath,
				leftContent: file.before,
				rightContent: file.after,
			})),
		})

		// Set up the comment controller
		const commentController = getCommentReviewController()
		commentController.clearAllComments()

		// Build the diff content for the AI
		const diffContent = buildDiffContent(changedFiles)

		// Get conversation summary for context
		const apiConversationHistory = messageStateHandler.getApiConversationHistory()
		const conversationSummary = getConversationSummary(apiConversationHistory)

		// Set up reply handler for conversations (with access to conversation context)
		commentController.setOnReplyCallback(async (filePath, startLine, endLine, replyText, existingComments, onChunk) => {
			await handleCommentReply(
				controller,
				filePath,
				startLine,
				endLine,
				replyText,
				existingComments,
				changedFiles,
				conversationSummary,
				onChunk,
			)
		})

		// Stream AI review comments and add them as they arrive
		await streamAIReviewComments(
			apiConfiguration,
			diffContent,
			conversationSummary,
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
		)

		// Relinquish button after comments are done
		relinquishButton()
		return Empty.create({})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		console.error("Error in explainChanges:", errorMessage)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to explain changes: " + errorMessage,
		})
		sendRelinquishControlEvent()
		return Empty.create({})
	}
}

/**
 * Build a unified diff content string for the AI
 */
function buildDiffContent(
	changedFiles: Array<{ relativePath: string; absolutePath: string; before: string; after: string }>,
): string {
	const parts: string[] = []

	for (const file of changedFiles) {
		parts.push(`\n=== File: ${file.relativePath} ===\n`)
		parts.push(`--- Before ---\n${file.before || "(new file)"}\n`)
		parts.push(`--- After ---\n${file.after || "(deleted)"}\n`)
	}

	return parts.join("\n")
}

/**
 * Get a summary of the conversation for context
 */
function getConversationSummary(apiConversationHistory: ClineStorageMessage[]): string {
	return apiConversationHistory
		.map((message) => {
			const role = message.role === "user" ? "**User:**" : "**Assistant:**"
			const content = Array.isArray(message.content)
				? message.content.map((block) => formatContentBlockToMarkdown(block)).join("\n")
				: message.content
			return `${role}\n\n${content}\n\n`
		})
		.join("---\n\n")
}

const REVIEWER_SYSTEM_PROMPT = `You are an AI coding assistant explaining the changes you just made to a developer. Your goal is to help the user understand what changed and why, bridging the gap that AI-assisted development can create between users and their code.
- Use a friendly, conversational tone as if pair programming
- When relevant, briefly explain technical concepts or patterns you used
- Focus on helping the user learn and maintain ownership of their codebase
- Highlight any important decisions, trade-offs, or things the user should be aware of`

/**
 * Stream AI review comments with real-time updates.
 * Uses a structured format that allows creating comment UI immediately when location is known,
 * then streaming the comment text as it arrives.
 *
 * Format:
 * @@@ FILE: /path/to/file.ts
 * @@@ LINES: 10-45
 * Comment text streams here...
 * @@@
 */
async function streamAIReviewComments(
	apiConfiguration: any,
	diffContent: string,
	conversationSummary: string,
	changedFiles: Array<{ relativePath: string; absolutePath: string; before: string; after: string }>,
	onCommentStart: (filePath: string, startLine: number, endLine: number) => void,
	onCommentChunk: (chunk: string) => void,
	onCommentEnd: () => void,
): Promise<number> {
	// Disable thinking/reasoning for faster response (better UX for comments)
	const configWithoutThinking: ApiConfiguration = {
		...apiConfiguration,
		actModeThinkingBudgetTokens: 0,
		planModeThinkingBudgetTokens: 0,
	}
	const apiHandler = buildApiHandler(configWithoutThinking, "act")

	const systemPrompt = `${REVIEWER_SYSTEM_PROMPT}

CRITICAL: Create comments for LOGICAL GROUPINGS of changes, not individual lines. Think in terms of:
- "Added a new function that does X" (spanning the entire function)
- "Refactored error handling in this section" (spanning all related changes)
- "Updated imports and dependencies" (one comment for all import changes)

OUTPUT FORMAT - Use this exact structure for each comment:
@@@ FILE: /absolute/path/to/file.ts
@@@ LINES: 10-45
Your explanation of what changed and why goes here. Can be multiple sentences.
@@@

@@@ FILE: /absolute/path/to/other.ts
@@@ LINES: 5-20
Another explanation here.
@@@

Rules:
1. Start each comment with @@@ FILE: followed by the absolute file path
2. Next line must be @@@ LINES: followed by startLine-endLine (0-indexed)
3. Then write your comment text (can span multiple lines)
4. End with @@@ on its own line
5. MAX 2-4 comments per file - only significant logical changes
6. Span entire logical units - if a function was added/modified, span the whole function
7. Skip trivial changes - ignore whitespace, formatting, simple renames
`

	const userMessage = `Review these code changes:

## What the user asked for
${conversationSummary}

## Files changed
${changedFiles.map((f) => `- ${f.absolutePath}`).join("\n")}

## Diff content
${diffContent}

Output your review comments now using the @@@ format:`

	let commentCount = 0
	let buffer = ""
	let currentFile: string | null = null
	let currentStartLine: number | null = null
	let currentEndLine: number | null = null
	let inComment = false

	try {
		for await (const chunk of apiHandler.createMessage(systemPrompt, [{ role: "user", content: userMessage }])) {
			if (chunk.type === "text") {
				buffer += chunk.text

				// Process buffer line by line, keeping incomplete lines
				while (true) {
					const newlineIndex = buffer.indexOf("\n")
					if (newlineIndex === -1) break

					const line = buffer.substring(0, newlineIndex)
					buffer = buffer.substring(newlineIndex + 1)

					const trimmedLine = line.trim()

					// Check for FILE header
					if (trimmedLine.startsWith("@@@ FILE:")) {
						const filePath = trimmedLine.substring("@@@ FILE:".length).trim()
						const matchingFile = changedFiles.find((f) => f.absolutePath === filePath || f.relativePath === filePath)
						currentFile = matchingFile?.absolutePath || filePath
						continue
					}

					// Check for LINES header
					if (trimmedLine.startsWith("@@@ LINES:")) {
						const linesStr = trimmedLine.substring("@@@ LINES:".length).trim()
						const [start, end] = linesStr.split("-").map((s) => parseInt(s.trim(), 10))
						if (!isNaN(start) && !isNaN(end) && currentFile) {
							currentStartLine = start
							currentEndLine = end
							// Now we have location - create the comment UI immediately!
							onCommentStart(currentFile, currentStartLine, currentEndLine)
							inComment = true
							commentCount++
						}
						continue
					}

					// Check for end marker (could be on its own line or at end of content)
					if (trimmedLine === "@@@") {
						if (inComment) {
							onCommentEnd()
							inComment = false
							currentFile = null
							currentStartLine = null
							currentEndLine = null
						}
						continue
					}

					// If we're in a comment, stream the text
					if (inComment) {
						onCommentChunk(line + "\n")
					}
				}

				// Stream partial content in buffer for more responsive UI
				// But don't stream if it might be a marker (starts with @)
				if (inComment && buffer.length > 0 && !buffer.startsWith("@")) {
					onCommentChunk(buffer)
					buffer = "" // Clear buffer after streaming
				}
			}
		}

		// Handle any remaining content in buffer
		if (buffer.trim()) {
			const trimmedBuffer = buffer.trim()
			// Check if it's an end marker
			if (trimmedBuffer === "@@@") {
				if (inComment) {
					onCommentEnd()
					inComment = false
				}
			} else if (inComment && !trimmedBuffer.startsWith("@@@")) {
				// Only stream if it's actual content, not a marker
				onCommentChunk(buffer)
				onCommentEnd()
				inComment = false
			}
		} else if (inComment) {
			// No remaining content but still in comment - finalize it
			onCommentEnd()
		}

		return commentCount
	} catch (error) {
		console.error("Error streaming AI review comments:", error)
		if (inComment) {
			onCommentEnd()
		}
		return commentCount
	}
}

/**
 * Handle a reply to a comment thread with streaming
 */
async function handleCommentReply(
	controller: Controller,
	filePath: string,
	startLine: number,
	endLine: number,
	replyText: string,
	existingComments: string[],
	changedFiles: Array<{ relativePath: string; absolutePath: string; before: string; after: string }>,
	conversationSummary: string,
	onChunk: (chunk: string) => void,
): Promise<void> {
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	if (!apiConfiguration) {
		onChunk("Error: API configuration not available")
		return
	}

	// Disable thinking/reasoning for faster response (better UX for comment replies)
	const configWithoutThinking: ApiConfiguration = {
		...apiConfiguration,
		actModeThinkingBudgetTokens: 0,
		planModeThinkingBudgetTokens: 0,
	}

	// Find the relevant file
	const file = changedFiles.find((f) => f.absolutePath === filePath)
	if (!file) {
		onChunk("Error: Could not find the file context")
		return
	}

	// Get the relevant code snippet
	const afterLines = file.after.split("\n")
	const codeSnippet = afterLines.slice(startLine, endLine + 1).join("\n")

	const apiHandler = buildApiHandler(configWithoutThinking, "act")

	const systemPrompt = `${REVIEWER_SYSTEM_PROMPT}

The user is asking followup questions about the explanations you provided about the changes you made.
You have full context about the original task and conversation that led to these changes.`

	const userMessage = `## Original Task Context
${conversationSummary}

## Code Being Discussed
File: ${file.relativePath}
Lines ${startLine + 1}-${endLine + 1}:
\`\`\`
${codeSnippet}
\`\`\`

## Comment Thread
${existingComments.join("\n\n")}

## User's Question
${replyText}

Please respond to the user's question about this code.`

	try {
		for await (const chunk of apiHandler.createMessage(systemPrompt, [{ role: "user", content: userMessage }])) {
			if (chunk.type === "text") {
				onChunk(chunk.text)
			}
		}
	} catch (error) {
		console.error("Error getting reply:", error)
		onChunk(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
	}
}
