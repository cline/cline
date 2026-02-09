/**
 * DAG File Watcher - Watches for file changes and triggers incremental DAG analysis.
 *
 * Uses VS Code's FileSystemWatcher to detect changes in supported file types
 * and debounces updates to avoid excessive re-analysis.
 */

import type { BeadsmithIgnoreController } from "@core/ignore/BeadsmithIgnoreController"
import { Logger } from "@shared/services/Logger"
import * as vscode from "vscode"
import type { DagBridge } from "./DagBridge"

/**
 * Supported file extensions for DAG analysis.
 */
const SUPPORTED_EXTENSIONS = [
	".py", // Python
	".ts", // TypeScript
	".tsx", // TypeScript React
	".js", // JavaScript
	".jsx", // JavaScript React
	".mjs", // ES Modules
	".cjs", // CommonJS
]

/**
 * Configuration options for the file watcher.
 */
export interface DagFileWatcherOptions {
	/** Debounce delay in milliseconds (default: 1000) */
	debounceMs?: number
	/** Whether to auto-analyse on file changes (default: true) */
	autoAnalyse?: boolean
	/** Glob patterns to exclude (default: node_modules, .git, etc.) */
	excludePatterns?: string[]
	/** Optional BeadsmithIgnoreController for .beadsmithignore integration */
	ignoreController?: BeadsmithIgnoreController
}

/**
 * Events emitted by the file watcher.
 */
export interface DagFileWatcherEvents {
	fileChanged: (filePath: string) => void
	fileCreated: (filePath: string) => void
	fileDeleted: (filePath: string) => void
	analysisTriggered: (changedFiles: string[], deletedFiles: string[]) => void
	analysisCompleted: () => void
	analysisError: (error: Error) => void
}

/**
 * Watches for file changes and triggers incremental DAG analysis.
 */
export class DagFileWatcher {
	private watchers: vscode.FileSystemWatcher[] = []
	private dagBridge: DagBridge
	private workspaceRoot: string

	private readonly debounceMs: number
	private readonly autoAnalyse: boolean
	private readonly excludePatterns: string[]
	private readonly ignoreController?: BeadsmithIgnoreController

	private pendingChanges = new Set<string>()
	private pendingDeletions = new Set<string>()
	private debounceTimer: NodeJS.Timeout | null = null
	private isAnalysing = false
	private isDisposed = false

	private readonly eventHandlers: Partial<DagFileWatcherEvents> = {}

	constructor(dagBridge: DagBridge, workspaceRoot: string, options?: DagFileWatcherOptions) {
		this.dagBridge = dagBridge
		this.workspaceRoot = workspaceRoot
		this.debounceMs = options?.debounceMs ?? 1000
		this.autoAnalyse = options?.autoAnalyse ?? true
		this.excludePatterns = options?.excludePatterns ?? [
			"**/node_modules/**",
			"**/.git/**",
			"**/dist/**",
			"**/build/**",
			"**/__pycache__/**",
			"**/*.pyc",
			"**/venv/**",
			"**/.venv/**",
		]
		this.ignoreController = options?.ignoreController
	}

	/**
	 * Start watching for file changes.
	 */
	start(): void {
		if (this.watchers.length > 0) {
			Logger.warn("[DAG File Watcher] Already watching, ignoring start request")
			return
		}

		Logger.info(`[DAG File Watcher] Starting file watcher for ${this.workspaceRoot}`)

		// Create watchers for each supported extension
		for (const ext of SUPPORTED_EXTENSIONS) {
			const pattern = new vscode.RelativePattern(this.workspaceRoot, `**/*${ext}`)
			// biome-ignore lint/plugin/noVscodeApis: File watching is inherently VS Code-specific
			const watcher = vscode.workspace.createFileSystemWatcher(pattern)

			watcher.onDidCreate((uri) => this.handleFileCreated(uri))
			watcher.onDidChange((uri) => this.handleFileChanged(uri))
			watcher.onDidDelete((uri) => this.handleFileDeleted(uri))

			this.watchers.push(watcher)
		}

		Logger.info(`[DAG File Watcher] Created ${this.watchers.length} watchers`)
	}

	/**
	 * Stop watching for file changes.
	 */
	stop(): void {
		Logger.info("[DAG File Watcher] Stopping file watcher")

		// Cancel any pending analysis
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}

		// Dispose all watchers
		for (const watcher of this.watchers) {
			watcher.dispose()
		}
		this.watchers = []

