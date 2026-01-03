import { diagnosticsToProblemsString } from "@integrations/diagnostics"
import { extractTextFromFile } from "@integrations/misc/extract-text"
import { openFile } from "@integrations/misc/open-file"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { telemetryService } from "@services/telemetry"
import { mentionRegexGlobal } from "@shared/context-mentions"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { openExternal } from "@utils/env"
import { getCommitInfo, getWorkingState } from "@utils/git"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getLatestTerminalOutput } from "@/hosts/vscode/terminal/get-latest-output"
import { ShowMessageType } from "@/shared/proto/host/window"
import { DiagnosticSeverity } from "@/shared/proto/index.cline"
import { isDirectory } from "@/utils/fs"
import { getCwd } from "@/utils/path"
import { FileContextTracker } from "../context/context-tracking/FileContextTracker"
import type { WorkspaceRootManager } from "../workspace"

export async function openMention(mention?: string): Promise<void> {
	if (!mention) {
		return
	}

	const cwd = await getCwd()
	if (!cwd) {
		return
	}

	if (isFileMention(mention)) {
		const relPath = getFilePathFromMention(mention)
		const absPath = path.resolve(cwd, relPath)
		if (await isDirectory(absPath)) {
			await HostProvider.workspace.openInFileExplorerPanel({ path: absPath })
		} else {
			openFile(absPath)
		}
	} else if (mention === "problems") {
		await HostProvider.workspace.openProblemsPanel({})
	} else if (mention === "terminal") {
		await HostProvider.workspace.openTerminalPanel({})
	} else if (mention.startsWith("http")) {
		await openExternal(mention)
	}
}

export async function getFileMentionFromPath(filePath: string) {
	const cwd = await getCwd()
	if (!cwd) {
		return "@/" + filePath
	}
	const relativePath = path.relative(cwd, filePath)
	return "@/" + relativePath
}

