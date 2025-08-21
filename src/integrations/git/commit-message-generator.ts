import { buildApiHandler } from "@core/api"
import * as vscode from "vscode"
import { readStateFromDisk } from "@/core/storage/utils/state-helpers"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getWorkingState } from "@/utils/git"
import { getCwd } from "@/utils/path"

/**
 * Git commit message generator module
 */
export const GitCommitGenerator = {
	generate,
	abort,
}

let commitGenerationAbortController: AbortController | undefined

async function generate(context: vscode.ExtensionContext, scm?: vscode.SourceControl) {
	const cwd = await getCwd()
	if (!context || !cwd) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "No workspace folder open",
		})
		return
	}

	const gitDiff = await getWorkingState(cwd)
	if (gitDiff === "No changes in working directory") {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "No changes in workspace for commit message",
		})
		return
	}

	const inputBox = scm?.inputBox
	if (!inputBox) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Git extension not found or no repositories available",
		})
		return
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.SourceControl,
			title: "Generating commit message...",
			cancellable: true,
		},
		() => performCommitGeneration(context, gitDiff, inputBox),
	)
}

async function performCommitGeneration(context: vscode.ExtensionContext, gitDiff: string, inputBox: any) {
	try {
		vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", true)

		const truncatedDiff = gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + "\n\n[Diff truncated due to size]" : gitDiff

		const prompt = `Based on the following git diff, generate a concise and descriptive commit message:
${truncatedDiff}
The commit message should:
1. Start with a short summary (50-72 characters)
2. Use the imperative mood (e.g., "Add feature" not "Added feature")
3. Describe what was changed and why
4. Be clear and descriptive
Commit message:`

		// Get the current API configuration
		const { apiConfiguration } = await readStateFromDisk(context)
		// Set to use Act mode for now by default
		// TODO: A new mode for commit generation
		const currentMode = "act"

		// Build the API handler
		const apiHandler = buildApiHandler(apiConfiguration, currentMode)

		// Create a system prompt
		const systemPrompt =
			"You are a helpful assistant that generates concise and descriptive git commit messages based on git diffs."

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

function abort() {
	commitGenerationAbortController?.abort()
	vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", false)
}

/**
 * Extracts the commit message from the AI response
 * @param str String containing the AI response
 * @returns The extracted commit message
 */
export function extractCommitMessage(str: string): string {
	// Remove any markdown formatting or extra text
	return str
		.trim()
		.replace(/^```[^\n]*\n?|```$/g, "")
		.trim()
}
