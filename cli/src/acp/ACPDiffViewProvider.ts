/**
 * ACP-based implementation of DiffViewProvider that uses the ACP client's
 * filesystem capabilities for reading and writing files.
 *
 * This provider attempts to use the ACP client's fs/read_text_file and
 * fs/write_text_file methods when available, falling back to the
 * FileEditProvider's local filesystem implementation otherwise.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import { workspaceResolver } from "@core/workspace"
import { createDirectoriesForFile } from "@utils/fs"
import { getCwd } from "@utils/path"
import * as fs from "fs/promises"
import * as iconv from "iconv-lite"
import { HostProvider } from "@/hosts/host-provider"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { detectEncoding } from "@/integrations/misc/extract-text"
import type { FileDiagnostics } from "@/shared/proto/index.cline"
import { Logger } from "@/shared/services/Logger"

/**
 * A function that resolves the current session ID.
 * This is used by ACPDiffViewProvider to get the session ID at runtime,
 * since the provider may be created before a session exists.
 */
export type SessionIdResolver = () => string | undefined

/**
 * A DiffViewProvider implementation that uses the ACP client's filesystem
 * capabilities when available, with fallback to local filesystem operations.
 *
 * This class extends FileEditProvider and overrides the file I/O methods to
 * use the ACP protocol's fs/read_text_file and fs/write_text_file requests
 * when the client supports these capabilities. This allows the editor (client)
 * to handle file operations, which enables features like:
 * - Reading unsaved editor state
 * - Tracking file modifications in the editor
 * - Proper integration with the client's undo/redo stack
 */
export class ACPDiffViewProvider extends FileEditProvider {
	private readonly connection: acp.AgentSideConnection
	private readonly clientCapabilities: acp.ClientCapabilities | undefined
	private readonly sessionIdResolver: SessionIdResolver

	/**
	 * Creates a new ACPDiffViewProvider.
	 *
	 * @param connection - The ACP agent-side connection for making requests
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionIdResolver - A function that returns the current session ID
	 */
	constructor(
		connection: acp.AgentSideConnection,
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionIdResolver: SessionIdResolver,
	) {
		super()
		this.connection = connection
		this.clientCapabilities = clientCapabilities
		this.sessionIdResolver = sessionIdResolver
	}

	/**
	 * Gets the current session ID, or throws if no session is active.
	 */
	private getSessionId(): string {
		const sessionId = this.sessionIdResolver()
		if (!sessionId) {
			throw new Error("No active ACP session. Cannot perform file operation.")
		}
		return sessionId
	}

	/**
	 * Check if the client supports file read operations.
	 */
	private canReadFile(): boolean {
		return this.clientCapabilities?.fs?.readTextFile === true
	}

	/**
	 * Check if the client supports file write operations.
	 */
	private canWriteFile(): boolean {
		return this.clientCapabilities?.fs?.writeTextFile === true
	}

