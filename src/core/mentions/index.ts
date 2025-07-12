import * as vscode from "vscode"
import * as path from "path"
import { openFile } from "@integrations/misc/open-file"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { mentionRegexGlobal } from "@shared/context-mentions"
import fs from "fs/promises"
import { extractTextFromFile } from "@integrations/misc/extract-text"
import { isBinaryFile } from "isbinaryfile"
import { diagnosticsToProblemsString } from "@integrations/diagnostics"
import { getLatestTerminalOutput } from "@integrations/terminal/get-latest-output"
import { getCommitInfo } from "@utils/git"
import { getWorkingState } from "@utils/git"
import { FileContextTracker } from "../context/context-tracking/FileContextTracker"
import { getCwd } from "@/utils/path"
import { getHostBridgeProvider } from "@/hosts/host-providers"
import { exec } from "child_process"
import { promisify } from "util"
import { showErrorMessage } from "@utils/dialog"
import { executeCommand } from "@utils/commands"

const execAsync = promisify(exec)

/**
 * Opens a file or folder in the system file manager (Finder on macOS)
 */
async function revealInExplorer(absolutePath: string): Promise<void> {
	try {
		const platform = process.platform
		if (platform === "darwin") {
			// macOS - use 'open' command with -R flag to reveal in Finder
			await execAsync(`open -R "${absolutePath}"`)
		} else if (platform === "win32") {
			// Windows - use explorer
			await execAsync(`explorer /select,"${absolutePath}"`)
		} else {
			// Linux - use xdg-open (most common)
			await execAsync(`xdg-open "${path.dirname(absolutePath)}"`)
		}
	} catch (error) {
		console.error("Error revealing file in explorer:", error)
		// Fallback to VSCode command
		await executeCommand("revealInExplorer", vscode.Uri.file(absolutePath))
	}
}

/**
 * Focuses the terminal using the host bridge or VSCode command as fallback
 */
async function focusTerminal(): Promise<void> {
	try {
		// Try to get active terminal via host bridge
		const bridgeProvider = getHostBridgeProvider()
		if (bridgeProvider && bridgeProvider.terminalClient) {
			// Get the active terminal to potentially show it
			const activeTerminal = await bridgeProvider.terminalClient.getActiveTerminal({})
			if (activeTerminal && activeTerminal.id) {
				// If there's an active terminal, we can assume it's focused
				// The actual focus operation needs to be handled by the host
				console.log("Active terminal found:", activeTerminal.name)
				// For now, fall back to VSCode command for actual focus
			}
		}
	} catch (error) {
		console.error("Error getting active terminal via host bridge:", error)
	}

	// Use VSCode command for terminal focus
	await executeCommand("workbench.action.terminal.focus")
}

/**
 * Opens the problems view using VSCode command
 */
async function openProblemsView(): Promise<void> {
	try {
		await executeCommand("workbench.actions.view.problems")
	} catch (error) {
		console.error("Error opening problems view:", error)
	}
}

export async function openMention(mention?: string): Promise<void> {
	if (!mention) {
		return
	}

	const cwd = await getCwd()
	if (!cwd) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const absPath = path.resolve(cwd, relPath)
		if (mention.endsWith("/")) {
			// Use native file explorer reveal
			await revealInExplorer(absPath)
		} else {
			// Use existing openFile implementation (already uses host bridge)
			openFile(absPath)
		}
	} else if (mention === "problems") {
		// Use native problems view opener
		await openProblemsView()
	} else if (mention === "terminal") {
		// Use native terminal focus with host bridge fallback
		await focusTerminal()
	} else if (mention.startsWith("http")) {
		// Keep using vscode.env.openExternal as it's already the preferred method
		vscode.env.openExternal(vscode.Uri.parse(mention))
	}
}

