import * as vscode from "vscode"
import {
	QDRANT_CODE_BLOCK_NAMESPACE,
	MAX_FILE_SIZE_BYTES,
	BATCH_SEGMENT_THRESHOLD,
	MAX_BATCH_RETRIES,
	INITIAL_RETRY_DELAY_MS,
} from "../constants"
import { createHash } from "crypto"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { v5 as uuidv5 } from "uuid"
import { Ignore } from "ignore"
import { scannerExtensions } from "../shared/supported-extensions"
import {
	IFileWatcher,
	FileProcessingResult,
	IEmbedder,
	IVectorStore,
	PointStruct,
	BatchProcessingSummary,
} from "../interfaces"
import { codeParser } from "./parser"
import { CacheManager } from "../cache-manager"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "../shared/get-relative-path"
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"

/**
 * Implementation of the file watcher interface
 */
export class FileWatcher implements IFileWatcher {
	private ignoreInstance?: Ignore
	private fileWatcher?: vscode.FileSystemWatcher
	private ignoreController: RooIgnoreController
	private accumulatedEvents: Map<string, { uri: vscode.Uri; type: "create" | "change" | "delete" }> = new Map()
	private batchProcessDebounceTimer?: NodeJS.Timeout
	private readonly BATCH_DEBOUNCE_DELAY_MS = 500
	private readonly FILE_PROCESSING_CONCURRENCY_LIMIT = 10

	private readonly _onDidStartBatchProcessing = new vscode.EventEmitter<string[]>()
	private readonly _onBatchProgressUpdate = new vscode.EventEmitter<{
		processedInBatch: number
		totalInBatch: number
		currentFile?: string
	}>()
	private readonly _onDidFinishBatchProcessing = new vscode.EventEmitter<BatchProcessingSummary>()

	/**
	 * Event emitted when a batch of files begins processing
	 */
	public readonly onDidStartBatchProcessing = this._onDidStartBatchProcessing.event

	/**
	 * Event emitted to report progress during batch processing
	 */
	public readonly onBatchProgressUpdate = this._onBatchProgressUpdate.event

	/**
	 * Event emitted when a batch of files has finished processing
	 */
	public readonly onDidFinishBatchProcessing = this._onDidFinishBatchProcessing.event

	/**
	 * Creates a new file watcher
	 * @param workspacePath Path to the workspace
	 * @param context VS Code extension context
	 * @param embedder Optional embedder
	 * @param vectorStore Optional vector store
	 * @param cacheManager Cache manager
	 */
	constructor(
		private workspacePath: string,
		private context: vscode.ExtensionContext,
		private readonly cacheManager: CacheManager,
		private embedder?: IEmbedder,
		private vectorStore?: IVectorStore,
		ignoreInstance?: Ignore,
		ignoreController?: RooIgnoreController,
	) {
		this.ignoreController = ignoreController || new RooIgnoreController(workspacePath)
		if (ignoreInstance) {
			this.ignoreInstance = ignoreInstance
		}
	}

	/**
	 * Initializes the file watcher
	 */
	async initialize(): Promise<void> {
		// Create file watcher
		const filePattern = new vscode.RelativePattern(
			this.workspacePath,
			`**/*{${scannerExtensions.map((e) => e.substring(1)).join(",")}}`,
		)
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern)

