import { telemetryService } from "../../services/telemetry"
import { getAllHooksDirs } from "../storage/disk"
import { HookFactory, Hooks } from "./hook-factory"

type HookName = keyof Hooks

/**
 * Cached hook discovery results
 */
interface HookCacheEntry {
	scriptPaths: string[] // Paths to hook scripts for this hook name
	timestamp: number // When this was last scanned
}

/**
 * Generic disposable interface for resource cleanup
 */
interface Disposable {
	dispose(): void
}

/**
 * Generic file watcher interface
 */
interface FileWatcher extends Disposable {
	onDidCreate(listener: () => void): void
	onDidChange(listener: () => void): void
	onDidDelete(listener: () => void): void
}

/**
 * Generic context interface for managing subscriptions
 */
interface ExtensionContext {
	subscriptions: Disposable[]
}

/**
 * Singleton cache for hook script discovery with lazy file system watching.
 *
 * Features:
 * - Lazy watcher initialization (only when directories are accessed)
 * - Per-directory caching
 * - Automatic invalidation on file changes
 * - Graceful error handling
 * - Optional debug logging
 */
export class HookDiscoveryCache {
	private static instance: HookDiscoveryCache | null = null

	// Cache: hookName -> discovered script paths
	private cache = new Map<HookName, HookCacheEntry>()

	// Watchers: directory path -> file watcher
	private watchers = new Map<string, FileWatcher>()

	// Directories we've tried to watch (even if watcher creation failed)
	private watchedDirs = new Set<string>()

	// Currently scanning promises (to prevent concurrent scans)
	private scanningPromises = new Map<HookName, Promise<string[]>>()

	// For disposal
	private context: ExtensionContext | null = null
	private createFileWatcher: ((dir: string) => FileWatcher | null) | null = null
	private disposed = false

	// Debug logging (enabled via DEBUG_HOOKS env var)
	private debug = process.env.DEBUG_HOOKS === "true"

	private constructor() {}

	static getInstance(): HookDiscoveryCache {
		if (!HookDiscoveryCache.instance) {
			HookDiscoveryCache.instance = new HookDiscoveryCache()
		}
		return HookDiscoveryCache.instance
	}

	/**
	 * Initialize with extension context for proper cleanup
	 */
	initialize(
		context: ExtensionContext,
		createFileWatcher?: (dir: string) => FileWatcher | null,
		onWorkspaceFoldersChanged?: (callback: () => void) => Disposable,
	): void {
		this.context = context
		this.createFileWatcher = createFileWatcher || null

		// Watch for workspace changes to invalidate cache (if callback provided)
		if (onWorkspaceFoldersChanged) {
			context.subscriptions.push(
				onWorkspaceFoldersChanged(() => {
					this.log("Workspace folders changed, invalidating cache")
					this.invalidateAll()
				}),
			)
		}
	}

	/**
	 * Get cached hook scripts or scan if not cached
	 */
	async get(hookName: HookName): Promise<string[]> {
		this.log(`Getting hooks for ${hookName}`)

		const cached = this.cache.get(hookName)
		const cacheHit = cached !== undefined

		let scripts: string[]
		let initiatedScan = false // Track if this caller initiated the scan

		if (cacheHit) {
			this.log(`Cache hit for ${hookName}: ${cached.scriptPaths.length} scripts`)
			scripts = cached.scriptPaths
		} else {
			this.log(`Cache miss for ${hookName}, scanning...`)

			// Check if scan is already in progress
			const existingPromise = this.scanningPromises.get(hookName)
			if (existingPromise) {
				// Another caller is already scanning, reuse their promise
				this.log(`Reusing existing scan for ${hookName}`)
				scripts = await existingPromise
			} else {
				// This caller initiates the scan
				initiatedScan = true
				scripts = await this.scan(hookName)
			}
		}

		// Only report telemetry if:
		// 1. It was a cache hit, OR
		// 2. This caller initiated the scan (not reusing another caller's promise)
		if (cacheHit || initiatedScan) {
			telemetryService.safeCapture(
				() => telemetryService.captureHookCacheAccess(hookName, cacheHit),
				"HookDiscoveryCache.get",
			)
		}

		return scripts
	}

