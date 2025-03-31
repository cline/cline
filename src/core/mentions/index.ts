import * as vscode from "vscode"
import * as path from "path"
import { openFile } from "../../integrations/misc/open-file"
import { UrlContentFetcher } from "../../services/browser/UrlContentFetcher"
import { mentionRegexGlobal } from "../../shared/context-mentions"
import * as fsPromises from "fs/promises"
import { extractTextFromFile } from "../../integrations/misc/extract-text"
import { isBinaryFile } from "isbinaryfile"
import { diagnosticsToProblemsString } from "../../integrations/diagnostics"
import { getLatestTerminalOutput } from "../../integrations/terminal/get-latest-output"
import { getCommitInfo, getWorkingState } from "../../utils/git"
import { fileExistsAtPath, isDirectory } from "../../utils/fs" // Added for notes

export function openMention(mention?: string): void {
	if (!mention) {
		return
	}

	const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
	if (!cwd) {
		return
	}

	if (mention.startsWith("/")) {
		const relPath = mention.slice(1)
		const absPath = path.resolve(cwd, relPath)
		if (mention.endsWith("/")) {
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

// --- Constants for Notes ---
const CLINERULES_DIR_NAME = ".clinerules"
const CLINEMOTES_FILE_NAME = "clinenotes.md"
const CLINERULES_FILE_NAME = ".clinerules"
const NOTE_SECTION_HEADER = "## @note"
const NOTE_PREFIX = "- "
const NOTE_REGEX_GLOBAL = /@note:(.*?)(?:\n|$)/g
const NOTE_SECTION_REGEX = new RegExp(`^${NOTE_SECTION_HEADER}\\s*\\n`, "m") // Use multiline flag

/**
 * Processes @note patterns in text and saves them to appropriate files.
 * Returns a result object with success status and message.
 *
 * @param text Text containing @note patterns
 * @param cwd Current working directory
 * @param fsModule Optional filesystem object for dependency injection
 * @returns Result object with success and message properties, or undefined if no notes found
 */
export async function processNotes(
	text: string,
	cwd: string,
	fsModule: any = fsPromises,
): Promise<{ success: boolean; message: string } | undefined> {
	const noteMatches = Array.from(text.matchAll(NOTE_REGEX_GLOBAL))
	if (noteMatches.length === 0) {
		return undefined
	}

	try {
		// Process the last note found (consistent with original behavior)
		const lastMatch = noteMatches[noteMatches.length - 1]
		const note = lastMatch[1].trim()
		await saveNote(note, cwd, fsModule)
		return { success: true, message: `Note saved: "${note}"` }
	} catch (error: any) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error("Failed to save note:", errorMessage)
		return { success: false, message: errorMessage }
	}
}

export async function parseMentions(
	text: string,
	cwd: string,
	urlContentFetcher: UrlContentFetcher,
	fsModule: any = fsPromises,
): Promise<string> {
	const mentionsSet: Set<string> = new Set() // Stores core mention strings (e.g., /path/to/file, https://...) for content fetching
	// Note processing is now handled solely by processNotes in Cline.ts loadContext
	const otherMentionsRaw: string[] = [] // Store raw other mentions found in original text for iteration

	// --- Step 1 & 2: Note processing and replacement are handled by processNotes before this function is called ---
	let textWithNotesReplaced = text // Use the original text, assuming notes are handled elsewhere

	// --- Step 3: Process and Replace other mentions (@/, @http, etc.) on the result of Step 2 ---
	// Also collect the raw other mentions from the original text for content fetching later
	let parsedText = textWithNotesReplaced.replace(mentionRegexGlobal, (match, mention) => {
		// Note processing is handled elsewhere, so no need for the noteProcessingResults check here.

		// If it's not a note mention, process it as file/URL/etc.
		// Add the core mention part (e.g., /src/file.ts) to the set for content fetching
		if (!mentionsSet.has(mention)) {
			mentionsSet.add(mention)
			otherMentionsRaw.push(mention) // Store unique raw mentions for iteration later
		}

		// Perform replacement text generation for file/URL/etc.
		if (mention.startsWith("http")) {
			return `'${mention}' (see below for site content)`
		} else if (mention.startsWith("/")) {
			const mentionPath = mention.slice(1)
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
		return match // Keep original if not recognized (shouldn't happen with current regex)
	})

	// --- Step 4: Process content for other mentions and append blocks ---
	// Use the unique raw mentions collected in Step 3
	const uniqueOtherMentions = Array.from(new Set(otherMentionsRaw))

	const urlMention = uniqueOtherMentions.find((mention) => mention.startsWith("http"))
	let launchBrowserError: Error | undefined
	if (urlMention) {
		try {
			await urlContentFetcher.launchBrowser()
		} catch (error: any) {
			// Catch as any
			launchBrowserError = error instanceof Error ? error : new Error(String(error))
			vscode.window.showErrorMessage(`Error launching browser for ${urlMention}: ${launchBrowserError.message}`)
		}
	}

	for (const mention of uniqueOtherMentions) {
		// Note mentions are already handled and replaced in parsedText.
		// We only need to append content blocks for *other* mentions here.

		if (mention.startsWith("http")) {
			let result: string
			if (launchBrowserError) {
				result = `Error fetching content: ${launchBrowserError.message}`
			} else {
				try {
					const markdown = await urlContentFetcher.urlToMarkdown(mention)
					result = markdown
				} catch (error: any) {
					// Catch as any
					const errorMsg = error instanceof Error ? error.message : String(error)
					vscode.window.showErrorMessage(`Error fetching content for ${mention}: ${errorMsg}`)
					result = `Error fetching content: ${errorMsg}`
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
			} catch (error: any) {
				// Catch as any
				const errorMsg = error instanceof Error ? error.message : String(error)
				if (mention.endsWith("/")) {
					parsedText += `\n\n<folder_content path="${mentionPath}">\nError fetching content: ${errorMsg}\n</folder_content>`
				} else {
					parsedText += `\n\n<file_content path="${mentionPath}">\nError fetching content: ${errorMsg}\n</file_content>`
				}
			}
		} else if (mention === "problems") {
			try {
				const problems = getWorkspaceProblems(cwd)
				parsedText += `\n\n<workspace_diagnostics>\n${problems}\n</workspace_diagnostics>`
			} catch (error: any) {
				// Catch as any
				const errorMsg = error instanceof Error ? error.message : String(error)
				parsedText += `\n\n<workspace_diagnostics>\nError fetching diagnostics: ${errorMsg}\n</workspace_diagnostics>`
			}
		} else if (mention === "terminal") {
			try {
				const terminalOutput = await getLatestTerminalOutput()
				parsedText += `\n\n<terminal_output>\n${terminalOutput}\n</terminal_output>`
			} catch (error: any) {
				// Catch as any
				const errorMsg = error instanceof Error ? error.message : String(error)
				parsedText += `\n\n<terminal_output>\nError fetching terminal output: ${errorMsg}\n</terminal_output>`
			}
		} else if (mention === "git-changes") {
			try {
				const workingState = await getWorkingState(cwd)
				parsedText += `\n\n<git_working_state>\n${workingState}\n</git_working_state>`
			} catch (error: any) {
				// Catch as any
				const errorMsg = error instanceof Error ? error.message : String(error)
				parsedText += `\n\n<git_working_state>\nError fetching working state: ${errorMsg}\n</git_working_state>`
			}
		} else if (/^[a-f0-9]{7,40}$/.test(mention)) {
			try {
				const commitInfo = await getCommitInfo(mention, cwd)
				parsedText += `\n\n<git_commit hash="${mention}">\n${commitInfo}\n</git_commit>`
			} catch (error: any) {
				// Catch as any
				const errorMsg = error instanceof Error ? error.message : String(error)
				parsedText += `\n\n<git_commit hash="${mention}">\nError fetching commit info: ${errorMsg}\n</git_commit>`
			}
		}
	}

	if (urlMention) {
		try {
			await urlContentFetcher.closeBrowser()
		} catch (error: any) {
			// Catch as any
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.error(`Error closing browser: ${errorMsg}`)
		}
	}

	return parsedText
}

// --- Note Saving Logic (Moved from notes/index.ts and adapted) ---

/**
 * Saves the note to the appropriate file (.clinerules or clinerules/clinenotes.md).
 * Uses provided fs module or fs/promises as default.
 * @param note The note content to save.
 * @param cwd Current working directory.
 * @param fsModule Optional filesystem module (defaults to fs/promises)
 */
async function saveNote(note: string, cwd: string, fsModule: any = fsPromises): Promise<void> {
	const clinerulesDirPath = path.join(cwd, CLINERULES_DIR_NAME)
	const noteContent = `${NOTE_PREFIX}${note}\n`

	// Check if clinerules directory exists
	if ((await fileExistsAtPath(clinerulesDirPath)) && (await isDirectory(clinerulesDirPath))) {
		const notesFilePath = path.join(clinerulesDirPath, CLINEMOTES_FILE_NAME)
		await appendToOrCreateFile(notesFilePath, noteContent, fsModule)
	} else {
		const clineruleFilePath = path.join(cwd, CLINERULES_FILE_NAME)
		await appendToNoteSection(clineruleFilePath, note, fsModule)
	}
}

/**
 * Appends content to a file or creates the file if it doesn't exist.
 * Uses provided fs module or fs/promises as default.
 * @param filePath File path.
 * @param content Content to append.
 * @param fsModule Optional filesystem module (defaults to fs/promises)
 */
async function appendToOrCreateFile(filePath: string, content: string, fsModule: any = fsPromises): Promise<void> {
	try {
		// Use appendFile which creates the file if it doesn't exist
		await fsModule.appendFile(filePath, content, "utf8")
	} catch (error: any) {
		// Rethrow with a more specific message if needed, or just let the original error propagate
		throw new Error(`Failed to append to or create file ${filePath}: ${error.message}`)
	}
}

/**
 * Appends a note to the ##@note section in the .clinerules file.
 * Creates the file or section if they don't exist.
 * Uses provided fs module or fs/promises as default.
 * @param filePath Path to the .clinerules file.
 * @param note The note to append (without the prefix).
 * @param fsModule Optional filesystem module (defaults to fs/promises)
 */
async function appendToNoteSection(filePath: string, note: string, fsModule: any = fsPromises): Promise<void> {
	const noteLine = `${NOTE_PREFIX}${note}\n`
	try {
		let fileContent = ""
		let fileExists = await fileExistsAtPath(filePath)

		if (fileExists) {
			// Read file as string using fs.readFile
			fileContent = await fsModule.readFile(filePath, { encoding: "utf8" })
			const sectionMatch = fileContent.match(NOTE_SECTION_REGEX)

			if (sectionMatch && sectionMatch.index !== undefined) {
				// Insert the note line after the header
				const insertPosition = sectionMatch.index + sectionMatch[0].length
				fileContent = fileContent.slice(0, insertPosition) + noteLine + fileContent.slice(insertPosition)
			} else {
				// Append the section and the note line if the section doesn't exist
				fileContent = `${fileContent.trimEnd()}\n\n${NOTE_SECTION_HEADER}\n${noteLine}`
			}
		} else {
			// Create default content if the file doesn't exist
			fileContent = `# Cline Rules\n\n${NOTE_SECTION_HEADER}\n${noteLine}`
		}

		// Write the updated content back to the file using fs.writeFile
		await fsModule.writeFile(filePath, fileContent, "utf8")
	} catch (error: any) {
		throw new Error(`Failed to update ${CLINERULES_FILE_NAME} file at ${filePath}: ${error.message}`)
	}
}

// --- File/Folder Content Logic ---

async function getFileOrFolderContent(mentionPath: string, cwd: string): Promise<string> {
	const absPath = path.resolve(cwd, mentionPath)

	try {
		const stats = await fsPromises.stat(absPath)

		if (stats.isFile()) {
			const isBinary = await isBinaryFile(absPath).catch(() => false)
			if (isBinary) {
				return "(Binary file, unable to display content)"
			}
			const content = await extractTextFromFile(absPath)
			return content
		} else if (stats.isDirectory()) {
			const entries = await fsPromises.readdir(absPath, { withFileTypes: true })
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

// --- Workspace Problems Logic ---

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