	/**
	 * Opens a file for editing, using ACP fs capabilities when available.
	 *
	 * If the client supports fs/read_text_file, this method will read the file
	 * content via the ACP connection, which may include unsaved editor state.
	 * Otherwise, it falls back to the FileEditProvider's local fs implementation.
	 */
	override async open(relPath: string, options?: { displayPath?: string }): Promise<void> {
		// If we can't read files via ACP, fall back to FileEditProvider
		if (!this.canReadFile()) {
			Logger.debug("[ACPDiffViewProvider] Client does not support fs.readTextFile, falling back to local fs")
			return super.open(relPath, options)
		}

		// Set up state - this replicates the DiffViewProvider.open() logic
		// but uses ACP for file reading instead of local fs
		this.isEditing = true
		const cwd = await getCwd()
		const absolutePathResolved = workspaceResolver.resolveWorkspacePath(cwd, relPath, "ACPDiffViewProvider.open.absolutePath")
		this.absolutePath = typeof absolutePathResolved === "string" ? absolutePathResolved : absolutePathResolved.absolutePath
		this.relPath = options?.displayPath ?? relPath
		const fileExists = this.editType === "modify"

		// Read file content
		if (fileExists) {
			// Try to save any dirty state in the editor first
			try {
				await HostProvider.workspace.saveOpenDocumentIfDirty({
					filePath: this.absolutePath!,
				})
			} catch {
				// Ignore errors - the host may not support this
			}

			// Read file content via ACP
			try {
				Logger.debug("[ACPDiffViewProvider] Reading file via ACP:", this.absolutePath)

				const response = await this.connection.readTextFile({
					sessionId: this.getSessionId(),
					path: this.absolutePath!,
				})

				this.originalContent = response.content
				// ACP always returns UTF-8 text content
				this.fileEncoding = "utf8"

				Logger.debug("[ACPDiffViewProvider] Read file successfully, length:", response.content.length)
			} catch (error) {
				// If ACP read fails, fall back to local fs
				Logger.debug("[ACPDiffViewProvider] ACP read failed, falling back to local fs:", error)

				const fileBuffer = await fs.readFile(this.absolutePath!)
				this.fileEncoding = await detectEncoding(fileBuffer)
				this.originalContent = iconv.decode(fileBuffer, this.fileEncoding)
			}
		} else {
			this.originalContent = ""
			this.fileEncoding = "utf8"
		}

		// Create directories for new files
		const createdDirs = await createDirectoriesForFile(this.absolutePath!)
		// Store for potential cleanup - access via the private field workaround
		;(this as any).createdDirs = createdDirs

		// Make sure the file exists before we proceed
		if (!fileExists) {
			// For new files, write via ACP if possible, otherwise local fs
			if (this.canWriteFile()) {
				try {
					await this.connection.writeTextFile({
						sessionId: this.getSessionId(),
						path: this.absolutePath!,
						content: "",
					})
				} catch {
					// Fall back to local fs
					await fs.writeFile(this.absolutePath!, "")
				}
			} else {
				await fs.writeFile(this.absolutePath!, "")
			}
		}

		// Get diagnostics before editing
		let preDiagnostics: FileDiagnostics[] = []
		try {
			preDiagnostics = (await HostProvider.workspace.getDiagnostics({})).fileDiagnostics
		} catch {
			preDiagnostics = []
		}
		;(this as any).preDiagnostics = preDiagnostics

		// Call the parent's openDiffEditor to set up in-memory document content
		await this.openDiffEditor()
		await this.scrollEditorToLine(0)
		;(this as any).streamedLines = []
	}

	/**
	 * Scrolls the editor to a specific line.
	 * No-op for file-based providers, but needed for protected access.
	 */
	protected override async scrollEditorToLine(_line: number): Promise<void> {
		// No-op: No visual editor to scroll
	}

	/**
	 * Opens the diff editor.
	 */
	protected override async openDiffEditor(): Promise<void> {
		// Set up in-memory document content from the original content
		// no-op: No visual editor to open
	}

	/**
	 * Saves the document content, using ACP fs capabilities when available.
	 *
	 * If the client supports fs/write_text_file, this method will write the file
	 * content via the ACP connection. Otherwise, it falls back to the
	 * FileEditProvider's local fs implementation.
	 */
	protected override async saveDocument(): Promise<Boolean> {
		// If we can't write files via ACP, fall back to FileEditProvider
		if (!this.canWriteFile()) {
			Logger.debug("[ACPDiffViewProvider] Client does not support fs.writeTextFile, falling back to local fs")
			return super.saveDocument()
		}

		const content = await this.getContent()
		if (!this.absolutePath || content === undefined) {
			return false
		}

		try {
			Logger.debug("[ACPDiffViewProvider] Writing file via ACP:", {
				path: this.absolutePath,
				contentLength: content.length,
			})

			await this.connection.writeTextFile({
				sessionId: this.getSessionId(),
				path: this.absolutePath,
				content: content,
			})

			Logger.debug("[ACPDiffViewProvider] Write file successfully")

			return true
		} catch (error) {
			// If ACP write fails, fall back to local fs
			Logger.debug("[ACPDiffViewProvider] ACP write failed, falling back to local fs:", error)

			return super.saveDocument()
		}
	}
}