	/**
	 * Scan for hook scripts and cache the result
	 */
	private async scan(hookName: HookName): Promise<string[]> {
		// Check if a scan is already in progress for this hook
		const existingPromise = this.scanningPromises.get(hookName)
		if (existingPromise) {
			this.log(`Already scanning ${hookName}, waiting for existing scan...`)
			return existingPromise
		}

		// Create a new scan promise
		const scanPromise = (async () => {
			try {
				// Get all current hooks directories
				const hooksDirs = await getAllHooksDirs()
				this.log(`Scanning ${hooksDirs.length} directories for ${hookName}`)

				// Ensure watchers are set up for each directory (lazy initialization)
				for (const dir of hooksDirs) {
					this.ensureWatcher(dir)
				}

				// Scan each directory for this hook
				const scriptPromises = hooksDirs.map((dir) => HookFactory.findHookInHooksDir(hookName, dir))

				const results = await Promise.all(scriptPromises)
				const scripts = results.filter((path): path is string => path !== undefined)

				this.log(`Found ${scripts.length} scripts for ${hookName}`)

				// Cache the result
				this.cache.set(hookName, {
					scriptPaths: scripts,
					timestamp: Date.now(),
				})

				return scripts
			} catch (error) {
				console.error(`Error scanning for ${hookName} hooks:`, error)
				// Return empty array on error - don't break the whole system
				return []
			} finally {
				// Remove from scanning promises map
				this.scanningPromises.delete(hookName)
			}
		})()

		// Store the promise so concurrent calls can await it
		this.scanningPromises.set(hookName, scanPromise)

		return scanPromise
	}

	/**
	 * Ensure a file watcher exists for the given directory
	 */
	private ensureWatcher(dir: string): void {
		// Skip if already watching or tried to watch
		if (this.watchedDirs.has(dir)) {
			return
		}

		this.watchedDirs.add(dir)

		if (!this.context) {
			this.log(`No context available, skipping watcher for ${dir}`)
			return
		}

		// If no watcher creation function provided, skip watching
		if (!this.createFileWatcher) {
			this.log(`No watcher creator available, skipping watcher for ${dir}`)
			return
		}

		try {
			// Create watcher using the provided function
			const watcher = this.createFileWatcher(dir)

			if (!watcher) {
				this.log(`Watcher creation returned null for ${dir}`)
				return
			}

			// Invalidate cache on any change
			const invalidate = () => {
				this.log(`File change detected in ${dir}, invalidating cache`)
				this.invalidateDirectory(dir)
			}

			watcher.onDidCreate(invalidate)
			watcher.onDidChange(invalidate)
			watcher.onDidDelete(invalidate)

			// Add to context subscriptions for proper cleanup
			if (this.context) {
				this.context.subscriptions.push(watcher)
			}
			this.watchers.set(dir, watcher)

			this.log(`Created watcher for ${dir}`)
		} catch (error) {
			// Log but don't fail - directory might not exist yet
			this.log(`Failed to create watcher for ${dir}: ${error}`)
		}
	}

	/**
	 * Invalidate all cached hooks that have scripts in this directory
	 */
	private invalidateDirectory(dir: string): void {
		let invalidated = 0

		for (const [hookName, entry] of this.cache) {
			if (entry.scriptPaths.some((scriptPath) => scriptPath.startsWith(dir))) {
				this.cache.delete(hookName)
				invalidated++
			}
		}

		this.log(`Invalidated ${invalidated} hooks for directory ${dir}`)
	}

	/**
	 * Invalidate entire cache
	 */
	invalidateAll(): void {
		const size = this.cache.size
		this.cache.clear()
		this.log(`Invalidated entire cache (${size} entries)`)
	}

	/**
	 * Get cache statistics (for debugging/monitoring)
	 */
	getStats() {
		return {
			cacheSize: this.cache.size,
			watcherCount: this.watchers.size,
			watchedDirs: this.watchedDirs.size,
		}
	}

	/**
	 * Log debug message if debug mode is enabled
	 */
	private log(message: string): void {
		if (this.debug) {
			console.log(`[HookCache] ${message}`)
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		if (this.disposed) {
			return
		}

		this.log(`Disposing cache (${this.watchers.size} watchers)`)

		for (const watcher of this.watchers.values()) {
			watcher.dispose()
		}

		this.watchers.clear()
		this.watchedDirs.clear()
		this.cache.clear()
		this.disposed = true
	}

	/**
	 * Reset singleton instance (for testing)
	 */
	static resetForTesting(): void {
		if (HookDiscoveryCache.instance) {
			HookDiscoveryCache.instance.dispose()
			HookDiscoveryCache.instance = null
		}
	}
}
