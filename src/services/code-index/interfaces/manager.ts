import { VectorStoreSearchResult } from "./vector-store"
import * as vscode from "vscode"

/**
 * Interface for the code index manager
 */
export interface ICodeIndexManager {
	/**
	 * Event emitted when progress is updated
	 */
	onProgressUpdate: vscode.Event<{
		systemStatus: IndexingState
		fileStatuses: Record<string, string>
		message?: string
	}>

	/**
	 * Current state of the indexing process
	 */
	readonly state: IndexingState

	/**
	 * Whether the code indexing feature is enabled
	 */
	readonly isFeatureEnabled: boolean

	/**
	 * Whether the code indexing feature is configured
	 */
	readonly isFeatureConfigured: boolean

	/**
	 * Loads configuration from storage
	 */
	loadConfiguration(): Promise<void>

	/**
	 * Starts the indexing process
	 */
	startIndexing(): Promise<void>

	/**
	 * Stops the file watcher
	 */
	stopWatcher(): void

	/**
	 * Clears the index data
	 */
	clearIndexData(): Promise<void>

	/**
	 * Searches the index
	 * @param query Query string
	 * @param limit Maximum number of results to return
	 * @returns Promise resolving to search results
	 */
	searchIndex(query: string, limit: number): Promise<VectorStoreSearchResult[]>

	/**
	 * Gets the current status of the indexing system
	 * @returns Current status information
	 */
	getCurrentStatus(): { systemStatus: IndexingState; fileStatuses: Record<string, string>; message?: string }

	/**
	 * Disposes of resources used by the manager
	 */
	dispose(): void
}

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error"
export type EmbedderProvider = "openai" | "ollama"

export interface IndexProgressUpdate {
	systemStatus: IndexingState
	message?: string
	processedBlockCount?: number
	totalBlockCount?: number
}
