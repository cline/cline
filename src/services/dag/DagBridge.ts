/**
 * DAG Bridge - TypeScript interface to the Python DAG analysis engine.
 *
 * Manages the Python subprocess lifecycle and provides JSON-RPC
 * communication for dependency analysis requests.
 */

import { spawn, spawnSync, type ChildProcess } from "child_process"
import { EventEmitter } from "events"
import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"

import { Logger } from "@shared/services/Logger"
import type {
	DagServiceStatus,
	GraphEdge,
	GraphNode,
	ImpactReport,
	JsonRpcRequest,
	JsonRpcResponse,
	ProjectGraph,
} from "./types"

/**
 * Result of Python validation check.
 */
export interface PythonValidationResult {
	valid: boolean
	pythonPath?: string
	version?: string
	error?: string
	suggestion?: string
}

/**
 * Minimum Python version required for the DAG engine.
 */
const MIN_PYTHON_VERSION = { major: 3, minor: 12 }

/**
 * Parse Python version string like "Python 3.12.1" into components.
 */
function parsePythonVersion(
	versionString: string,
): { major: number; minor: number; patch: number } | null {
	const match = versionString.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/)
	if (!match) {
		return null
	}
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: match[3] ? parseInt(match[3], 10) : 0,
	}
}

/**
 * Check if a Python version meets the minimum requirement.
 */
function meetsMinimumVersion(version: { major: number; minor: number }): boolean {
	if (version.major > MIN_PYTHON_VERSION.major) {
		return true
	}
	if (version.major === MIN_PYTHON_VERSION.major && version.minor >= MIN_PYTHON_VERSION.minor) {
		return true
	}
	return false
}

/**
 * Validate Python installation and venv setup.
 *
 * Checks:
 * 1. Python 3.12+ is available on the system
 * 2. The venv exists at dag-engine/.venv
 * 3. The venv's Python is executable
 */
export function validatePythonSetup(extensionPath: string): PythonValidationResult {
	const enginePath = path.join(extensionPath, "dag-engine")
	const venvPath = path.join(enginePath, ".venv")
	const isWindows = process.platform === "win32"
	const venvPython = isWindows
		? path.join(venvPath, "Scripts", "python.exe")
		: path.join(venvPath, "bin", "python")

	// Check if venv exists
	if (!fs.existsSync(venvPath)) {
		return {
			valid: false,
			error: "DAG engine virtual environment not found",
			suggestion: "Run 'npm run setup:dag' to set up the DAG analysis engine.",
		}
	}

	// Check if venv Python executable exists
	if (!fs.existsSync(venvPython)) {
		return {
			valid: false,
			error: "DAG engine Python executable not found in virtual environment",
			suggestion:
				"The virtual environment may be corrupted. Delete dag-engine/.venv and run 'npm run setup:dag'.",
		}
	}

	// Check Python version in venv
	try {
		const result = spawnSync(venvPython, ["--version"], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		})

		if (result.status !== 0) {
			return {
				valid: false,
				error: "Failed to get Python version from virtual environment",
				suggestion: "The virtual environment may be corrupted. Delete dag-engine/.venv and run 'npm run setup:dag'.",
			}
		}

		const versionOutput = (result.stdout || result.stderr || "").trim()
		const version = parsePythonVersion(versionOutput)

		if (!version) {
			return {
				valid: false,
				error: `Could not parse Python version: ${versionOutput}`,
				suggestion: "The virtual environment may be corrupted. Delete dag-engine/.venv and run 'npm run setup:dag'.",
			}
		}

		if (!meetsMinimumVersion(version)) {
			return {
				valid: false,
				error: `Python ${version.major}.${version.minor} found, but ${MIN_PYTHON_VERSION.major}.${MIN_PYTHON_VERSION.minor}+ is required`,
				suggestion: `Install Python ${MIN_PYTHON_VERSION.major}.${MIN_PYTHON_VERSION.minor} or later, then run 'npm run setup:dag'.`,
			}
		}

		return {
			valid: true,
			pythonPath: venvPython,
			version: versionOutput,
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return {
			valid: false,
			error: `Failed to validate Python: ${message}`,
			suggestion: "Ensure Python is properly installed and run 'npm run setup:dag'.",
		}
	}
}

/**
 * Recursively convert all snake_case keys in an object to camelCase.
 * The Python DAG engine returns snake_case JSON, but TypeScript types use camelCase.
 */
function snakeToCamelKeys(obj: unknown): unknown {
	if (Array.isArray(obj)) {
		return obj.map(snakeToCamelKeys)
	}
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
			result[camelKey] = snakeToCamelKeys(value)
		}
		return result
	}
	return obj
}

/**
 * Pending request waiting for a response.
 */
interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (error: Error) => void
	timeout: NodeJS.Timeout
}