		// Clear pending changes
		this.pendingChanges.clear()
		this.pendingDeletions.clear()
	}

	/**
	 * Dispose the file watcher.
	 */
	dispose(): void {
		this.isDisposed = true
		this.stop()
	}

	/**
	 * Register an event handler.
	 */
	on<K extends keyof DagFileWatcherEvents>(event: K, handler: DagFileWatcherEvents[K]): void {
		this.eventHandlers[event] = handler
	}

	/**
	 * Get the number of pending changes.
	 */
	getPendingChangeCount(): number {
		return this.pendingChanges.size + this.pendingDeletions.size
	}

	/**
	 * Get whether analysis is currently in progress.
	 */
	isAnalysisInProgress(): boolean {
		return this.isAnalysing
	}

	/**
	 * Force immediate analysis of pending changes.
	 */
	async flushPendingChanges(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		await this.triggerAnalysis()
	}

	/**
	 * Handle a file creation event.
	 */
	private handleFileCreated(uri: vscode.Uri): void {
		const filePath = uri.fsPath

		if (this.shouldIgnoreFile(filePath)) {
			return
		}

		Logger.debug(`[DAG File Watcher] File created: ${filePath}`)
		this.emit("fileCreated", filePath)

		this.pendingChanges.add(filePath)
		this.pendingDeletions.delete(filePath) // In case it was previously deleted
		this.scheduleAnalysis()
	}

	/**
	 * Handle a file change event.
	 */
	private handleFileChanged(uri: vscode.Uri): void {
		const filePath = uri.fsPath

		if (this.shouldIgnoreFile(filePath)) {
			return
		}

		Logger.debug(`[DAG File Watcher] File changed: ${filePath}`)
		this.emit("fileChanged", filePath)

		this.pendingChanges.add(filePath)
		this.scheduleAnalysis()
	}

	/**
	 * Handle a file deletion event.
	 */
	private handleFileDeleted(uri: vscode.Uri): void {
		const filePath = uri.fsPath

		if (this.shouldIgnoreFile(filePath)) {
			return
		}

		Logger.debug(`[DAG File Watcher] File deleted: ${filePath}`)
		this.emit("fileDeleted", filePath)

		this.pendingDeletions.add(filePath)
		this.pendingChanges.delete(filePath) // Remove from changes if it was pending
		this.scheduleAnalysis()
	}

	/**
	 * Check if a file should be ignored based on exclude patterns and .beadsmithignore.
	 */
	private shouldIgnoreFile(filePath: string): boolean {
		// Normalize path for comparison
		const normalizedPath = filePath.replace(/\\/g, "/")

		// Check glob exclude patterns first (fast path)
		for (const pattern of this.excludePatterns) {
			// Simple glob matching (handles ** and *)
			const regex = this.globToRegex(pattern)
			if (regex.test(normalizedPath)) {
				return true
			}
		}

		// Check .beadsmithignore if controller is available
		if (this.ignoreController) {
			// validateAccess returns true if file is accessible (not ignored)
			// So we return true (should ignore) if validateAccess returns false
			if (!this.ignoreController.validateAccess(filePath)) {
				return true
			}
		}

		return false
	}

	/**
	 * Convert a glob pattern to a regular expression.
	 */
	private globToRegex(glob: string): RegExp {
		const escaped = glob
			.replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
			.replace(/\*\*/g, "{{DOUBLE_STAR}}") // Placeholder for **
			.replace(/\*/g, "[^/]*") // * matches anything except /
			.replace(/{{DOUBLE_STAR}}/g, ".*") // ** matches anything including /

		return new RegExp(escaped)
	}

	/**
	 * Schedule analysis after debounce delay.
	 */
	private scheduleAnalysis(): void {
		if (!this.autoAnalyse || this.isDisposed) {
			return
		}

		// Clear existing timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}

		// Schedule new analysis
		this.debounceTimer = setTimeout(() => {
			void this.triggerAnalysis()
		}, this.debounceMs)
	}

	/**
	 * Trigger incremental analysis.
	 */
	private async triggerAnalysis(): Promise<void> {
		if (this.isDisposed || this.isAnalysing) {
			return
		}

		const changedFiles = Array.from(this.pendingChanges)
		const deletedFiles = Array.from(this.pendingDeletions)

		if (changedFiles.length === 0 && deletedFiles.length === 0) {
			return
		}

		// Clear pending changes
		this.pendingChanges.clear()
		this.pendingDeletions.clear()

		Logger.info(
			`[DAG File Watcher] Triggering analysis for ${changedFiles.length} changed, ${deletedFiles.length} deleted files`,
		)
		this.emit("analysisTriggered", changedFiles, deletedFiles)

		this.isAnalysing = true

		try {
			// Check if DAG bridge is running
			if (!this.dagBridge.isRunning()) {
				Logger.warn("[DAG File Watcher] DAG bridge not running, skipping analysis")
				// Re-add files to pending for when bridge is ready
				for (const file of changedFiles) {
					this.pendingChanges.add(file)
				}
				for (const file of deletedFiles) {
					this.pendingDeletions.add(file)
				}
				return
			}

			// Invalidate changed files
			for (const file of changedFiles) {
				await this.dagBridge.invalidateFile(file)
			}

			// Invalidate deleted files
			for (const file of deletedFiles) {
				await this.dagBridge.invalidateFile(file)
			}

			// Re-analyse the affected files
			for (const file of changedFiles) {
				await this.dagBridge.analyseFile(file)
			}

			Logger.info("[DAG File Watcher] Analysis completed")
			this.emit("analysisCompleted")
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			Logger.error("[DAG File Watcher] Analysis failed:", error)
			this.emit("analysisError", err)
		} finally {
			this.isAnalysing = false
		}
	}

	/**
	 * Emit an event.
	 */
	private emit<K extends keyof DagFileWatcherEvents>(event: K, ...args: Parameters<DagFileWatcherEvents[K]>): void {
		const handler = this.eventHandlers[event]
		if (handler) {
			// biome-ignore lint/suspicious/noExplicitAny: Event handler types vary
			;(handler as any)(...args)
		}
	}
}

/**
 * Create a DagFileWatcher instance with default settings from VS Code configuration.
 */
export function createDagFileWatcher(dagBridge: DagBridge, workspaceRoot: string): DagFileWatcher {
	const config = vscode.workspace.getConfiguration("beadsmith")
	const debounceMs = config.get<number>("dag.fileWatcherDebounceMs", 1000)
	const autoAnalyse = config.get<boolean>("dag.autoAnalyseOnFileChange", true)

	return new DagFileWatcher(dagBridge, workspaceRoot, {
		debounceMs,
		autoAnalyse,
	})
}
