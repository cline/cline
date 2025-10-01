import { buildApiHandler } from "@core/api"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getGitDiff } from "@/utils/git"
import { getCwd } from "@/utils/path"

/**
 * Git commit message generator module
 */

let commitGenerationAbortController: AbortController | undefined

const PROMPT = {
	system: "You are a helpful assistant that generates informative git commit messages based on git diffs output. Skip preamble and remove all backticks surrounding the commit message.",
	user: "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}",
	instruction: `Based on the provided git diff, generate a concise and descriptive commit message.

The commit message should:
1. Has a short title (50-72 characters)
2. The commit message should adhere to the conventional commit format
3. Describe what was changed and why
4. Be clear and informative`,
}

export async function generateCommitMessage(stateManager: StateManager, scm?: vscode.SourceControl) {
	const cwd = await getCwd()
	if (!cwd) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "No workspace folder open",
		})
		return
	}

	try {
		const inputBox = scm?.inputBox
		if (!inputBox) {
			throw new Error("Git extension not found or no repositories available")
		}

		const gitDiff = await getGitDiff(cwd)
		if (!gitDiff) {
			throw new Error("No changes in workspace for commit message")
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.SourceControl,
				title: "Generating commit message...",
				cancellable: true,
			},
			() => performCommitGeneration(stateManager, gitDiff, inputBox),
		)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `[Commit Generation Failed] ${errorMessage}`,
		})
	}
}

async function performCommitGeneration(stateManager: StateManager, gitDiff: string, inputBox: any) {
	try {
		vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", true)

		const prompts = [PROMPT.instruction]

		const currentInput = inputBox?.value?.trim() || ""
		if (currentInput) {
			prompts.push(PROMPT.user.replace("{{USER_CURRENT_INPUT}}", currentInput))
		}

		const truncatedDiff = gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + "\n\n[Diff truncated due to size]" : gitDiff
		prompts.push(truncatedDiff)
		const prompt = prompts.join("\n\n")

		// Get the current API configuration
		// Set to use Act mode for now by default
		const apiConfiguration = stateManager.getApiConfiguration()
		const currentMode = "act"

		// Build the API handler
		const apiHandler = buildApiHandler(apiConfiguration, currentMode)

		// Create a system prompt
		const systemPrompt = PROMPT.system

		// Create a message for the API
		const messages = [{ role: "user" as const, content: prompt }]

		commitGenerationAbortController = new AbortController()
		const stream = apiHandler.createMessage(systemPrompt, messages)

		let response = ""
		for await (const chunk of stream) {
			commitGenerationAbortController.signal.throwIfAborted()
			if (chunk.type === "text") {
				response += chunk.text
				inputBox.value = extractCommitMessage(response)
			}
		}

		if (!inputBox.value) {
			throw new Error("empty API response")
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Failed to generate commit message: ${errorMessage}`,
		})
	} finally {
		vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", false)
	}
}

export function abortCommitGeneration() {
	commitGenerationAbortController?.abort()
	vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", false)
}

/**
 * Extracts the commit message from the AI response
 * @param str String containing the AI response
 * @returns The extracted commit message
 */
function extractCommitMessage(str: string): string {
	// Remove any markdown formatting or extra text
	return str
		.trim()
		.replace(/^```[^\n]*\n?|```$/g, "")
		.trim()
}
