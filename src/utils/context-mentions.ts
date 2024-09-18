import * as vscode from "vscode"
import * as path from "path"
import { openFile } from "./open-file"
import { UrlScraper } from "./UrlScraper"
import { mentionRegexGlobal } from "../shared/context-mentions"
import fs from "fs/promises"
import { extractTextFromFile } from "./extract-text"

export function openMention(mention?: string): void {
	if (!mention) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			return
		}
		const absPath = path.resolve(cwd, relPath)
		if (mention.endsWith("/")) {
			vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(absPath))
			// vscode.commands.executeCommand("vscode.openFolder", , { forceNewWindow: false }) opens in new window
		} else {
			openFile(absPath)
		}
	} else if (mention === "problems") {
		vscode.commands.executeCommand("workbench.actions.view.problems")
	} else if (mention.startsWith("http")) {
		vscode.env.openExternal(vscode.Uri.parse(mention))
	}
}

export async function parseMentions(text: string, cwd: string, urlScraper?: UrlScraper): Promise<string> {
	const mentions: Set<string> = new Set()
	let parsedText = text.replace(mentionRegexGlobal, (match, mention) => {
		mentions.add(mention)
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		} else if (mention.startsWith("/")) {
			return mention.endsWith("/")
				? `'${mention}' (see below for folder contents)`
				: `'${mention}' (see below for file contents)`
		} else if (mention === "problems") {
			return `Workspace Problems (see below for diagnostics)`
		}
		return match
	})

	for (const mention of mentions) {
		if (mention.startsWith("http") && urlScraper) {
			try {
				const markdown = await urlScraper.urlToMarkdown(mention)
				parsedText += `\n\n<url_content url="${mention}">\n${markdown}\n</url_content>`
			} catch (error) {
				parsedText += `\n\n<url_content url="${mention}">\nError fetching content: ${error.message}\n</url_content>`
			}
		} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1) // Remove the leading '/'
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
				const diagnostics = await getWorkspaceDiagnostics(cwd)
				parsedText += `\n\n<workspace_diagnostics>\n${diagnostics}\n</workspace_diagnostics>`
			} catch (error) {
				parsedText += `\n\n<workspace_diagnostics>\nError fetching diagnostics: ${error.message}\n</workspace_diagnostics>`
			}
		}
	}

	return parsedText
}

async function getFileOrFolderContent(mentionPath: string, cwd: string): Promise<string> {
	const absPath = path.resolve(cwd, mentionPath)

	try {
		const stats = await fs.stat(absPath)

		if (stats.isFile()) {
			const content = await extractTextFromFile(absPath)
			return content
		} else if (stats.isDirectory()) {
			const entries = await fs.readdir(absPath, { withFileTypes: true })
			let directoryContent = ""
			const fileContentPromises: Promise<string>[] = []
			entries.forEach((entry) => {
				if (entry.isFile()) {
					directoryContent += `- File: ${entry.name}\n`
					const filePath = path.join(mentionPath, entry.name)
					const absoluteFilePath = path.resolve(absPath, entry.name)
					// const relativeFilePath = path.relative(cwd, absoluteFilePath);
					fileContentPromises.push(
						extractTextFromFile(absoluteFilePath)
							.then((content) => `<file_content path="${filePath}">\n${content}\n</file_content>`)
							.catch(
								(error) =>
									`<file_content path="${filePath}">\nError fetching content: ${error.message}\n</file_content>`
							)
					)
				} else if (entry.isDirectory()) {
					directoryContent += `- Directory: ${entry.name}/\n`
					// not recursively getting folder contents
				} else {
					directoryContent += `- Other: ${entry.name}\n`
				}
			})
			const fileContents = await Promise.all(fileContentPromises)
			return `${directoryContent}\n${fileContents.join("\n")}`
		} else {
			return "Unsupported file type."
		}
	} catch (error) {
		throw new Error(`Failed to access path "${mentionPath}": ${error.message}`)
	}
}

async function getWorkspaceDiagnostics(cwd: string): Promise<string> {
	const diagnostics = vscode.languages.getDiagnostics()

	let diagnosticsDetails = ""
	for (const [uri, fileDiagnostics] of diagnostics) {
		const problems = fileDiagnostics.filter(
			(d) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning
		)
		if (problems.length > 0) {
			diagnosticsDetails += `\nFile: ${path.relative(cwd, uri.fsPath)}`
			for (const diagnostic of problems) {
				let severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? "Error" : "Warning"
				const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
				const source = diagnostic.source ? `${diagnostic.source} ` : ""
				diagnosticsDetails += `\n- [${source}${severity}] Line ${line}: ${diagnostic.message}`
			}
		}
	}

	if (!diagnosticsDetails) {
		return "No problems detected."
	}

	return diagnosticsDetails
}