export async function parseMentions(
	text: string,
	cwd: string,
	urlContentFetcher: UrlContentFetcher,
	fileContextTracker?: FileContextTracker,
	workspaceManager?: WorkspaceRootManager,
): Promise<string> {
	const mentions: Set<string> = new Set()
	let parsedText = text.replace(mentionRegexGlobal, (match, mention) => {
		mentions.add(mention)
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		} else if (isFileMention(mention)) {
			const mentionPath = getFilePathFromMention(mention)
			const workspaceHint = getWorkspaceHintFromMention(mention)
			// For workspace-prefixed mentions, include the workspace name in the same format the model uses for tool calls
			if (workspaceHint) {
				return mentionPath.endsWith("/")
					? `'${workspaceHint}:${mentionPath}' (see below for folder content)`
					: `'${workspaceHint}:${mentionPath}' (see below for file content)`
			}
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
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Error fetching content for ${urlMention}: ${error.message}`,
			})
		}
	}

	// Filter out duplicate mentions while preserving order
	const uniqueMentions = Array.from(new Set(mentions))

	for (const mention of uniqueMentions) {
		// Safety guard: skip a bare "/" mention. This can surface from parsed strings or tool output and would resolve to the
		// workspace root. Expanding it would scan the entire project, inflate context, and can trigger recursive loops.
		// If root-level expansion is ever desired, gate it behind an explicit syntax (e.g. "@root" or "@folder:/")
		// and enforce strict size/.clineignore limits instead.
		if (mention === "/") {
			continue
		}

		if (mention.startsWith("http")) {
			let result: string
			if (launchBrowserError) {
				result = `Error fetching content: ${launchBrowserError.message}`
				// Track failed URL mention
				telemetryService.captureMentionFailed("url", "network_error", launchBrowserError?.message || "")
			} else {
				try {
					const markdown = await urlContentFetcher.urlToMarkdown(mention)
					result = markdown
					// Track successful URL mention
					telemetryService.captureMentionUsed("url", markdown.length)
				} catch (error) {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Error fetching content for ${mention}: ${error.message}`,
					})
					result = `Error fetching content: ${error.message}`
					// Track failed URL mention
					telemetryService.captureMentionFailed("url", "network_error", error.message)
				}
			}
			parsedText += `\n\n<url_content url="${mention}">\n${result}\n</url_content>`
		} else if (isFileMention(mention)) {
			const mentionPath = getFilePathFromMention(mention)
			const mentionType = mention.endsWith("/") ? "folder" : "file"
			const workspaceHint = getWorkspaceHintFromMention(mention)

			const isMultiRoot = workspaceManager && workspaceManager.getRoots().length > 1
			if (isMultiRoot && !workspaceHint) {
				// Parallel search across all workspaces
				const workspaceRoots = workspaceManager.getRoots()
				const searchPromises = workspaceRoots.map(async (root: WorkspaceRoot) => {
					try {
						const content = await getFileOrFolderContent(mentionPath, root.path)
						return {
							workspaceName: root.name || path.basename(root.path),
							content,
							success: true,
						}
					} catch (error) {
						return {
							workspaceName: root.name || path.basename(root.path),
							content: null,
							success: false,
							error: error.message,
						}
					}
				})

				const results = await Promise.all(searchPromises)
				const successfulResults = results.filter((r) => r.success && r.content)

				if (successfulResults.length === 0) {
					const errorMsg = `File not found in any workspace. Searched: ${results.map((r) => r.workspaceName).join(", ")}`
					if (mention.endsWith("/")) {
						parsedText += `\n\n<folder_content path="${mentionPath}">\nError fetching content: ${errorMsg}\n</folder_content>`
					} else {
						parsedText += `\n\n<file_content path="${mentionPath}">\nError fetching content: ${errorMsg}\n</file_content>`
					}
					telemetryService.captureMentionFailed(mentionType, "not_found", errorMsg)
				} else if (successfulResults.length === 1) {
					// Found in exactly one workspace
					const result = successfulResults[0]
					if (mention.endsWith("/")) {
						parsedText += `\n\n<folder_content path="${mentionPath}" workspace="${result.workspaceName}">\n${result.content}\n</folder_content>`
					} else {
						parsedText += `\n\n<file_content path="${mentionPath}" workspace="${result.workspaceName}">\n${result.content}\n</file_content>`
						if (fileContextTracker) {
							await fileContextTracker.trackFileContext(mentionPath, "file_mentioned")
						}
					}
					telemetryService.captureMentionUsed(mentionType, result.content!.length)
				} else {
					// Found in multiple workspaces - include all candidates with workspace name
					for (const result of successfulResults) {
						if (mention.endsWith("/")) {
							parsedText += `\n\n<folder_content path="${mentionPath}" workspace="${result.workspaceName}">\n${result.content}\n</folder_content>`
						} else {
							parsedText += `\n\n<file_content path="${mentionPath}" workspace="${result.workspaceName}">\n${result.content}\n</file_content>`
						}
					}
					const totalLength = successfulResults.reduce((sum, r) => sum + (r.content?.length || 0), 0)
					telemetryService.captureMentionUsed(mentionType, totalLength)
				}
			} else if (isMultiRoot && workspaceHint) {
				// Search only in specified workspace
				const targetRoot = workspaceManager.getRootByName(workspaceHint)
				if (!targetRoot) {
					const errorMsg = `Workspace '${workspaceHint}' not found`
					if (mention.endsWith("/")) {
						parsedText += `\n\n<folder_content path="${mentionPath}" workspace="${workspaceHint}">\nError fetching content: ${errorMsg}\n</folder_content>`
					} else {
						parsedText += `\n\n<file_content path="${mentionPath}" workspace="${workspaceHint}">\nError fetching content: ${errorMsg}\n</file_content>`
					}
					telemetryService.captureMentionFailed(mentionType, "not_found", errorMsg)
				} else {
					try {
						const content = await getFileOrFolderContent(mentionPath, targetRoot.path)
						if (mention.endsWith("/")) {
							parsedText += `\n\n<folder_content path="${mentionPath}" workspace="${workspaceHint}">\n${content}\n</folder_content>`
						} else {
							parsedText += `\n\n<file_content path="${mentionPath}" workspace="${workspaceHint}">\n${content}\n</file_content>`
							if (fileContextTracker) {
								await fileContextTracker.trackFileContext(mentionPath, "file_mentioned")
							}
						}
						telemetryService.captureMentionUsed(mentionType, content.length)
					} catch (error) {
						if (mention.endsWith("/")) {
							parsedText += `\n\n<folder_content path="${mentionPath}" workspace="${workspaceHint}">\nError fetching content: ${error.message}\n</folder_content>`
						} else {
							parsedText += `\n\n<file_content path="${mentionPath}" workspace="${workspaceHint}">\nError fetching content: ${error.message}\n</file_content>`
						}
						let errorType: "not_found" | "permission_denied" | "unknown" = "unknown"
						if (error.message.includes("ENOENT") || error.message.includes("Failed to access")) {
							errorType = "not_found"
						} else if (error.message.includes("EACCES") || error.message.includes("permission")) {
							errorType = "permission_denied"
						}
						telemetryService.captureMentionFailed(mentionType, errorType, error.message)
					}
				}
			} else {
				// Legacy single workspace mode
				try {
					const content = await getFileOrFolderContent(mentionPath, cwd)
					if (mention.endsWith("/")) {
						parsedText += `\n\n<folder_content path="${mentionPath}">\n${content}\n</folder_content>`
					} else {
						parsedText += `\n\n<file_content path="${mentionPath}">\n${content}\n</file_content>`
						if (fileContextTracker) {
							await fileContextTracker.trackFileContext(mentionPath, "file_mentioned")
						}
					}
					telemetryService.captureMentionUsed(mentionType, content.length)
				} catch (error) {
					if (mention.endsWith("/")) {
						parsedText += `\n\n<folder_content path="${mentionPath}">\nError fetching content: ${error.message}\n</folder_content>`
					} else {
						parsedText += `\n\n<file_content path="${mentionPath}">\nError fetching content: ${error.message}\n</file_content>`
					}
					let errorType: "not_found" | "permission_denied" | "unknown" = "unknown"
					if (error.message.includes("ENOENT") || error.message.includes("Failed to access")) {
						errorType = "not_found"
					} else if (error.message.includes("EACCES") || error.message.includes("permission")) {
						errorType = "permission_denied"
					}
					telemetryService.captureMentionFailed(mentionType, errorType, error.message)
				}
			}
		} else if (mention === "problems") {
			try {
				const problems = await getWorkspaceProblems()
				parsedText += `\n\n<workspace_diagnostics>\n${problems}\n</workspace_diagnostics>`
				// Track successful problems mention
				telemetryService.captureMentionUsed("problems", problems.length)
			} catch (error) {
				parsedText += `\n\n<workspace_diagnostics>\nError fetching diagnostics: ${error.message}\n</workspace_diagnostics>`
				// Track failed problems mention
				telemetryService.captureMentionFailed("problems", "unknown", error.message)
			}
		} else if (mention === "terminal") {
			try {
				const terminalOutput = await getLatestTerminalOutput()
				parsedText += `\n\n<terminal_output>\n${terminalOutput}\n</terminal_output>`
				// Track successful terminal mention
				telemetryService.captureMentionUsed("terminal", terminalOutput.length)
			} catch (error) {
				parsedText += `\n\n<terminal_output>\nError fetching terminal output: ${error.message}\n</terminal_output>`
				// Track failed terminal mention
				telemetryService.captureMentionFailed("terminal", "unknown", error.message)
			}
		} else if (mention === "git-changes") {
			try {
				const workingState = await getWorkingState(cwd)
				parsedText += `\n\n<git_working_state>\n${workingState}\n</git_working_state>`
				// Track successful git-changes mention
				telemetryService.captureMentionUsed("git-changes", workingState.length)
			} catch (error) {
				parsedText += `\n\n<git_working_state>\nError fetching working state: ${error.message}\n</git_working_state>`
				// Track failed git-changes mention
				telemetryService.captureMentionFailed("git-changes", "unknown", error.message)
			}
		} else if (/^[a-f0-9]{7,40}$/.test(mention)) {
			try {
				const commitInfo = await getCommitInfo(mention, cwd)
				parsedText += `\n\n<git_commit hash="${mention}">\n${commitInfo}\n</git_commit>`
				// Track successful commit mention
				telemetryService.captureMentionUsed("commit", commitInfo.length)
			} catch (error) {
				parsedText += `\n\n<git_commit hash="${mention}">\nError fetching commit info: ${error.message}\n</git_commit>`
				// Track failed commit mention
				telemetryService.captureMentionFailed("commit", "unknown", error.message)
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
							} catch (_error) {
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

async function getWorkspaceProblems(): Promise<string> {
	const response = await HostProvider.workspace.getDiagnostics({})
	if (response.fileDiagnostics.length === 0) {
		return "No errors or warnings detected."
	}
	return diagnosticsToProblemsString(response.fileDiagnostics, [
		DiagnosticSeverity.DIAGNOSTIC_ERROR,
		DiagnosticSeverity.DIAGNOSTIC_WARNING,
	])
}

/**
 * Parse a workspace mention to extract workspace hint and path
 * @param mention The raw mention string (e.g., "workspace:name/path/to/file")
 * @returns Object with workspaceHint and path, or null if not a workspace mention
 */
function parseWorkspaceMention(mention: string): { workspaceHint: string; path: string } | null {
	// Match workspace:name/path or workspace:"name/path with spaces"
	const workspaceMatch = mention.match(/^([\w-]+):(.+)$/)
	if (!workspaceMatch) {
		return null
	}

	const [, workspaceHint, pathPart] = workspaceMatch

	// Check if it's actually a URL (has ://)
	if (mention.includes("://")) {
		return null
	}

	// Remove quotes from path if present
	const quotedPathMatch = pathPart.match(/^"(.*)"$/)
	const cleanPath = quotedPathMatch ? quotedPathMatch[1] : pathPart

	return { workspaceHint, path: cleanPath }
}

function isFileMention(mention: string): boolean {
	// Check for workspace-prefixed mentions first
	if (parseWorkspaceMention(mention)) {
		return true
	}
	// Check for regular file mentions
	return mention.startsWith("/") || mention.startsWith('"/')
}

function getFilePathFromMention(mention: string): string {
	// Check for workspace-prefixed mentions first
	const workspaceMention = parseWorkspaceMention(mention)
	if (workspaceMention) {
		// Return path without leading slash (already cleaned)
		return workspaceMention.path.startsWith("/") ? workspaceMention.path.slice(1) : workspaceMention.path
	}

	// Remove quotes
	const match = mention.match(/^"(.*)"$/)
	const filePath = match ? match[1] : mention
	// Remove leading slash
	return filePath.slice(1)
}

function getWorkspaceHintFromMention(mention: string): string | undefined {
	const workspaceMention = parseWorkspaceMention(mention)
	return workspaceMention?.workspaceHint
}