/**
 * Events emitted by the DAG bridge.
 */
export interface DagBridgeEvents {
	ready: () => void
	exit: (code: number | null) => void
	error: (error: Error) => void
	graphUpdated: (graph: ProjectGraph) => void
	healthCheckPassed: (status: DagServiceStatus) => void
	healthCheckFailed: (error: Error) => void
	restarting: (attempt: number, maxAttempts: number) => void
	restartFailed: (error: Error) => void
}

/**
 * Configuration options for the DAG bridge.
 */
export interface DagBridgeOptions {
	/** Request timeout in milliseconds (default: 60000) */
	requestTimeoutMs?: number
	/** Whether to enable auto-restart on crash (default: true) */
	autoRestart?: boolean
	/** Maximum number of auto-restart attempts (default: 3) */
	maxRestartAttempts?: number
	/** Delay between restart attempts in milliseconds (default: 1000) */
	restartDelayMs?: number
	/** Health check interval in milliseconds (default: 30000) */
	healthCheckIntervalMs?: number
	/** Whether to enable periodic health checks (default: true) */
	enableHealthChecks?: boolean
}

/**
 * Bridge to the Python DAG analysis engine.
 *
 * Manages subprocess lifecycle and provides async methods
 * for all DAG analysis operations.
 */
export class DagBridge extends EventEmitter {
	private process: ChildProcess | null = null
	private requestId = 0
	private pendingRequests = new Map<number, PendingRequest>()
	private buffer = ""
	private isReady = false

	private readonly pythonPath: string
	private readonly extensionPath: string
	private readonly requestTimeoutMs: number

	// Validated Python path (from venv)
	private validatedPythonPath: string | null = null

	// Auto-restart configuration
	private readonly autoRestart: boolean
	private readonly maxRestartAttempts: number
	private readonly restartDelayMs: number
	private restartAttempts = 0
	private isShuttingDown = false

	// Health check configuration
	private readonly healthCheckIntervalMs: number
	private readonly enableHealthChecks: boolean
	private healthCheckTimer: NodeJS.Timeout | null = null
	private lastHealthCheckTime: number = 0
	private consecutiveHealthFailures = 0
	private readonly maxConsecutiveHealthFailures = 3

	constructor(
		pythonPath: string,
		extensionPath: string,
		options?: DagBridgeOptions
	) {
		super()
		this.pythonPath = pythonPath
		this.extensionPath = extensionPath
		this.requestTimeoutMs = options?.requestTimeoutMs ?? 60000 // Default 60s timeout

		// Auto-restart configuration
		this.autoRestart = options?.autoRestart ?? true
		this.maxRestartAttempts = options?.maxRestartAttempts ?? 3
		this.restartDelayMs = options?.restartDelayMs ?? 1000

		// Health check configuration
		this.healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 30000 // 30s default
		this.enableHealthChecks = options?.enableHealthChecks ?? true
	}

	/**
	 * Validate Python setup before starting.
	 * Returns the validation result.
	 */
	validateSetup(): PythonValidationResult {
		return validatePythonSetup(this.extensionPath)
	}

	/**
	 * Start the DAG engine subprocess.
	 *
	 * Validates Python setup before starting. Throws an error with
	 * helpful suggestions if prerequisites are not met.
	 */
	async start(): Promise<void> {
		if (this.process) {
			throw new Error("DAG engine already running")
		}

		// Validate Python setup
		const validation = this.validateSetup()
		if (!validation.valid) {
			const errorMessage = validation.error || "Python validation failed"
			const suggestion = validation.suggestion || "Run 'npm run setup:dag' to set up the DAG analysis engine."
			throw new Error(`${errorMessage}\n\n${suggestion}`)
		}

		this.validatedPythonPath = validation.pythonPath!
		Logger.info(`[DAG Bridge] Using Python: ${this.validatedPythonPath} (${validation.version})`)

		this.isShuttingDown = false
		const enginePath = path.join(this.extensionPath, "dag-engine")

		this.process = spawn(this.validatedPythonPath, ["-m", "beadsmith_dag.server"], {
			cwd: enginePath,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PYTHONUNBUFFERED: "1" },
		})

