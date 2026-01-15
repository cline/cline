import { getUtcTimestamp } from "../services/worker/utils"
import { getStorageAdapter, StorageAdapter } from "./adapters"
import { ClineStorage } from "./ClineStorage"

/**
 * S3/R2 blob storage implementation of ClineStorage.
 * Uses AWS S3 or Cloudflare R2 as the backend storage.
 */
export class ClineBlobStorage extends ClineStorage {
	override name = "ClineBlobStorage"

	private static store: ClineBlobStorage | null = null
	static get instance(): ClineBlobStorage {
		if (!ClineBlobStorage.store) {
			ClineBlobStorage.store = new ClineBlobStorage()
		}
		return ClineBlobStorage.store
	}

	private adapter: StorageAdapter | undefined
	private initialized = false
	private initializationAttempted = false

	/**
	 * Initialize the storage adapter. Safe to call multiple times.
	 * Will not block if configuration is missing or invalid.
	 */
	public init() {
		// Only attempt initialization once
		if (this.initializationAttempted) {
			return
		}
		this.initializationAttempted = true

		try {
			if (!ClineBlobStorage.isConfigured()) {
				// Not configured - this is expected and not an error
				return
			}
			const adapterType = process.env.CLINE_STORAGE_ADAPTER || ""
			const adapter = getStorageAdapter(adapterType)
			if (adapter) {
				this.adapter = adapter
				this.initialized = true

				console.log("[ClineBlobStorage] Adapter created")
			}
		} catch (error) {
			// Log but don't throw - allow startup to continue
			console.error("[ClineBlobStorage] initialization failed:", error)
		}
	}

	/**
	 * Check if the storage is properly initialized and ready to use.
	 */
	public isReady(): boolean {
		return this.initialized && this.adapter !== undefined
	}

	public static isConfigured(): boolean {
		const adapter = process.env.CLINE_STORAGE_ADAPTER
		if (adapter !== "s3" && adapter !== "r2") {
			return false
		}

		const hasRequiredVars =
			!!process.env.CLINE_STORAGE_BUCKET &&
			!!process.env.CLINE_STORAGE_ACCESS_KEY_ID &&
			!!process.env.CLINE_STORAGE_SECRET_ACCESS_KEY

		if (adapter === "r2") {
			return hasRequiredVars && !!process.env.CLINE_STORAGE_ACCOUNT_ID
		}

		return hasRequiredVars
	}

	private resolvePath(key: string): string {
		return `${getUtcTimestamp()}_${key}`
	}

	protected async _get(key: string): Promise<string | undefined> {
		if (!this.isReady()) {
			return undefined
		}
		try {
			return await this.adapter!.read(this.resolvePath(key))
		} catch (error) {
			console.error(`[ClineBlobStorage] failed to get '${key}':`, error)
			return undefined
		}
	}

	protected async _store(key: string, value: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		try {
			console.log(`[ClineBlobStorage] storing '${key}'`)
			await this.adapter!.write(key, value)
		} catch (error) {
			console.error(`[ClineBlobStorage] failed to store '${key}':`, error)
			throw error
		}
	}

	protected async _delete(key: string): Promise<void> {
		if (!this.isReady()) {
			// Silently fail if not configured - this is expected behavior
			return
		}
		try {
			await this.adapter!.remove(this.resolvePath(key))
		} catch (error) {
			console.error(`[ClineBlobStorage] failed to delete '${key}':`, error)
			throw error
		}
	}
}

/**
 * Get the blob storage instance if S3/R2 storage is configured.
 * Returns null if not configured.
 */
export const blobStorage = ClineBlobStorage.instance
