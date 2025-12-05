/**
 * Chat Participants for BCline Extension
 *
 * Registers @claude, @codex, and @cline agents in GitHub Copilot Chat
 * These persist across VS Code restarts
 */

import { exec } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "./logging/Logger"

const execAsync = promisify(exec)

/**
 * Get workspace root path using HostProvider
 */
async function getWorkspaceRoot(): Promise<string | undefined> {
	try {
		const result = await HostProvider.workspace.getWorkspacePaths({})
		return result.paths?.[0]
	} catch {
		return undefined
	}
}

/**
 * Handler for @claude chat participant
 * Routes messages to Claude CLI (claude-code)
 */
async function handleClaudeRequest(
	request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const prompt = request.prompt.trim()

	if (!prompt) {
		stream.markdown("Please provide a prompt for Claude CLI.")
		return { metadata: { command: "claude" } }
	}

	stream.markdown(`🧠 **Claude CLI (Opus 4.5)** processing...\n\n`)
	stream.progress("Executing Claude CLI...")

	try {
		// Check for YOLO mode (dangerous operations)
		const isYolo = prompt.toLowerCase().startsWith("yolo:")
		const actualPrompt = isYolo ? prompt.substring(5).trim() : prompt

		// Escape the prompt for shell
		const escapedPrompt = actualPrompt.replace(/"/g, '\\"').replace(/`/g, "\\`")

		// Build command
		const yoloFlag = isYolo ? " --dangerously-skip-permissions" : ""
		const command = `claude${yoloFlag} -p "${escapedPrompt}"`

		Logger.log(`[ChatParticipant] Executing Claude CLI: ${command}`)

		const workspaceRoot = await getWorkspaceRoot()
		const { stdout, stderr } = await execAsync(command, {
			cwd: workspaceRoot,
			timeout: 300000, // 5 minute timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		})

		if (stderr && !stdout) {
			stream.markdown(`⚠️ **Error:**\n\`\`\`\n${stderr}\n\`\`\``)
		} else {
			stream.markdown(stdout || "No response from Claude CLI.")
		}

		return { metadata: { command: "claude", success: true } }
	} catch (error: any) {
		const errorMessage = error.message || String(error)
		stream.markdown(`❌ **Claude CLI Error:**\n\`\`\`\n${errorMessage}\n\`\`\``)

		if (errorMessage.includes("command not found") || errorMessage.includes("not recognized")) {
			stream.markdown(
				`\n\n💡 **Tip:** Install Claude CLI with:\n\`\`\`bash\nnpm install -g @anthropic-ai/claude-code\n\`\`\``,
			)
		}

		return { metadata: { command: "claude", success: false, error: errorMessage } }
	}
}

/**
 * Handler for @codex chat participant
 * Routes messages to Codex CLI (OpenAI)
 */
async function handleCodexRequest(
	request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const prompt = request.prompt.trim()

	if (!prompt) {
		stream.markdown("Please provide a prompt for Codex CLI.")
		return { metadata: { command: "codex" } }
	}

	stream.markdown(`🤖 **Codex CLI (GPT-5.1)** processing...\n\n`)
	stream.progress("Executing Codex CLI...")

	try {
		// Check for YOLO mode (full agent)
		const isYolo = prompt.toLowerCase().startsWith("yolo:")
		const actualPrompt = isYolo ? prompt.substring(5).trim() : prompt

		// Escape the prompt for shell
		const escapedPrompt = actualPrompt.replace(/"/g, '\\"').replace(/`/g, "\\`")

		// Build command - full agent mode or read-only
		const modeFlag = isYolo ? "--dangerously-bypass-approvals-and-sandbox" : "--approval-mode full-auto"
		const command = `codex ${modeFlag} "${escapedPrompt}"`

		Logger.log(`[ChatParticipant] Executing Codex CLI: ${command}`)

		const workspaceRoot = await getWorkspaceRoot()
		const { stdout, stderr } = await execAsync(command, {
			cwd: workspaceRoot,
			timeout: 300000, // 5 minute timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		})

		if (stderr && !stdout) {
			stream.markdown(`⚠️ **Error:**\n\`\`\`\n${stderr}\n\`\`\``)
		} else {
			stream.markdown(stdout || "No response from Codex CLI.")
		}

		return { metadata: { command: "codex", success: true } }
	} catch (error: any) {
		const errorMessage = error.message || String(error)
		stream.markdown(`❌ **Codex CLI Error:**\n\`\`\`\n${errorMessage}\n\`\`\``)

		if (errorMessage.includes("command not found") || errorMessage.includes("not recognized")) {
			stream.markdown(`\n\n💡 **Tip:** Install Codex CLI with:\n\`\`\`bash\nnpm install -g @openai/codex\n\`\`\``)
		}

		return { metadata: { command: "codex", success: false, error: errorMessage } }
	}
}

/**
 * Handler for @cline chat participant
 * Routes messages to Cline agent via message queue
 */
async function handleClineRequest(
	request: vscode.ChatRequest,
	_context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	_token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const prompt = request.prompt.trim()

	if (!prompt) {
		stream.markdown("Please provide a task for Cline.")
		return { metadata: { command: "cline" } }
	}

	stream.markdown(`🚀 **Cline Agent** processing...\n\n`)
	stream.progress("Sending task to Cline...")

	try {
		// Import MessageQueueService dynamically to avoid circular deps
		const { MessageQueueService } = await import("./MessageQueueService")
		const workspaceRoot = await getWorkspaceRoot()

		if (!workspaceRoot) {
			stream.markdown("❌ No workspace folder open. Cline requires a workspace.")
			return { metadata: { command: "cline", success: false } }
		}

		const messageQueue = MessageQueueService.getInstance(workspaceRoot)

		// Send message to Cline via the message queue
		// This will trigger the message handler in extension.ts
		const messageId = messageQueue.sendMessage(prompt, "notification")

		stream.markdown(`✅ Task sent to Cline: "${prompt}"\n\nCheck the Cline sidebar for progress.`)

		return { metadata: { command: "cline", success: true, messageId } }
	} catch (error: any) {
		const errorMessage = error.message || String(error)
		stream.markdown(`❌ **Cline Error:**\n\`\`\`\n${errorMessage}\n\`\`\``)
		return { metadata: { command: "cline", success: false, error: errorMessage } }
	}
}

/**
 * Register all chat participants
 */
export function registerChatParticipants(context: vscode.ExtensionContext): void {
	Logger.log("[ChatParticipants] Registering chat participants...")

	// Register @claude participant
	const claudeParticipant = vscode.chat.createChatParticipant("bcline.claude", handleClaudeRequest)
	claudeParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "claude.png")
	context.subscriptions.push(claudeParticipant)
	Logger.log("[ChatParticipants] Registered @claude")

	// Register @codex participant
	const codexParticipant = vscode.chat.createChatParticipant("bcline.codex", handleCodexRequest)
	codexParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "codex.png")
	context.subscriptions.push(codexParticipant)
	Logger.log("[ChatParticipants] Registered @codex")

	// Register @cline participant
	const clineParticipant = vscode.chat.createChatParticipant("bcline.cline", handleClineRequest)
	clineParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "icon.png")
	context.subscriptions.push(clineParticipant)
	Logger.log("[ChatParticipants] Registered @cline")

	Logger.log("[ChatParticipants] All chat participants registered successfully")
}
