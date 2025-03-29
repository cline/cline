import * as vscode from "vscode"
import * as path from "path"
import fs from "fs/promises"
import { openFile } from "../../integrations/misc/open-file"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { mentionRegexGlobal } from "../../shared/context-mentions"
import { getWorkspacePath } from "../../utils/path"
import { HandlerConfig, MentionContext, XmlTag } from "./types"
import { extractTextFromFile } from "../../integrations/misc/extract-text"
import { isBinaryFile } from "isbinaryfile"
import { getWorkingState, getCommitInfo } from "../../utils/git"
import { diagnosticsToProblemsString } from "../../integrations/diagnostics"
import { getLatestTerminalOutput } from "../../integrations/terminal/get-latest-output"

export async function openMention(mention?: string, osInfo?: string): Promise<void> {
	if (!mention) {
		return
	}

	const cwd = getWorkspacePath()
	if (!cwd) {
		return
	}

	if ((osInfo !== "win32" && mention.startsWith("/")) || (osInfo === "win32" && mention.startsWith("\\"))) {
		const relPath = mention.slice(1)
		let absPath = path.resolve(cwd, relPath)
		if (absPath.includes(" ")) {
			let escapedSpace = osInfo === "win32" ? "/ " : "\\ "
			absPath = absPath.replaceAll(escapedSpace, " ")
		}
		if (
			((osInfo === "unix" || osInfo === undefined) && mention.endsWith("/")) ||
			(osInfo === "win32" && mention.endsWith("\\"))
		) {
			vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(absPath))
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
// Utility functions
export const createXmlTag = (name: string, attrs: Record<string, string> = {}): XmlTag => {
	const attrString = Object.entries(attrs)
		.map(([key, value]) => `${key}="${value}"`)
		.join(" ")
	return {
		start: `\n\n<${name}${attrString ? " " + attrString : ""}>`,
		end: `</${name}>`,
	}
}

export const wrapContent = (content: string, tag: XmlTag): string => `${tag.start}\n${content}\n${tag.end}`

export const handleError = (error: Error, message: string): string => {
	const errorMsg = `Error ${message}: ${error.message}`
	if (error instanceof Error) {
		vscode.window.showErrorMessage(errorMsg)
	}
	return errorMsg
}

// File utilities
export async function getFileOrFolderContent(mentionPath: string, cwd: string, osInfo: string): Promise<string> {
	const absPath = path.resolve(cwd, mentionPath)

	try {
		const stats = await fs.stat(absPath)

		if (stats.isFile()) {
			try {
				const content = await extractTextFromFile(absPath)
				return content
			} catch (error) {
				return `(Failed to read contents of ${mentionPath}): ${error.message}`
			}
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
					fileContentPromises.push(
						(async () => {
							try {
								const isBinary = await isBinaryFile(absoluteFilePath).catch(() => false)
								if (isBinary) {
									return undefined
								}
								const content = await extractTextFromFile(absoluteFilePath)
								return `<file_content path="${filePath}">\n${content}\n</file_content>`
							} catch (error) {
								return undefined
							}
						})(),
					)
				} else if (entry.isDirectory()) {
					folderContent += `${linePrefix}${entry.name}/\n`
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

// Workspace utilities
export async function getWorkspaceProblems(cwd: string): Promise<string> {
	const diagnostics = vscode.languages.getDiagnostics()
	const result = await diagnosticsToProblemsString(
		diagnostics,
		[vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
		cwd,
	)
	if (!result) {
		return "No errors or warnings detected."
	}
	return result
}

// Handler implementations
const urlHandler: HandlerConfig = {
	name: "url",
	test: (mention: string) => mention.startsWith("http"),
	handler: async (mention, { urlContentFetcher, launchBrowserError }) => {
		const tag = createXmlTag("url_content", { url: mention })
		let content: string

		if (launchBrowserError) {
			content = handleError(launchBrowserError, "fetching content")
		} else {
			try {
				content = await urlContentFetcher.urlToMarkdown(mention)
			} catch (error) {
				content = handleError(error, `fetching content for ${mention}`)
			}
		}
		return wrapContent(content, tag)
	},
}

const fileHandler: HandlerConfig = {
	name: "file",
	test: (mention: string, { osInfo }) => (osInfo !== "win32" ? mention.startsWith("/") : mention.startsWith("\\")),
	handler: async (mention, { cwd, osInfo }) => {
		let mentionPath = mention.slice(1)
		const isFolder = osInfo === "win32" ? mention.endsWith("\\") : mention.endsWith("/")
		const tag = createXmlTag(isFolder ? "folder_content" : "file_content", { path: mentionPath })

		if (mentionPath.includes(" ")) {
			let escapedSpace = osInfo === "win32" ? "/ " : "\\ "
			mentionPath = mentionPath.replaceAll(escapedSpace, " ")
		}

		try {
			const content = await getFileOrFolderContent(mentionPath, cwd, osInfo)
			return wrapContent(content, tag)
		} catch (error) {
			return wrapContent(handleError(error, "fetching content"), tag)
		}
	},
}

const problemsHandler: HandlerConfig = {
	name: "problems",
	test: (mention: string) => mention === "problems",
	handler: async (mention, { cwd }) => {
		const tag = createXmlTag("workspace_diagnostics")
		try {
			const problems = await getWorkspaceProblems(cwd)
			return wrapContent(problems, tag)
		} catch (error) {
			return wrapContent(handleError(error, "fetching diagnostics"), tag)
		}
	},
}

const gitChangesHandler: HandlerConfig = {
	name: "git-changes",
	test: (mention: string) => mention === "git-changes",
	handler: async (mention, { cwd }) => {
		const tag = createXmlTag("git_working_state")
		try {
			const workingState = await getWorkingState(cwd)
			return wrapContent(workingState, tag)
		} catch (error) {
			return wrapContent(handleError(error, "fetching working state"), tag)
		}
	},
}

const commitHandler: HandlerConfig = {
	name: "commit",
	test: (mention: string) => /^[a-f0-9]{7,40}$/.test(mention),
	handler: async (mention, { cwd }) => {
		const tag = createXmlTag("git_commit", { hash: mention })
		try {
			const commitInfo = await getCommitInfo(mention, cwd)
			return wrapContent(commitInfo, tag)
		} catch (error) {
			return wrapContent(handleError(error, "fetching commit info"), tag)
		}
	},
}

const terminalHandler: HandlerConfig = {
	name: "terminal",
	test: (mention: string) => mention === "terminal",
	handler: async (mention) => {
		const tag = createXmlTag("terminal_output")
		try {
			const terminalOutput = await getLatestTerminalOutput()
			return wrapContent(terminalOutput, tag)
		} catch (error) {
			return wrapContent(handleError(error, "fetching terminal output"), tag)
		}
	},
}

// Define handlers array
const handlers: HandlerConfig[] = [
	urlHandler,
	fileHandler,
	problemsHandler,
	gitChangesHandler,
	commitHandler,
	terminalHandler,
]

export async function parseMentions(
	text: string,
	cwd: string,
	urlContentFetcher: UrlContentFetcher,
	osInfo: string = "unix",
): Promise<string> {
	const mentions: Set<string> = new Set()
	let parsedText = text.replace(mentionRegexGlobal, (match, mention) => {
		mentions.add(mention)
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		}

		if (
			(osInfo !== "win32" && osInfo !== undefined && mention.startsWith("/")) ||
			(osInfo === "win32" && mention.startsWith("\\"))
		) {
			const mentionPath = mention.slice(1)
			return mentionPath.endsWith("/") || mentionPath.endsWith("\\")
				? `'${mentionPath}' (see below for folder content)`
				: `'${mentionPath}' (see below for file content)`
		}

		if (mention === "problems") {
			return `Workspace Problems (see below for diagnostics)`
		}
		if (mention === "git-changes") {
			return `Working directory changes (see below for details)`
		}
		if (/^[a-f0-9]{7,40}$/.test(mention)) {
			return `Git commit '${mention}' (see below for commit info)`
		}

		if (mention === "terminal") {
			return `Terminal Output (see below for output)`
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

	const context: MentionContext = {
		cwd,
		urlContentFetcher,
		launchBrowserError,
		osInfo,
	}

	const mentionResults = await Promise.all(
		Array.from(mentions).map(async (mention) => {
			for (const handler of handlers) {
				if (handler.test(mention, context)) {
					return handler.handler(mention, context)
				}
			}
			return ""
		}),
	)

	parsedText += mentionResults.join("")

	if (urlMention) {
		try {
			await urlContentFetcher.closeBrowser()
		} catch (error) {
			console.error(`Error closing browser: ${error.message}`)
		}
	}

	return parsedText
}
