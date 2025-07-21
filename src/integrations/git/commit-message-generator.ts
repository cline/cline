import * as vscode from "vscode"
import { writeTextToClipboard } from "@utils/env"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType, ShowTextDocumentRequest } from "@/shared/proto/host/window"
import { buildApiHandler } from "@/api"
import { getAllExtensionState } from "@/core/storage/state"
import { getWorkingState } from "@/utils/git"
import { getCwd } from "@/utils/path"

/**
 * Git commit message generator module
 */
export const GitCommitGenerator = {
	generate,
	abort,
}

let commitGenerationAbortController: AbortController | undefined = undefined

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
		vscode.window.showErrorMessage("Git extension not found or no repositories available")
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
		const { apiConfiguration } = await getAllExtensionState(context)
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
		vscode.window.showErrorMessage(`Failed to generate commit message: ${errorMessage}`)
	} finally {
		vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", false)
	}
}

function abort() {
	commitGenerationAbortController?.abort()
	vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", false)
}

/**
 * Formats the git diff into a prompt for the AI
 * @param gitDiff The git diff to format
 * @returns A formatted prompt for the AI
 */
function formatGitDiffPrompt(gitDiff: string): string {
	// Limit the diff size to avoid token limits
	const maxDiffLength = 5000
	let truncatedDiff = gitDiff

	if (gitDiff.length > maxDiffLength) {
		truncatedDiff = gitDiff.substring(0, maxDiffLength) + "\n\n[Diff truncated due to size]"
	}

	return `Based on the following git diff, generate a concise and descriptive commit message:

${truncatedDiff}

The commit message should:
1. Start with a short summary (50-72 characters)
2. Use the imperative mood (e.g., "Add feature" not "Added feature")
3. Describe what was changed and why
4. Be clear and descriptive

Commit message:`
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

/**
 * Copies the generated commit message to the clipboard
 * @param message The commit message to copy
 */
export async function copyCommitMessageToClipboard(message: string): Promise<void> {
	await writeTextToClipboard(message)
	HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: "Commit message copied to clipboard",
	})
}

/**
 * Shows a dialog with options to apply the generated commit message
 * @param message The generated commit message
 */
export async function showCommitMessageOptions(message: string): Promise<void> {
	const copyAction = "Copy to Clipboard"
	const applyAction = "Apply to Git Input"
	const editAction = "Edit Message"

	const selectedAction = (
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Commit message generated",
			options: {
				modal: false,
				detail: message,
				items: [copyAction, applyAction, editAction],
			},
		})
	).selectedOption

	// Handle user dismissing the dialog (selectedAction is undefined)
	if (!selectedAction) {
		return
	}

	switch (selectedAction) {
		case copyAction:
			await copyCommitMessageToClipboard(message)
			break
		case applyAction:
			await applyCommitMessageToGitInput(message)
			break
		case editAction:
			await editCommitMessage(message)
			break
	}
}

/**
 * Applies the commit message to the Git input box in the Source Control view
 * @param message The commit message to apply
 */
async function applyCommitMessageToGitInput(message: string): Promise<void> {
	// Set the SCM input box value
	const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports
	if (gitExtension) {
		const api = gitExtension.getAPI(1)
		if (api && api.repositories.length > 0) {
			const repo = api.repositories[0]
			repo.inputBox.value = message
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Commit message applied to Git input",
			})
		} else {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No Git repositories found",
			})
			await copyCommitMessageToClipboard(message)
		}
	} else {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Git extension not found",
		})
		await copyCommitMessageToClipboard(message)
	}
}

/**
 * Opens the commit message in an editor for further editing
 * @param message The commit message to edit
 */
async function editCommitMessage(message: string): Promise<void> {
	const document = await vscode.workspace.openTextDocument({
		content: message,
		language: "markdown",
	})

	await HostProvider.window.showTextDocument(
		ShowTextDocumentRequest.create({
			path: document.uri.fsPath,
		}),
	)
	HostProvider.window.showMessage({
		type: ShowMessageType.INFORMATION,
		message: "Edit the commit message and copy when ready",
	})
}