		// Handle stdout (JSON-RPC responses)
		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data.toString())
		})

		// Handle stderr (logging)
		this.process.stderr?.on("data", (data: Buffer) => {
			Logger.debug("[DAG Engine]", data.toString().trim())
		})

		// Handle process exit
		this.process.on("exit", (code) => {
			Logger.debug(`DAG engine exited with code ${code}`)
			this.isReady = false
			this.process = null
			this.stopHealthChecks()

			// Reject all pending requests
			for (const [id, pending] of this.pendingRequests) {
				clearTimeout(pending.timeout)
				pending.reject(new Error("DAG engine exited unexpectedly"))
				this.pendingRequests.delete(id)
			}

			this.emit("exit", code)

			// Attempt auto-restart if enabled and not shutting down
			if (this.autoRestart && !this.isShuttingDown) {
				void this.attemptRestart()
			}
		})

		// Handle process errors
		this.process.on("error", (error) => {
			Logger.error("[DAG Engine] Process error:", error)
			this.emit("error", error)
		})

		// Wait for the engine to be ready
		try {
			await this.getStatus()
			this.isReady = true
			this.lastHealthCheckTime = Date.now()
			this.consecutiveHealthFailures = 0
			this.emit("ready")

			// Start periodic health checks
			this.startHealthChecks()
		} catch (error) {
			this.stop()
			throw error
		}
	}

	/**
	 * Stop the DAG engine subprocess.
	 */
	stop(): void {
		this.isShuttingDown = true
		this.stopHealthChecks()

		if (this.process) {
			this.process.kill()
			this.process = null
			this.isReady = false
		}
	}

	/**
	 * Start periodic health checks.
	 */
	private startHealthChecks(): void {
		if (!this.enableHealthChecks || this.healthCheckTimer) {
			return
		}

		this.healthCheckTimer = setInterval(async () => {
			await this.performHealthCheck()
		}, this.healthCheckIntervalMs)
	}

	/**
	 * Stop periodic health checks.
	 */
	private stopHealthChecks(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer)
			this.healthCheckTimer = null
		}
	}

	/**
	 * Perform a single health check.
	 */
	private async performHealthCheck(): Promise<boolean> {
		if (!this.process || this.isShuttingDown) {
			return false
		}

		try {
			const status = await this.getStatus()
			this.lastHealthCheckTime = Date.now()
			this.consecutiveHealthFailures = 0

			Logger.debug("[DAG Bridge] Health check passed:", status)
			this.emit("healthCheckPassed", status)
			return status.running
		} catch (error) {
			this.consecutiveHealthFailures++
			const err = error instanceof Error ? error : new Error(String(error))
			Logger.warn(
				`[DAG Bridge] Health check failed (${this.consecutiveHealthFailures}/${this.maxConsecutiveHealthFailures}):`,
				error
			)
			this.emit("healthCheckFailed", err)

			if (this.consecutiveHealthFailures >= this.maxConsecutiveHealthFailures) {
				Logger.error("[DAG Bridge] Too many consecutive health check failures, attempting restart")
				await this.attemptRestart()
			}

			return false
		}
	}

	/**
	 * Attempt to restart the DAG engine after a crash.
	 */
	private async attemptRestart(): Promise<void> {
		if (!this.autoRestart || this.isShuttingDown) {
			return
		}

		if (this.restartAttempts >= this.maxRestartAttempts) {
			const err = new Error("DAG engine failed to restart after multiple attempts")
			Logger.error(
				`[DAG Bridge] Max restart attempts (${this.maxRestartAttempts}) reached, giving up`
			)
			this.emit("restartFailed", err)
			this.emit("error", err)
			return
		}

		this.restartAttempts++
		Logger.info(`[DAG Bridge] Attempting restart (${this.restartAttempts}/${this.maxRestartAttempts})`)
		this.emit("restarting", this.restartAttempts, this.maxRestartAttempts)

		// Stop the current process if it's still running
		if (this.process) {
			this.process.kill()
			this.process = null
			this.isReady = false
		}

		// Wait before restarting
		await new Promise((resolve) => setTimeout(resolve, this.restartDelayMs))

		try {
			await this.start()
			this.restartAttempts = 0 // Reset counter on successful restart
			Logger.info("[DAG Bridge] Restart successful")
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			Logger.error("[DAG Bridge] Restart failed:", error)
			this.emit("restartFailed", err)
			// Will try again on next health check or process exit
		}
	}

	/**
	 * Get the time since the last successful health check.
	 */
	getLastHealthCheckAge(): number {
		if (this.lastHealthCheckTime === 0) {
			return -1
		}
		return Date.now() - this.lastHealthCheckTime
	}

	/**
	 * Get the current restart attempt count.
	 */
	getRestartAttempts(): number {
		return this.restartAttempts
	}

	/**
	 * Reset the restart attempt counter.
	 */
	resetRestartAttempts(): void {
		this.restartAttempts = 0
	}

	/**
	 * Check if the DAG engine is running and ready.
	 */
	isRunning(): boolean {
		return this.process !== null && this.isReady
	}

	/**
	 * Get the status of the DAG engine.
	 */
	async getStatus(): Promise<DagServiceStatus> {
		const result = await this.call("get_status", {})
		return result as DagServiceStatus
	}

	/**
	 * Analyse an entire project.
	 */
	async analyseProject(rootPath: string): Promise<ProjectGraph> {
		const result = await this.call("analyse_project", { root: rootPath })
		const graph = result as ProjectGraph
		this.emit("graphUpdated", graph)
		return graph
	}

	/**
	 * Analyse a single file.
	 */
	async analyseFile(filePath: string): Promise<{ nodes: unknown[]; edges: unknown[] }> {
		const result = await this.call("analyse_file", { file: filePath })
		return result as { nodes: unknown[]; edges: unknown[] }
	}

	/**
	 * Get impact analysis for a file or function.
	 */
	async getImpact(
		filePath: string,
		functionName?: string,
		options?: { maxDepth?: number; minConfidence?: string }
	): Promise<ImpactReport> {
		const result = await this.call("get_impact", {
			file: filePath,
			function: functionName,
			max_depth: options?.maxDepth,
			min_confidence: options?.minConfidence,
		})
		return result as ImpactReport
	}

	/**
	 * Get all callers of a node.
	 */
	async getCallers(nodeId: string): Promise<string[]> {
		const result = await this.call("get_callers", { node_id: nodeId })
		return result as string[]
	}

	/**
	 * Get all callees of a node.
	 */
	async getCallees(nodeId: string): Promise<string[]> {
		const result = await this.call("get_callees", { node_id: nodeId })
		return result as string[]
	}

	/**
	 * Mark a file for re-analysis.
	 */
	async invalidateFile(filePath: string): Promise<void> {
		await this.call("invalidate_file", { file: filePath })
	}

	/**
	 * Clear the cached graph.
	 */
	async clearCache(): Promise<void> {
		await this.call("clear_cache", {})
	}

	/**
	 * Get the cached project graph (without re-analysing).
	 */
	async getCachedGraph(): Promise<ProjectGraph | null> {
		const result = await this.call("get_cached_graph", {})
		return (result as ProjectGraph | null) ?? null
	}

	/**
	 * Query nodes in the cached graph by file path, name, and/or type.
	 */
	async queryNodes(
		options: { filePath?: string; name?: string; type?: string; limit?: number }
	): Promise<{ nodes: GraphNode[]; totalCount: number }> {
		const result = await this.call("query_nodes", {
			file_path: options.filePath,
			name: options.name,
			type: options.type,
			limit: options.limit,
		})
		return result as { nodes: GraphNode[]; totalCount: number }
	}

	/**
	 * Get all edges connected to a node (incoming and outgoing) with full metadata.
	 */
	async getEdgesForNode(nodeId: string): Promise<{ incoming: GraphEdge[]; outgoing: GraphEdge[] }> {
		const result = await this.call("get_edges_for_node", { node_id: nodeId })
		return result as { incoming: GraphEdge[]; outgoing: GraphEdge[] }
	}

	/**
	 * Send a JSON-RPC request to the DAG engine.
	 */
	private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (!this.process) {
			throw new Error("DAG engine not running")
		}

		const id = ++this.requestId
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		}

		return new Promise((resolve, reject) => {
			// Set up timeout
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id)
				reject(new Error(`DAG request timed out: ${method}`))
			}, this.requestTimeoutMs)

			this.pendingRequests.set(id, { resolve, reject, timeout })

			// Send request
			const requestJson = JSON.stringify(request) + "\n"
			this.process!.stdin?.write(requestJson)
		})
	}

	/**
	 * Handle data received from the DAG engine.
	 */
	private handleData(data: string): void {
		this.buffer += data

		// Process complete lines
		const lines = this.buffer.split("\n")
		this.buffer = lines.pop() || ""

		for (const line of lines) {
			if (!line.trim()) {
				continue
			}

			try {
				const response: JsonRpcResponse = JSON.parse(line)
				const pending = this.pendingRequests.get(response.id)

				if (pending) {
					clearTimeout(pending.timeout)
					this.pendingRequests.delete(response.id)

					if (response.error) {
						pending.reject(new Error(response.error.message))
					} else {
						// Convert snake_case keys from Python to camelCase for TypeScript
					pending.resolve(snakeToCamelKeys(response.result))
					}
				}
			} catch (_error) {
				Logger.error("[DAG Bridge] Failed to parse response:", line.substring(0, 200))
			}
		}
	}
}

/**
 * Create a DagBridge instance with default settings from VS Code configuration.
 */
export function createDagBridge(context: vscode.ExtensionContext): DagBridge {
	const config = vscode.workspace.getConfiguration("beadsmith")
	const pythonPath = config.get<string>("dag.pythonPath", "python3")
	const autoRestart = config.get<boolean>("dag.autoRestart", true)
	const healthCheckIntervalMs = config.get<number>("dag.healthCheckIntervalMs", 30000)
	const enableHealthChecks = config.get<boolean>("dag.enableHealthChecks", true)

	return new DagBridge(pythonPath, context.extensionPath, {
		autoRestart,
		healthCheckIntervalMs,
		enableHealthChecks,
	})
}
