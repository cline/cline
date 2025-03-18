import * as vscode from "vscode"
import * as path from "path"
import { openFile } from "../../integrations/misc/open-file"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { mentionRegexGlobal } from "../../shared/context-mentions"

import { extractTextFromFile } from "../../integrations/misc/extract-text"
import { diagnosticsToProblemsString } from "../../integrations/diagnostics"
import { getLatestTerminalOutput } from "../../integrations/terminal/get-latest-output"
import { getCommitInfo, getWorkingState } from "../../utils/git"
import { isBinaryFile } from "../../utils/fs"
import { FileType } from "vscode"

export function openMention(mention?: string): void {
	if (!mention) {
		return
	}

	const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri).at(0)
	if (!cwd) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const absPath = vscode.Uri.joinPath(cwd, relPath)
		if (mention.endsWith("/")) {
			vscode.commands.executeCommand("revealInExplorer", absPath)
		} else {
			openFile(absPath)
		}
	} else if (mention === "problems") {
		vscode.commands.executeCommand("workbench.actions.view.problems")
	} else if (mention === "terminal") {
		vscode.commands.executeCommand("workbench.action.terminal.focus")
	} else if (mention.startsWith("http")) {
		vscode.env.openExternal(vscode.Uri.parse(mention))
	}
}

export async function parseMentions(text: string, cwd: vscode.Uri, urlContentFetcher: UrlContentFetcher): Promise<string> {
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
			vscode.window.showErrorMessage(`Error fetching content for ${urlMention}: ${error.message}`)
		}
	}

	for (const mention of mentions) {
		if (mention.startsWith("http")) {
			let result: string
			if (launchBrowserError) {
				result = `Error fetching content: ${launchBrowserError.message}`
			} else {
				try {
					const markdown = await urlContentFetcher.urlToMarkdown(mention)
					result = markdown
				} catch (error) {
					vscode.window.showErrorMessage(`Error fetching content for ${mention}: ${error.message}`)
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
				const problems = getWorkspaceProblems(cwd.fsPath)
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
				const workingState = await getWorkingState(cwd.fsPath)
				parsedText += `\n\n<git_working_state>\n${workingState}\n</git_working_state>`
			} catch (error) {
				parsedText += `\n\n<git_working_state>\nError fetching working state: ${error.message}\n</git_working_state>`
			}
		} else if (/^[a-f0-9]{7,40}$/.test(mention)) {
			try {
				const commitInfo = await getCommitInfo(mention, cwd.fsPath)
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

async function getFileOrFolderContent(mentionPath: string, cwd: vscode.Uri): Promise<string> {
	const absPath = vscode.Uri.joinPath(cwd, mentionPath)

	try {
		const stats = await vscode.workspace.fs.stat(absPath)

		if (stats.type === FileType.File) {
			const isBinary = await isBinaryFile(absPath).catch(() => false)
			if (isBinary) {
				return "(Binary file, unable to display content)"
			}
			const content = await extractTextFromFile(absPath)
			return content
		} else if (stats.type === FileType.Directory) {
			const entries = await vscode.workspace.fs.readDirectory(absPath)
			let folderContent = ""
			const fileContentPromises: Promise<string | undefined>[] = []
			entries.forEach((entry, index) => {
				const isLast = index === entries.length - 1
				const linePrefix = isLast ? "└── " : "├── "
				if (entry[1] === FileType.File) {
					let name = entry[0]
					folderContent += `${linePrefix}${name}\n`
					const filePath = path.join(mentionPath, name)
					const absoluteFilePath = vscode.Uri.joinPath(absPath, name)
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
				} else if (entry[1] === FileType.Directory) {
					folderContent += `${linePrefix}${entry[0]}/\n`
					// not recursively getting folder contents
				} else {
					folderContent += `${linePrefix}${entry[0]}\n`
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
}
