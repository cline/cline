import { listFiles } from "../../glob/list-files"
import { Ignore } from "ignore"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { stat } from "fs/promises"
import * as path from "path"
import { generateNormalizedAbsolutePath, generateRelativeFilePath } from "../shared/get-relative-path"
import { scannerExtensions } from "../shared/supported-extensions"
import * as vscode from "vscode"
import { CodeBlock, ICodeParser, IEmbedder, IVectorStore, IDirectoryScanner } from "../interfaces"
import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"
import pLimit from "p-limit"
import { Mutex } from "async-mutex"
import { CacheManager } from "../cache-manager"
import {
	QDRANT_CODE_BLOCK_NAMESPACE,
	MAX_FILE_SIZE_BYTES,
	MAX_LIST_FILES_LIMIT,
	BATCH_SEGMENT_THRESHOLD,
	MAX_BATCH_RETRIES,
	INITIAL_RETRY_DELAY_MS,
	PARSING_CONCURRENCY,
	BATCH_PROCESSING_CONCURRENCY,
} from "../constants"

export class DirectoryScanner implements IDirectoryScanner {
	constructor(
		private readonly embedder: IEmbedder,
		private readonly qdrantClient: IVectorStore,
		private readonly codeParser: ICodeParser,
		private readonly cacheManager: CacheManager,
		private readonly ignoreInstance: Ignore,
	) {}

	/**
	 * Recursively scans a directory for code blocks in supported files.
	 * @param directoryPath The directory to scan
	 * @param rooIgnoreController Optional RooIgnoreController instance for filtering
	 * @param context VS Code ExtensionContext for cache storage
	 * @param onError Optional error handler callback
	 * @returns Promise<{codeBlocks: CodeBlock[], stats: {processed: number, skipped: number}}> Array of parsed code blocks and processing stats
	 */
	public async scanDirectory(
		directory: string,
		onError?: (error: Error) => void,
		onBlocksIndexed?: (indexedCount: number) => void,
		onFileParsed?: (fileBlockCount: number) => void,
	): Promise<{ codeBlocks: CodeBlock[]; stats: { processed: number; skipped: number }; totalBlockCount: number }> {
		const directoryPath = directory
		// Get all files recursively (handles .gitignore automatically)
		const [allPaths, _] = await listFiles(directoryPath, true, MAX_LIST_FILES_LIMIT)

		// Filter out directories (marked with trailing '/')
		const filePaths = allPaths.filter((p) => !p.endsWith("/"))

		// Initialize RooIgnoreController if not provided
		const ignoreController = new RooIgnoreController(directoryPath)

		await ignoreController.initialize()

		// Filter paths using .rooignore
		const allowedPaths = ignoreController.filterPaths(filePaths)

		// Filter by supported extensions and ignore patterns
		const supportedPaths = allowedPaths.filter((filePath) => {
			const ext = path.extname(filePath).toLowerCase()
			const relativeFilePath = generateRelativeFilePath(filePath)
			return scannerExtensions.includes(ext) && !this.ignoreInstance.ignores(relativeFilePath)
		})

		// Initialize tracking variables
		const processedFiles = new Set<string>()
		const codeBlocks: CodeBlock[] = []
		let processedCount = 0
		let skippedCount = 0

		// Initialize parallel processing tools
		const parseLimiter = pLimit(PARSING_CONCURRENCY) // Concurrency for file parsing
		const batchLimiter = pLimit(BATCH_PROCESSING_CONCURRENCY) // Concurrency for batch processing
		const mutex = new Mutex()

		// Shared batch accumulators (protected by mutex)
		let currentBatchBlocks: CodeBlock[] = []
		let currentBatchTexts: string[] = []
		let currentBatchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[] = []
		const activeBatchPromises: Promise<void>[] = []

		// Initialize block counter
		let totalBlockCount = 0

		// Process all files in parallel with concurrency control
		const parsePromises = supportedPaths.map((filePath) =>
			parseLimiter(async () => {
				try {
					// Check file size
					const stats = await stat(filePath)
					if (stats.size > MAX_FILE_SIZE_BYTES) {
						skippedCount++ // Skip large files
						return
					}

					// Read file content
					const content = await vscode.workspace.fs
						.readFile(vscode.Uri.file(filePath))
						.then((buffer) => Buffer.from(buffer).toString("utf-8"))

					// Calculate current hash
					const currentFileHash = createHash("sha256").update(content).digest("hex")
					processedFiles.add(filePath)

					// Check against cache
					const cachedFileHash = this.cacheManager.getHash(filePath)
					if (cachedFileHash === currentFileHash) {
						// File is unchanged
						skippedCount++
						return
					}

					// File is new or changed - parse it using the injected parser function
					const blocks = await this.codeParser.parseFile(filePath, { content, fileHash: currentFileHash })
					const fileBlockCount = blocks.length
					onFileParsed?.(fileBlockCount)
					codeBlocks.push(...blocks)
					processedCount++

					// Process embeddings if configured
					if (this.embedder && this.qdrantClient && blocks.length > 0) {
						// Add to batch accumulators
						let addedBlocksFromFile = false
						for (const block of blocks) {
							const trimmedContent = block.content.trim()
							if (trimmedContent) {
								const release = await mutex.acquire()
								totalBlockCount += fileBlockCount
								try {
									currentBatchBlocks.push(block)
									currentBatchTexts.push(trimmedContent)
									addedBlocksFromFile = true

									if (addedBlocksFromFile) {
										currentBatchFileInfos.push({
											filePath,
											fileHash: currentFileHash,
											isNew: !this.cacheManager.getHash(filePath),
										})
									}

									// Check if batch threshold is met
									if (currentBatchBlocks.length >= BATCH_SEGMENT_THRESHOLD) {
										// Copy current batch data and clear accumulators
										const batchBlocks = [...currentBatchBlocks]
										const batchTexts = [...currentBatchTexts]
										const batchFileInfos = [...currentBatchFileInfos]
										currentBatchBlocks = []
										currentBatchTexts = []
										currentBatchFileInfos = []

										// Queue batch processing
										const batchPromise = batchLimiter(() =>
											this.processBatch(
												batchBlocks,
												batchTexts,
												batchFileInfos,
												onError,
												onBlocksIndexed,
											),
										)
										activeBatchPromises.push(batchPromise)
									}
								} finally {
									release()
								}
							}
						}
					} else {
						// Only update hash if not being processed in a batch
						await this.cacheManager.updateHash(filePath, currentFileHash)
					}
				} catch (error) {
					console.error(`Error processing file ${filePath}:`, error)
					if (onError) {
						onError(error instanceof Error ? error : new Error(`Unknown error processing file ${filePath}`))
					}
				}
			}),
		)

		// Wait for all parsing to complete
		await Promise.all(parsePromises)

		// Process any remaining items in batch
		if (currentBatchBlocks.length > 0) {
			const release = await mutex.acquire()
			try {
				// Copy current batch data and clear accumulators
				const batchBlocks = [...currentBatchBlocks]
				const batchTexts = [...currentBatchTexts]
				const batchFileInfos = [...currentBatchFileInfos]
				currentBatchBlocks = []
				currentBatchTexts = []
				currentBatchFileInfos = []

				// Queue final batch processing
				const batchPromise = batchLimiter(() =>
					this.processBatch(batchBlocks, batchTexts, batchFileInfos, onError, onBlocksIndexed),
				)
				activeBatchPromises.push(batchPromise)
			} finally {
				release()
			}
		}

		// Wait for all batch processing to complete
		await Promise.all(activeBatchPromises)

		// Handle deleted files
		const oldHashes = this.cacheManager.getAllHashes()
		for (const cachedFilePath of Object.keys(oldHashes)) {
			if (!processedFiles.has(cachedFilePath)) {
				// File was deleted or is no longer supported/indexed
				if (this.qdrantClient) {
					try {
						await this.qdrantClient.deletePointsByFilePath(cachedFilePath)
						await this.cacheManager.deleteHash(cachedFilePath)
					} catch (error) {
						console.error(`[DirectoryScanner] Failed to delete points for ${cachedFilePath}:`, error)
						if (onError) {
							onError(
								error instanceof Error
									? error
									: new Error(`Unknown error deleting points for ${cachedFilePath}`),
							)
						}
						// Decide if we should re-throw or just log
					}
				}
			}
		}

		return {
			codeBlocks,
			stats: {
				processed: processedCount,
				skipped: skippedCount,
			},
			totalBlockCount,
		}
	}

