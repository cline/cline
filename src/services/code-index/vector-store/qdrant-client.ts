import { QdrantClient, Schemas } from "@qdrant/js-client-rest"
import { createHash } from "crypto"
import * as path from "path"
import { getWorkspacePath } from "../../../utils/path"
import { IVectorStore } from "../interfaces/vector-store"
import { Payload, VectorStoreSearchResult } from "../interfaces"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../constants"
import { t } from "../../../i18n"

/**
 * Qdrant implementation of the vector store interface
 */
export class QdrantVectorStore implements IVectorStore {
	private readonly vectorSize!: number
	private readonly DISTANCE_METRIC = "Cosine"

	private client: QdrantClient
	private readonly collectionName: string
	private readonly qdrantUrl: string = "http://localhost:6333"

	/**
	 * Creates a new Qdrant vector store
	 * @param workspacePath Path to the workspace
	 * @param url Optional URL to the Qdrant server
	 */
	constructor(workspacePath: string, url: string, vectorSize: number, apiKey?: string) {
		// Parse the URL to determine the appropriate QdrantClient configuration
		const parsedUrl = this.parseQdrantUrl(url)

		// Store the resolved URL for our property
		this.qdrantUrl = parsedUrl

		try {
			const urlObj = new URL(parsedUrl)

			// Always use host-based configuration with explicit ports to avoid QdrantClient defaults
			let port: number
			let useHttps: boolean

			if (urlObj.port) {
				// Explicit port specified - use it and determine protocol
				port = Number(urlObj.port)
				useHttps = urlObj.protocol === "https:"
			} else {
				// No explicit port - use protocol defaults
				if (urlObj.protocol === "https:") {
					port = 443
					useHttps = true
				} else {
					// http: or other protocols default to port 80
					port = 80
					useHttps = false
				}
			}

			this.client = new QdrantClient({
				host: urlObj.hostname,
				https: useHttps,
				port: port,
				prefix: urlObj.pathname === "/" ? undefined : urlObj.pathname.replace(/\/+$/, ""),
				apiKey,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
		} catch (urlError) {
			// If URL parsing fails, fall back to URL-based config
			// Note: This fallback won't correctly handle prefixes, but it's a last resort for malformed URLs.
			this.client = new QdrantClient({
				url: parsedUrl,
				apiKey,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
		}

		// Generate collection name from workspace path
		const hash = createHash("sha256").update(workspacePath).digest("hex")
		this.vectorSize = vectorSize
		this.collectionName = `ws-${hash.substring(0, 16)}`
	}

	/**
	 * Parses and normalizes Qdrant server URLs to handle various input formats
	 * @param url Raw URL input from user
	 * @returns Properly formatted URL for QdrantClient
	 */
	private parseQdrantUrl(url: string | undefined): string {
		// Handle undefined/null/empty cases
		if (!url || url.trim() === "") {
			return "http://localhost:6333"
		}

		const trimmedUrl = url.trim()

		// Check if it starts with a protocol
		if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://") && !trimmedUrl.includes("://")) {
			// No protocol - treat as hostname
			return this.parseHostname(trimmedUrl)
		}

		try {
			// Attempt to parse as complete URL - return as-is, let constructor handle ports
			const parsedUrl = new URL(trimmedUrl)
			return trimmedUrl
		} catch {
			// Failed to parse as URL - treat as hostname
			return this.parseHostname(trimmedUrl)
		}
	}

	/**
	 * Handles hostname-only inputs
	 * @param hostname Raw hostname input
	 * @returns Properly formatted URL with http:// prefix
	 */
	private parseHostname(hostname: string): string {
		if (hostname.includes(":")) {
			// Has port - add http:// prefix if missing
			return hostname.startsWith("http") ? hostname : `http://${hostname}`
		} else {
			// No port - add http:// prefix without port (let constructor handle port assignment)
			return `http://${hostname}`
		}
	}

	private async getCollectionInfo(): Promise<Schemas["CollectionInfo"] | null> {
		try {
			const collectionInfo = await this.client.getCollection(this.collectionName)
			return collectionInfo
		} catch (error: unknown) {
			if (error instanceof Error) {
				console.warn(
					`[QdrantVectorStore] Warning during getCollectionInfo for "${this.collectionName}". Collection may not exist or another error occurred:`,
					error.message,
				)
			}
			return null
		}
	}

	/**
	 * Initializes the vector store
	 * @returns Promise resolving to boolean indicating if a new collection was created
	 */
	async initialize(): Promise<boolean> {
		let created = false
		try {
			const collectionInfo = await this.getCollectionInfo()

			if (collectionInfo === null) {
				// Collection info not retrieved (assume not found or inaccessible), create it
				await this.client.createCollection(this.collectionName, {
					vectors: {
						size: this.vectorSize,
						distance: this.DISTANCE_METRIC,
					},
				})
				created = true
			} else {
				// Collection exists, check vector size
				const existingVectorSize = collectionInfo.config?.params?.vectors?.size
				if (existingVectorSize === this.vectorSize) {
					created = false // Exists and correct
				} else {
					// Exists but wrong vector size, recreate
					try {
						console.warn(
							`[QdrantVectorStore] Collection ${this.collectionName} exists with vector size ${existingVectorSize}, but expected ${this.vectorSize}. Recreating collection.`,
						)
						await this.client.deleteCollection(this.collectionName)
						await this.client.createCollection(this.collectionName, {
							vectors: {
								size: this.vectorSize,
								distance: this.DISTANCE_METRIC,
							},
						})
						created = true
					} catch (recreationError) {
						const errorMessage =
							recreationError instanceof Error ? recreationError.message : String(recreationError)
						console.error(
							`[QdrantVectorStore] CRITICAL: Failed to recreate collection ${this.collectionName} for new vector size. Error: ${errorMessage}`,
						)
						const dimensionMismatchError = new Error(
							t("embeddings:vectorStore.vectorDimensionMismatch", {
								errorMessage,
							}),
						)
						// Use error.cause to preserve the original error context
						dimensionMismatchError.cause = recreationError
						throw dimensionMismatchError
					}
				}
			}

			// Create payload indexes
			for (let i = 0; i <= 4; i++) {
				try {
					await this.client.createPayloadIndex(this.collectionName, {
						field_name: `pathSegments.${i}`,
						field_schema: "keyword",
					})
				} catch (indexError: any) {
					const errorMessage = (indexError?.message || "").toLowerCase()
					if (!errorMessage.includes("already exists")) {
						console.warn(
							`[QdrantVectorStore] Could not create payload index for pathSegments.${i} on ${this.collectionName}. Details:`,
							indexError?.message || indexError,
						)
					}
				}
			}
			return created
		} catch (error: any) {
			const errorMessage = error?.message || error
			console.error(
				`[QdrantVectorStore] Failed to initialize Qdrant collection "${this.collectionName}":`,
				errorMessage,
			)

			// If this is already a vector dimension mismatch error (identified by cause), re-throw it as-is
			if (error instanceof Error && error.cause !== undefined) {
				throw error
			}

			// Otherwise, provide a more user-friendly error message that includes the original error
			throw new Error(
				t("embeddings:vectorStore.qdrantConnectionFailed", { qdrantUrl: this.qdrantUrl, errorMessage }),
			)
		}
	}

	/**
	 * Upserts points into the vector store
	 * @param points Array of points to upsert
	 */
	async upsertPoints(
		points: Array<{
			id: string
			vector: number[]
			payload: Record<string, any>
		}>,
	): Promise<void> {
		try {
			const processedPoints = points.map((point) => {
				if (point.payload?.filePath) {
					const segments = point.payload.filePath.split(path.sep).filter(Boolean)
					const pathSegments = segments.reduce(
						(acc: Record<string, string>, segment: string, index: number) => {
							acc[index.toString()] = segment
							return acc
						},
						{},
					)
					return {
						...point,
						payload: {
							...point.payload,
							pathSegments,
						},
					}
				}
				return point
			})

			await this.client.upsert(this.collectionName, {
				points: processedPoints,
				wait: true,
			})
		} catch (error) {
			console.error("Failed to upsert points:", error)
			throw error
		}
	}

	/**
	 * Checks if a payload is valid
	 * @param payload Payload to check
	 * @returns Boolean indicating if the payload is valid
	 */
	private isPayloadValid(payload: Record<string, unknown> | null | undefined): payload is Payload {
		if (!payload) {
			return false
		}
		const validKeys = ["filePath", "codeChunk", "startLine", "endLine"]
		const hasValidKeys = validKeys.every((key) => key in payload)
		return hasValidKeys
	}

	/**
	 * Searches for similar vectors
	 * @param queryVector Vector to search for
	 * @param directoryPrefix Optional directory prefix to filter results
	 * @param minScore Optional minimum score threshold
	 * @param maxResults Optional maximum number of results to return
	 * @returns Promise resolving to search results
	 */
	async search(
		queryVector: number[],
		directoryPrefix?: string,
		minScore?: number,
		maxResults?: number,
	): Promise<VectorStoreSearchResult[]> {
		try {
			let filter = undefined

			if (directoryPrefix) {
				const segments = directoryPrefix.split(path.sep).filter(Boolean)

				filter = {
					must: segments.map((segment, index) => ({
						key: `pathSegments.${index}`,
						match: { value: segment },
					})),
				}
			}

			const searchRequest = {
				query: queryVector,
				filter,
				score_threshold: minScore ?? DEFAULT_SEARCH_MIN_SCORE,
				limit: maxResults ?? DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			}

			const operationResult = await this.client.query(this.collectionName, searchRequest)
			const filteredPoints = operationResult.points.filter((p) => this.isPayloadValid(p.payload))

			return filteredPoints as VectorStoreSearchResult[]
		} catch (error) {
			console.error("Failed to search points:", error)
			throw error
		}
	}

	/**
	 * Deletes points by file path
	 * @param filePath Path of the file to delete points for
	 */
	async deletePointsByFilePath(filePath: string): Promise<void> {
		return this.deletePointsByMultipleFilePaths([filePath])
	}

	async deletePointsByMultipleFilePaths(filePaths: string[]): Promise<void> {
		if (filePaths.length === 0) {
			return
		}

		try {
			const workspaceRoot = getWorkspacePath()
			const normalizedPaths = filePaths.map((filePath) => {
				const absolutePath = path.resolve(workspaceRoot, filePath)
				return path.normalize(absolutePath)
			})

			const filter = {
				should: normalizedPaths.map((normalizedPath) => ({
					key: "filePath",
					match: {
						value: normalizedPath,
					},
				})),
			}

			await this.client.delete(this.collectionName, {
				filter,
				wait: true,
			})
		} catch (error) {
			console.error("Failed to delete points by file paths:", error)
			throw error
		}
	}

	/**
	 * Deletes the entire collection.
	 */
	async deleteCollection(): Promise<void> {
		try {
			// Check if collection exists before attempting deletion to avoid errors
			if (await this.collectionExists()) {
				await this.client.deleteCollection(this.collectionName)
			}
		} catch (error) {
			console.error(`[QdrantVectorStore] Failed to delete collection ${this.collectionName}:`, error)
			throw error // Re-throw to allow calling code to handle it
		}
	}

	/**
	 * Clears all points from the collection
	 */
	async clearCollection(): Promise<void> {
		try {
			await this.client.delete(this.collectionName, {
				filter: {
					must: [],
				},
				wait: true,
			})
		} catch (error) {
			console.error("Failed to clear collection:", error)
			throw error
		}
	}

	/**
	 * Checks if the collection exists
	 * @returns Promise resolving to boolean indicating if the collection exists
	 */
	async collectionExists(): Promise<boolean> {
		const collectionInfo = await this.getCollectionInfo()
		return collectionInfo !== null
	}
}