		// Register event handlers
		this.fileWatcher.onDidCreate(this.handleFileCreated.bind(this))
		this.fileWatcher.onDidChange(this.handleFileChanged.bind(this))
		this.fileWatcher.onDidDelete(this.handleFileDeleted.bind(this))
	}

	/**
	 * Disposes the file watcher
	 */
	dispose(): void {
		this.fileWatcher?.dispose()
		if (this.batchProcessDebounceTimer) {
			clearTimeout(this.batchProcessDebounceTimer)
		}
		this._onDidStartBatchProcessing.dispose()
		this._onBatchProgressUpdate.dispose()
		this._onDidFinishBatchProcessing.dispose()
		this.accumulatedEvents.clear()
	}

	/**
	 * Handles file creation events
	 * @param uri URI of the created file
	 */
	private async handleFileCreated(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "create" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Handles file change events
	 * @param uri URI of the changed file
	 */
	private async handleFileChanged(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "change" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Handles file deletion events
	 * @param uri URI of the deleted file
	 */
	private async handleFileDeleted(uri: vscode.Uri): Promise<void> {
		this.accumulatedEvents.set(uri.fsPath, { uri, type: "delete" })
		this.scheduleBatchProcessing()
	}

	/**
	 * Schedules batch processing with debounce
	 */
	private scheduleBatchProcessing(): void {
		if (this.batchProcessDebounceTimer) {
			clearTimeout(this.batchProcessDebounceTimer)
		}
		this.batchProcessDebounceTimer = setTimeout(() => this.triggerBatchProcessing(), this.BATCH_DEBOUNCE_DELAY_MS)
	}

	/**
	 * Triggers processing of accumulated events
	 */
	private async triggerBatchProcessing(): Promise<void> {
		if (this.accumulatedEvents.size === 0) {
			return
		}

		const eventsToProcess = new Map(this.accumulatedEvents)
		this.accumulatedEvents.clear()

		const filePathsInBatch = Array.from(eventsToProcess.keys())
		this._onDidStartBatchProcessing.fire(filePathsInBatch)

		await this.processBatch(eventsToProcess)
	}

	/**
	 * Processes a batch of accumulated events
	 * @param eventsToProcess Map of events to process
	 */
	private async _handleBatchDeletions(
		batchResults: FileProcessingResult[],
		processedCountInBatch: number,
		totalFilesInBatch: number,
		pathsToExplicitlyDelete: string[],
		filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }>,
	): Promise<{ overallBatchError?: Error; clearedPaths: Set<string>; processedCount: number }> {
		let overallBatchError: Error | undefined
		const allPathsToClearFromDB = new Set<string>(pathsToExplicitlyDelete)

		for (const fileDetail of filesToUpsertDetails) {
			if (fileDetail.originalType === "change") {
				allPathsToClearFromDB.add(fileDetail.path)
			}
		}

		if (allPathsToClearFromDB.size > 0 && this.vectorStore) {
			try {
				await this.vectorStore.deletePointsByMultipleFilePaths(Array.from(allPathsToClearFromDB))

				for (const path of pathsToExplicitlyDelete) {
					this.cacheManager.deleteHash(path)
					batchResults.push({ path, status: "success" })
					processedCountInBatch++
					this._onBatchProgressUpdate.fire({
						processedInBatch: processedCountInBatch,
						totalInBatch: totalFilesInBatch,
						currentFile: path,
					})
				}
			} catch (error) {
				overallBatchError = error as Error
				for (const path of pathsToExplicitlyDelete) {
					batchResults.push({ path, status: "error", error: error as Error })
					processedCountInBatch++
					this._onBatchProgressUpdate.fire({
						processedInBatch: processedCountInBatch,
						totalInBatch: totalFilesInBatch,
						currentFile: path,
					})
				}
			}
		}

		return { overallBatchError, clearedPaths: allPathsToClearFromDB, processedCount: processedCountInBatch }
	}

	private async _processFilesAndPrepareUpserts(
		filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }>,
		batchResults: FileProcessingResult[],
		processedCountInBatch: number,
		totalFilesInBatch: number,
		pathsToExplicitlyDelete: string[],
	): Promise<{
		pointsForBatchUpsert: PointStruct[]
		successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>
		processedCount: number
	}> {
		const pointsForBatchUpsert: PointStruct[] = []
		const successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }> = []
		const filesToProcessConcurrently = [...filesToUpsertDetails]

		for (let i = 0; i < filesToProcessConcurrently.length; i += this.FILE_PROCESSING_CONCURRENCY_LIMIT) {
			const chunkToProcess = filesToProcessConcurrently.slice(i, i + this.FILE_PROCESSING_CONCURRENCY_LIMIT)

			const chunkProcessingPromises = chunkToProcess.map(async (fileDetail) => {
				this._onBatchProgressUpdate.fire({
					processedInBatch: processedCountInBatch,
					totalInBatch: totalFilesInBatch,
					currentFile: fileDetail.path,
				})
				try {
					const result = await this.processFile(fileDetail.path)
					return { path: fileDetail.path, result: result, error: undefined }
				} catch (e) {
					console.error(`[FileWatcher] Unhandled exception processing file ${fileDetail.path}:`, e)
					return { path: fileDetail.path, result: undefined, error: e as Error }
				}
			})

			const settledChunkResults = await Promise.allSettled(chunkProcessingPromises)

			for (const settledResult of settledChunkResults) {
				let resultPath: string | undefined

				if (settledResult.status === "fulfilled") {
					const { path, result, error: directError } = settledResult.value
					resultPath = path

					if (directError) {
						batchResults.push({ path, status: "error", error: directError })
					} else if (result) {
						if (result.status === "skipped" || result.status === "local_error") {
							batchResults.push(result)
						} else if (result.status === "processed_for_batching" && result.pointsToUpsert) {
							pointsForBatchUpsert.push(...result.pointsToUpsert)
							if (result.path && result.newHash) {
								successfullyProcessedForUpsert.push({ path: result.path, newHash: result.newHash })
							} else if (result.path && !result.newHash) {
								successfullyProcessedForUpsert.push({ path: result.path })
							}
						} else {
							batchResults.push({
								path,
								status: "error",
								error: new Error(
									`Unexpected result status from processFile: ${result.status} for file ${path}`,
								),
							})
						}
					} else {
						batchResults.push({
							path,
							status: "error",
							error: new Error(`Fulfilled promise with no result or error for file ${path}`),
						})
					}
				} else {
					console.error("[FileWatcher] A file processing promise was rejected:", settledResult.reason)
					batchResults.push({
						path: settledResult.reason?.path || "unknown",
						status: "error",
						error: settledResult.reason as Error,
					})
				}

				if (!pathsToExplicitlyDelete.includes(resultPath || "")) {
					processedCountInBatch++
				}
				this._onBatchProgressUpdate.fire({
					processedInBatch: processedCountInBatch,
					totalInBatch: totalFilesInBatch,
					currentFile: resultPath,
				})
			}
		}

		return { pointsForBatchUpsert, successfullyProcessedForUpsert, processedCount: processedCountInBatch }
	}

	private async _executeBatchUpsertOperations(
		pointsForBatchUpsert: PointStruct[],
		successfullyProcessedForUpsert: Array<{ path: string; newHash?: string }>,
		batchResults: FileProcessingResult[],
		overallBatchError?: Error,
	): Promise<Error | undefined> {
		if (pointsForBatchUpsert.length > 0 && this.vectorStore && !overallBatchError) {
			try {
				for (let i = 0; i < pointsForBatchUpsert.length; i += BATCH_SEGMENT_THRESHOLD) {
					const batch = pointsForBatchUpsert.slice(i, i + BATCH_SEGMENT_THRESHOLD)
					let retryCount = 0
					let upsertError: Error | undefined

					while (retryCount < MAX_BATCH_RETRIES) {
						try {
							await this.vectorStore.upsertPoints(batch)
							break
						} catch (error) {
							upsertError = error as Error
							retryCount++
							if (retryCount === MAX_BATCH_RETRIES) {
								throw new Error(
									`Failed to upsert batch after ${MAX_BATCH_RETRIES} retries: ${upsertError.message}`,
								)
							}
							await new Promise((resolve) =>
								setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1)),
							)
						}
					}
				}

				for (const { path, newHash } of successfullyProcessedForUpsert) {
					if (newHash) {
						this.cacheManager.updateHash(path, newHash)
					}
					batchResults.push({ path, status: "success" })
				}
			} catch (error) {
				overallBatchError = overallBatchError || (error as Error)
				for (const { path } of successfullyProcessedForUpsert) {
					batchResults.push({ path, status: "error", error: error as Error })
				}
			}
		} else if (overallBatchError && pointsForBatchUpsert.length > 0) {
			for (const { path } of successfullyProcessedForUpsert) {
				batchResults.push({ path, status: "error", error: overallBatchError })
			}
		}

		return overallBatchError
	}

	private async processBatch(
		eventsToProcess: Map<string, { uri: vscode.Uri; type: "create" | "change" | "delete" }>,
	): Promise<void> {
		const batchResults: FileProcessingResult[] = []
		let processedCountInBatch = 0
		const totalFilesInBatch = eventsToProcess.size
		let overallBatchError: Error | undefined

		// Initial progress update
		this._onBatchProgressUpdate.fire({
			processedInBatch: 0,
			totalInBatch: totalFilesInBatch,
			currentFile: undefined,
		})

		// Categorize events
		const pathsToExplicitlyDelete: string[] = []
		const filesToUpsertDetails: Array<{ path: string; uri: vscode.Uri; originalType: "create" | "change" }> = []

		for (const event of eventsToProcess.values()) {
			if (event.type === "delete") {
				pathsToExplicitlyDelete.push(event.uri.fsPath)
			} else {
				filesToUpsertDetails.push({
					path: event.uri.fsPath,
					uri: event.uri,
					originalType: event.type,
				})
			}
		}

		// Phase 1: Handle deletions
		const { overallBatchError: deletionError, processedCount: deletionCount } = await this._handleBatchDeletions(
			batchResults,
			processedCountInBatch,
			totalFilesInBatch,
			pathsToExplicitlyDelete,
			filesToUpsertDetails,
		)
		overallBatchError = deletionError
		processedCountInBatch = deletionCount

		// Phase 2: Process files and prepare upserts
		const {
			pointsForBatchUpsert,
			successfullyProcessedForUpsert,
			processedCount: upsertCount,
		} = await this._processFilesAndPrepareUpserts(
			filesToUpsertDetails,
			batchResults,
			processedCountInBatch,
			totalFilesInBatch,
			pathsToExplicitlyDelete,
		)
		processedCountInBatch = upsertCount

		// Phase 3: Execute batch upsert
		overallBatchError = await this._executeBatchUpsertOperations(
			pointsForBatchUpsert,
			successfullyProcessedForUpsert,
			batchResults,
			overallBatchError,
		)

		// Finalize
		this._onDidFinishBatchProcessing.fire({
			processedFiles: batchResults,
			batchError: overallBatchError,
		})
		this._onBatchProgressUpdate.fire({
			processedInBatch: totalFilesInBatch,
			totalInBatch: totalFilesInBatch,
		})

		if (this.accumulatedEvents.size === 0) {
			this._onBatchProgressUpdate.fire({
				processedInBatch: 0,
				totalInBatch: 0,
				currentFile: undefined,
			})
		}
	}

	/**
	 * Processes a file
	 * @param filePath Path to the file to process
	 * @returns Promise resolving to processing result
	 */
	async processFile(filePath: string): Promise<FileProcessingResult> {
		try {
			// Check if file is in an ignored directory
			if (isPathInIgnoredDirectory(filePath)) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is in an ignored directory",
				}
			}

			// Check if file should be ignored
			const relativeFilePath = generateRelativeFilePath(filePath)
			if (
				!this.ignoreController.validateAccess(filePath) ||
				(this.ignoreInstance && this.ignoreInstance.ignores(relativeFilePath))
			) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is ignored by .rooignore or .gitignore",
				}
			}

			// Check file size
			const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
			if (fileStat.size > MAX_FILE_SIZE_BYTES) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File is too large",
				}
			}

			// Read file content
			const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
			const content = fileContent.toString()

			// Calculate hash
			const newHash = createHash("sha256").update(content).digest("hex")

			// Check if file has changed
			if (this.cacheManager.getHash(filePath) === newHash) {
				return {
					path: filePath,
					status: "skipped" as const,
					reason: "File has not changed",
				}
			}

			// Parse file
			const blocks = await codeParser.parseFile(filePath, { content, fileHash: newHash })

			// Prepare points for batch processing
			let pointsToUpsert: PointStruct[] = []
			if (this.embedder && blocks.length > 0) {
				const texts = blocks.map((block) => block.content)
				const { embeddings } = await this.embedder.createEmbeddings(texts)

				pointsToUpsert = blocks.map((block, index) => {
					const normalizedAbsolutePath = generateNormalizedAbsolutePath(block.file_path)
					const stableName = `${normalizedAbsolutePath}:${block.start_line}`
					const pointId = uuidv5(stableName, QDRANT_CODE_BLOCK_NAMESPACE)

					return {
						id: pointId,
						vector: embeddings[index],
						payload: {
							filePath: generateRelativeFilePath(normalizedAbsolutePath),
							codeChunk: block.content,
							startLine: block.start_line,
							endLine: block.end_line,
						},
					}
				})
			}

			return {
				path: filePath,
				status: "processed_for_batching" as const,
				newHash,
				pointsToUpsert,
			}
		} catch (error) {
			return {
				path: filePath,
				status: "local_error" as const,
				error: error as Error,
			}
		}
	}
}
