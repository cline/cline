import { buildApiHandler } from "@core/api"
import * as path from "path"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getGitDiff } from "@/utils/git"

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

export async function generateCommitMsg(stateManager: StateManager, scm?: vscode.SourceControl) {
	try {
		const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports
		if (!gitExtension) {
			throw new Error("Git extension not found")
		}

		const git = gitExtension.getAPI(1)
		if (git.repositories.length === 0) {
			throw new Error("No Git repositories available")
		}

		// If scm is provided, then the user specified one repository by clicking the "Source Control" menu button
		if (scm) {
			const repository = git.getRepository(scm.rootUri)

			if (!repository) {
				throw new Error("Repository not found for provided SCM")
			}

			await generateCommitMsgForRepository(stateManager, repository)
			return
		}

		await orchestrateWorkspaceCommitMsgGeneration(stateManager, git.repositories)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `[Commit Generation Failed] ${errorMessage}`,
		})
	}
}

async function orchestrateWorkspaceCommitMsgGeneration(stateManager: StateManager, repos: any[]) {
	const reposWithChanges = await filterForReposWithChanges(repos)

	if (reposWithChanges.length === 0) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "No changes found in any workspace repositories",
		})
		return
	}

	if (reposWithChanges.length === 1) {
		// Only one repo with changes, generate for it
		const repo = reposWithChanges[0]
		await generateCommitMsgForRepository(stateManager, repo)
		return
	}

	const selection = await promptRepoSelection(reposWithChanges)

	if (!selection) {
		// User cancelled
		return
	}

	if (selection.repo === null) {
		// Generate for all repositories with changes
		for (const repo of reposWithChanges) {
			try {
				await generateCommitMsgForRepository(stateManager, repo)
			} catch (error) {
				console.error(`Failed to generate commit message for ${repo.rootUri.fsPath}:`, error)
			}
		}
	} else {
		// Generate for selected repository
		await generateCommitMsgForRepository(stateManager, selection.repo)
	}
}

async function filterForReposWithChanges(repos: any[]) {
	const reposWithChanges = []

	// Check which repositories have changes
	for (const repo of repos) {
		try {
			const gitDiff = await getGitDiff(repo.rootUri.fsPath)
			if (gitDiff) {
				reposWithChanges.push(repo)
			}
		} catch (error) {
			// Skip repositories with errors (no changes, etc.)
		}
	}
	return reposWithChanges
}

async function promptRepoSelection(repos: any[]) {
	// Multiple repos with changes - ask user to choose
	const repoItems = repos.map((repo) => ({
		label: repo.rootUri.fsPath.split(path.sep).pop() || repo.rootUri.fsPath,
		description: repo.rootUri.fsPath,
		repo: repo,
	}))

	repoItems.unshift({
		label: "$(git-commit) Generate for all repositories with changes",
		description: `Generate commit messages for ${repos.length} repositories`,
		repo: null as any,
	})

	return await vscode.window.showQuickPick(repoItems, {
		placeHolder: "Select repository for commit message generation",
	})
}

async function generateCommitMsgForRepository(stateManager: StateManager, repository: any) {
	const inputBox = repository.inputBox
	const repoPath = repository.rootUri.fsPath
	const gitDiff = await getGitDiff(repoPath)

	if (!gitDiff) {
		throw new Error(`No changes in repository ${repoPath.split(path.sep).pop() || "repository"} for commit message`)
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.SourceControl,
			title: `Generating commit message for ${repoPath.split(path.sep).pop() || "repository"}...`,
			cancellable: true,
		},
		() => performCommitMsgGeneration(stateManager, gitDiff, inputBox),
	)
}

async function performCommitMsgGeneration(stateManager: StateManager, gitDiff: string, inputBox: any) {
	try {
		vscode.commands.executeCommand("setContext", "cline.isGeneratingCommit", true)

		const prompts = [PROMPT.instruction]

		const currentInput = inputBox.value?.trim() || ""
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
