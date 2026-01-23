/**
 * ACP Host Bridge Provider for file operations delegation.
 *
 * This provider delegates file read/write operations to the ACP client,
 * allowing the editor to handle file I/O instead of the agent directly
 * accessing the file system.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"

/**
 * Result of a file read operation.
 */
export interface FileReadResult {
	/** The content of the file */
	content: string
	/** Whether the operation was successful */
	success: boolean
	/** Error message if the operation failed */
	error?: string
}

/**
 * Result of a file write operation.
 */
export interface FileWriteResult {
	/** Whether the operation was successful */
	success: boolean
	/** Error message if the operation failed */
	error?: string
}

/**
 * Options for reading a file.
 */
export interface FileReadOptions {
	/** Line number to start reading from (1-based) */
	startLine?: number
	/** Maximum number of lines to read */
	lineLimit?: number
}

/**
 * Provider for delegating file operations to the ACP client.
 *
 * This class wraps the ACP connection's file methods and provides
 * a simple interface for file operations with capability checking.
 */
export class AcpHostBridgeProvider {
	private readonly connection: acp.AgentSideConnection
	private readonly clientCapabilities: acp.ClientCapabilities | undefined
	private readonly sessionId: string
	private readonly debug: boolean

	/**
	 * Creates a new AcpHostBridgeProvider.
	 *
	 * @param connection - The ACP agent-side connection
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionId - The current session ID
	 * @param debug - Whether to enable debug logging
	 */
	constructor(
		connection: acp.AgentSideConnection,
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionId: string,
		debug: boolean = false,
	) {
		this.connection = connection
		this.clientCapabilities = clientCapabilities
		this.sessionId = sessionId
		this.debug = debug
	}

	/**
	 * Check if the client supports file read operations.
	 */
	canReadFile(): boolean {
		return this.clientCapabilities?.fs?.readTextFile === true
	}

	/**
	 * Check if the client supports file write operations.
	 */
	canWriteFile(): boolean {
		return this.clientCapabilities?.fs?.writeTextFile === true
	}

	/**
	 * Check if the client supports terminal operations.
	 */
	canUseTerminal(): boolean {
		return this.clientCapabilities?.terminal === true
	}

	/**
	 * Read a text file via the ACP client.
	 *
	 * @param path - Absolute path to the file to read
	 * @param options - Optional read options (start line, line limit)
	 * @returns The file content or an error result
	 */
	async readTextFile(path: string, options?: FileReadOptions): Promise<FileReadResult> {
		if (!this.canReadFile()) {
			return {
				content: "",
				success: false,
				error: "Client does not support fs.readTextFile capability",
			}
		}

		if (this.debug) {
			console.error("[AcpHostBridgeProvider] readTextFile:", { path, options })
		}

		try {
			const request: acp.ReadTextFileRequest = {
				sessionId: this.sessionId,
				path,
			}

			// Add optional parameters if provided
			if (options?.startLine !== undefined) {
				request.line = options.startLine
			}
			if (options?.lineLimit !== undefined) {
				request.limit = options.lineLimit
			}

			const response = await this.connection.readTextFile(request)

			if (this.debug) {
				console.error("[AcpHostBridgeProvider] readTextFile response:", {
					contentLength: response.content.length,
				})
			}

			return {
				content: response.content,
				success: true,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpHostBridgeProvider] readTextFile error:", errorMessage)
			}

			return {
				content: "",
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Write content to a text file via the ACP client.
	 *
	 * @param path - Absolute path to the file to write
	 * @param content - The text content to write
	 * @returns A result indicating success or failure
	 */
	async writeTextFile(path: string, content: string): Promise<FileWriteResult> {
		if (!this.canWriteFile()) {
			return {
				success: false,
				error: "Client does not support fs.writeTextFile capability",
			}
		}

		if (this.debug) {
			console.error("[AcpHostBridgeProvider] writeTextFile:", {
				path,
				contentLength: content.length,
			})
		}

		try {
			const request: acp.WriteTextFileRequest = {
				sessionId: this.sessionId,
				path,
				content,
			}

			await this.connection.writeTextFile(request)

			if (this.debug) {
				console.error("[AcpHostBridgeProvider] writeTextFile success")
			}

			return {
				success: true,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			if (this.debug) {
				console.error("[AcpHostBridgeProvider] writeTextFile error:", errorMessage)
			}

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Check if file operations should be delegated to the client.
	 *
	 * This is a convenience method that returns true if the client
	 * supports at least one file operation capability.
	 */
	shouldDelegateFileOperations(): boolean {
		return this.canReadFile() || this.canWriteFile()
	}

	/**
	 * Get the current session ID.
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Get the client capabilities.
	 */
	getClientCapabilities(): acp.ClientCapabilities | undefined {
		return this.clientCapabilities
	}
}