	private async processBatch(
		batchBlocks: CodeBlock[],
		batchTexts: string[],
		batchFileInfos: { filePath: string; fileHash: string; isNew: boolean }[],
		onError?: (error: Error) => void,
		onBlocksIndexed?: (indexedCount: number) => void,
	): Promise<void> {
		if (batchBlocks.length === 0) return

		let attempts = 0
		let success = false
		let lastError: Error | null = null

		while (attempts < MAX_BATCH_RETRIES && !success) {
			attempts++
			try {
				// --- Deletion Step ---
				const uniqueFilePaths = [
					...new Set(
						batchFileInfos
							.filter((info) => !info.isNew) // Only modified files (not new)
							.map((info) => info.filePath),
					),
				]
				if (uniqueFilePaths.length > 0) {
					try {
						await this.qdrantClient.deletePointsByMultipleFilePaths(uniqueFilePaths)
					} catch (deleteError) {
						console.error(
							`[DirectoryScanner] Failed to delete points for ${uniqueFilePaths.length} files before upsert:`,
							deleteError,
						)
						// Re-throw the error to stop processing this batch attempt
						throw deleteError
					}
				}
				// --- End Deletion Step ---

				// Create embeddings for batch
				const { embeddings } = await this.embedder.createEmbeddings(batchTexts)

				// Prepare points for Qdrant
				const points = batchBlocks.map((block, index) => {
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

				// Upsert points to Qdrant
				await this.qdrantClient.upsertPoints(points)
				onBlocksIndexed?.(batchBlocks.length)

				// Update hashes for successfully processed files in this batch
				for (const fileInfo of batchFileInfos) {
					await this.cacheManager.updateHash(fileInfo.filePath, fileInfo.fileHash)
				}
				success = true
			} catch (error) {
				lastError = error as Error
				console.error(`[DirectoryScanner] Error processing batch (attempt ${attempts}):`, error)

				if (attempts < MAX_BATCH_RETRIES) {
					const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempts - 1)
					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		if (!success && lastError) {
			console.error(`[DirectoryScanner] Failed to process batch after ${MAX_BATCH_RETRIES} attempts`)
			if (onError) {
				onError(new Error(`Failed to process batch after ${MAX_BATCH_RETRIES} attempts: ${lastError.message}`))
			}
		}
	}
}
