import * as vscode from "vscode"
import { writeTextToClipboard } from "@utils/env"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { ShowMessageType, ShowTextDocumentRequest, ShowMessageRequest } from "@/shared/proto/host/window"
import { getCwd } from "@/utils/path"
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
 * @param aiResponse The response from the AI
 * @returns The extracted commit message
 */
export function extractCommitMessage(aiResponse: string): string {
	// Remove any markdown formatting or extra text
	let message = aiResponse.trim()

	// Look for code blocks which typically contain the actual commit message
	const codeBlockRegex = /```(?:git|commit|plaintext|)?\s*([\s\S]*?)```/g
	const matches = [...message.matchAll(codeBlockRegex)]

	if (matches.length > 0) {
		// Use the last code block if there are multiple (usually the final one contains the refined message)
		const lastMatch = matches[matches.length - 1]
		if (lastMatch && lastMatch[1]) {
			return lastMatch[1].trim()
		}
	}

	// If no code blocks found, try to extract the message after "Commit message:" if present
	const commitMessagePrefix = "Commit message:"
	const prefixIndex = message.lastIndexOf(commitMessagePrefix)
	if (prefixIndex !== -1) {
		return message.substring(prefixIndex + commitMessagePrefix.length).trim()
	}

	// If we can't find a specific pattern, just return the first few lines (likely the summary)
	const lines = message.split("\n")
	if (lines.length > 0) {
		// Return just the first paragraph (usually the commit message)
		const firstParagraph = []
		for (const line of lines) {
			if (line.trim() === "") {
				break
			}
			firstParagraph.push(line)
		}
		if (firstParagraph.length > 0) {
			return firstParagraph.join("\n")
		}
	}

	return message
}

/**
 * Copies the generated commit message to the clipboard
 * @param message The commit message to copy
 */
export async function copyCommitMessageToClipboard(message: string): Promise<void> {
	await writeTextToClipboard(message)
	getHostBridgeProvider().windowClient.showMessage({
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
		await getHostBridgeProvider().windowClient.showMessage({
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
			// Get the current working directory
			const cwd = await getCwd()
			// Find the active repository based on the current working directory
			const activeRepo = cwd
				? api.repositories.find((repo: any) => repo.rootUri.fsPath === cwd) || api.repositories[0]
				: api.repositories[0]
			activeRepo.inputBox.value = message
			getHostBridgeProvider().windowClient.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.INFORMATION,
					message: "Commit message applied to Git input",
				}),
			)
		} else {
			getHostBridgeProvider().windowClient.showMessage({
				type: ShowMessageType.ERROR,
				message: "No Git repositories found",
			})
			await copyCommitMessageToClipboard(message)
		}
	} else {
		getHostBridgeProvider().windowClient.showMessage({
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

	await getHostBridgeProvider().windowClient.showTextDocument(
		ShowTextDocumentRequest.create({
			path: document.uri.fsPath,
		}),
	)
	getHostBridgeProvider().windowClient.showMessage({
		type: ShowMessageType.INFORMATION,
		message: "Edit the commit message and copy when ready",
	})
}