export async function parseMentions(
	text: string,
	cwd: string,
	urlContentFetcher: UrlContentFetcher,
	fileContextTracker?: FileContextTracker,
): Promise<string> {
	const mentions: Set<string> = new Set()
	let parsedText = text.replace(mentionRegexGlobal, (match, mention) => {
		mentions.add(mention)
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1) // Remove the leading '/'
			return mentionPath.endsWith("/")
				? `'${mentionPath}' (see below for folder content)`
				: `'${mentionPath}' (see below for file content)`
		} else if (mention === "problems") {
			return `Workspace Problems (see below for diagnostics)`
		} else if (mention === "terminal") {
			return `Terminal Output (see below for output)`
		} else if (mention === "git-changes") {
			return `Working directory changes (see below for details)`
		} else if (/^[a-f0-9]{7,40}$/.test(mention)) {
			return `Git commit '${mention}' (see below for commit info)`
		}
		return match
	})

	const urlMention = Array.from(mentions).find((mention) => mention.startsWith("http"))
	let launchBrowserError: Error | undefined
	if (urlMention) {
		try {
			await urlContentFetcher.launchBrowser()
		} catch (error) {
			launchBrowserError = error
			await showErrorMessage(`Error fetching content for ${urlMention}: ${error.message}`)
		}
	}

	// Filter out duplicate mentions while preserving order
	const uniqueMentions = Array.from(new Set(mentions))

	for (const mention of uniqueMentions) {
		if (mention.startsWith("http")) {
			let result: string
			if (launchBrowserError) {
				result = `Error fetching content: ${launchBrowserError.message}`
			} else {
				try {
					const markdown = await urlContentFetcher.urlToMarkdown(mention)
					result = markdown
				} catch (error) {
					await showErrorMessage(`Error fetching content for ${mention}: ${error.message}`)
					result = `Error fetching content: ${error.message}`
				}
			}
			parsedText += `\n\n<url_content url="${mention}">\n${result}\n</url_content>`
		} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1)
			try {
				const content = await getFileOrFolderContent(mentionPath, cwd)
				if (mention.endsWith("/")) {
					parsedText += `\n\n<folder_content path="${mentionPath}">\n${content}\n</folder_content>`
				} else {
					parsedText += `\n\n<file_content path="${mentionPath}">\n${content}\n</file_content>`
					// Track that this file was mentioned and its content was included
					if (fileContextTracker) {
						await fileContextTracker.trackFileContext(mentionPath, "file_mentioned")
					}
				}
			} catch (error) {
				if (mention.endsWith("/")) {
					parsedText += `\n\n<folder_content path="${mentionPath}">\nError fetching content: ${error.message}\n</folder_content>`
				} else {
					parsedText += `\n\n<file_content path="${mentionPath}">\nError fetching content: ${error.message}\n</file_content>`
				}
			}
		} else if (mention === "problems") {
			try {
				const problems = getWorkspaceProblems(cwd)
				parsedText += `\n\n<workspace_diagnostics>\n${problems}\n</workspace_diagnostics>`
			} catch (error) {
				parsedText += `\n\n<workspace_diagnostics>\nError fetching diagnostics: ${error.message}\n</workspace_diagnostics>`
			}
		} else if (mention === "terminal") {
			try {
				const terminalOutput = await getLatestTerminalOutput()
				parsedText += `\n\n<terminal_output>\n${terminalOutput}\n</terminal_output>`
			} catch (error) {
				parsedText += `\n\n<terminal_output>\nError fetching terminal output: ${error.message}\n</terminal_output>`
			}
		} else if (mention === "git-changes") {
			try {
				const workingState = await getWorkingState(cwd)
				parsedText += `\n\n<git_working_state>\n${workingState}\n</git_working_state>`
			} catch (error) {
				parsedText += `\n\n<git_working_state>\nError fetching working state: ${error.message}\n</git_working_state>`
			}
		} else if (/^[a-f0-9]{7,40}$/.test(mention)) {
			try {
				const commitInfo = await getCommitInfo(mention, cwd)
				parsedText += `\n\n<git_commit hash="${mention}">\n${commitInfo}\n</git_commit>`
			} catch (error) {
				parsedText += `\n\n<git_commit hash="${mention}">\nError fetching commit info: ${error.message}\n</git_commit>`
			}
		}
	}

	if (urlMention) {
		try {
			await urlContentFetcher.closeBrowser()
		} catch (error) {
			console.error(`Error closing browser: ${error.message}`)
		}
	}

	return parsedText
}

async function getFileOrFolderContent(mentionPath: string, cwd: string): Promise<string> {
	const absPath = path.resolve(cwd, mentionPath)

	try {
		const stats = await fs.stat(absPath)

		if (stats.isFile()) {
			const isBinary = await isBinaryFile(absPath).catch(() => false)
			if (isBinary) {
				return "(Binary file, unable to display content)"
			}
			const content = await extractTextFromFile(absPath)
			return content
		} else if (stats.isDirectory()) {
			const entries = await fs.readdir(absPath, { withFileTypes: true })
			let folderContent = ""
			const fileContentPromises: Promise<string | undefined>[] = []
			entries.forEach((entry, index) => {
				const isLast = index === entries.length - 1
				const linePrefix = isLast ? "└── " : "├── "
				if (entry.isFile()) {
					folderContent += `${linePrefix}${entry.name}\n`
					const filePath = path.join(mentionPath, entry.name)
					const absoluteFilePath = path.resolve(absPath, entry.name)
					// const relativeFilePath = path.relative(cwd, absoluteFilePath);
					fileContentPromises.push(
						(async () => {
							try {
								const isBinary = await isBinaryFile(absoluteFilePath).catch(() => false)
								if (isBinary) {
									return undefined
								}
								const content = await extractTextFromFile(absoluteFilePath)
								return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
							} catch (error) {
								return undefined
							}
						})(),
					)
				} else if (entry.isDirectory()) {
					folderContent += `${linePrefix}${entry.name}/\n`
					// not recursively getting folder contents
				} else {
					folderContent += `${linePrefix}${entry.name}\n`
				}
			})
			const fileContents = (await Promise.all(fileContentPromises)).filter((content) => content)
			return `${folderContent}\n${fileContents.join("\n\n")}`.trim()
		} else {
			return `(Failed to read contents of ${mentionPath})`
		}
	} catch (error) {
		throw new Error(`Failed to access path "${mentionPath}": ${error.message}`)
	}
}

function getWorkspaceProblems(cwd: string): string {
	try {
		// Try to get diagnostics from VSCode API if available
		if (typeof vscode !== "undefined" && vscode.languages && vscode.languages.getDiagnostics) {
			const diagnostics = vscode.languages.getDiagnostics()
			const result = diagnosticsToProblemsString(
				diagnostics,
				[vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
				cwd,
			)
			if (!result) {
				return "No errors or warnings detected."
			}
			return result
		} else {
			// Fallback for standalone mode - return a helpful message
			return "Problems detection is not available in standalone mode. Try using a language server or linter for error detection."
		}
	} catch (error) {
		console.error("Error getting workspace problems:", error)
		return "Error occurred while trying to detect workspace problems."
	}
}
