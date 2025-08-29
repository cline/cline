import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { GrpcRequest } from "@/shared/WebviewMessage"

export interface GrpcLogEntry {
	timestamp: string
	sessionId: string
	requestId: string
	service: string
	method: string
	isStreaming: boolean
	request: {
		message: any
	}
	response?: {
		message?: any
		error?: string
		isStreaming?: boolean
		sequenceNumber?: number
	}
	duration?: number
	status: "pending" | "completed" | "error"
}

export interface GrpcSessionLog {
	sessionId: string
	startTime: string
	extensionVersion: string
	vscodeVersion: string
	platform: string
	entries: GrpcLogEntry[]
}

export class GrpcRecorder {
	private static instance: GrpcRecorder | null = null
	private sessionLog: GrpcSessionLog
	private logFilePath: string
	private pendingRequests: Map<string, { entry: GrpcLogEntry; startTime: number }> = new Map()

	private constructor(context: vscode.ExtensionContext) {
		const sessionId = this.generateSessionId()
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
		const fileName = `grpc-session-${timestamp}-${sessionId}.json`

		// Create logs directory in extension's global storage
		const logsDir = path.join(context.globalStorageUri.fsPath, "grpc-logs")
		this.logFilePath = path.join(logsDir, fileName)

		this.sessionLog = {
			sessionId,
			startTime: new Date().toISOString(),
			extensionVersion: context.extension?.packageJSON?.version ?? "unknown",
			vscodeVersion: vscode.version,
			platform: process.platform,
			entries: [],
		}

		// Ensure logs directory exists and create initial log file
		this.initializeLogFile().catch((error) => {
			console.error("Failed to initialize gRPC log file:", error)
		})
	}

	public static getInstance(context?: vscode.ExtensionContext): GrpcRecorder {
		if (!GrpcRecorder.instance && context) {
			GrpcRecorder.instance = new GrpcRecorder(context)
		}
		if (!GrpcRecorder.instance) {
			throw new Error("GrpcRecorder not initialized. Call getInstance with context first.")
		}
		return GrpcRecorder.instance
	}

	public static dispose(): void {
		if (GrpcRecorder.instance) {
			GrpcRecorder.instance.flushLog().catch((error) => {
				console.error("Failed to flush gRPC log on dispose:", error)
			})
			GrpcRecorder.instance = null
		}
	}

	private generateSessionId(): string {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
	}

	private async initializeLogFile(): Promise<void> {
		try {
			// Ensure directory exists
			await fs.mkdir(path.dirname(this.logFilePath), { recursive: true })

			// Write initial session log
			await fs.writeFile(this.logFilePath, JSON.stringify(this.sessionLog, null, 2), "utf8")

			console.log(`gRPC session log initialized: ${this.logFilePath}`)
		} catch (error) {
			console.error("Failed to initialize gRPC log file:", error)
		}
	}

	public recordRequest(request: GrpcRequest): void {
		const entry: GrpcLogEntry = {
			timestamp: new Date().toISOString(),
			sessionId: this.sessionLog.sessionId,
			requestId: request.request_id,
			service: request.service,
			method: request.method,
			isStreaming: request.is_streaming || false,
			request: {
				message: this.sanitizeMessage(request.message),
			},
			status: "pending",
		}

		// Store pending request for duration calculation
		this.pendingRequests.set(request.request_id, {
			entry,
			startTime: Date.now(),
		})

		this.sessionLog.entries.push(entry)
		this.flushLogAsync()
	}

	public recordResponse(requestId: string, response: ExtensionMessage["grpc_response"]): void {
		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) {
			console.warn(`No pending request found for response with ID: ${requestId}`)
			return
		}

		const { entry, startTime } = pendingRequest

		// Update the entry with response data
		entry.response = {
			message: response?.message ? this.sanitizeMessage(response.message) : undefined,
			error: response?.error,
			isStreaming: response?.is_streaming,
			sequenceNumber: response?.sequence_number,
		}

		entry.duration = Date.now() - startTime
		entry.status = response?.error ? "error" : "completed"

		// For non-streaming requests or final streaming response, remove from pending
		if (!response?.is_streaming) {
			this.pendingRequests.delete(requestId)
		}

		this.flushLogAsync()
	}

	public recordError(requestId: string, error: string): void {
		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) {
			console.warn(`No pending request found for error with ID: ${requestId}`)
			return
		}

		const { entry, startTime } = pendingRequest

		entry.response = {
			error: error,
		}
		entry.duration = Date.now() - startTime
		entry.status = "error"

		this.pendingRequests.delete(requestId)
		this.flushLogAsync()
	}

	private sanitizeMessage(message: any): any {
		if (!message) return message

		try {
			// Create a deep copy and remove any potential circular references
			return JSON.parse(
				JSON.stringify(message, (key, value) => {
					// Filter out functions, symbols, and other non-serializable values
					if (typeof value === "function" || typeof value === "symbol") {
						return "[Function/Symbol]"
					}
					// Truncate very long strings to prevent huge log files
					if (typeof value === "string" && value.length > 1000) {
						return value.substring(0, 1000) + "...[truncated]"
					}
					return value
				}),
			)
		} catch (error) {
			console.warn("Failed to sanitize gRPC message:", error)
			return "[Serialization Error]"
		}
	}

	private flushLogAsync(): void {
		// Use setImmediate to avoid blocking the main thread
		setImmediate(() => {
			this.flushLog().catch((error) => {
				console.error("Failed to flush gRPC log:", error)
			})
		})
	}

	private async flushLog(): Promise<void> {
		try {
			await fs.writeFile(this.logFilePath, JSON.stringify(this.sessionLog, null, 2), "utf8")
		} catch (error) {
			console.error("Failed to write gRPC log to file:", error)
		}
	}

	public getLogFilePath(): string {
		return this.logFilePath
	}

	public getSessionId(): string {
		return this.sessionLog.sessionId
	}

	public getStats(): { totalRequests: number; pendingRequests: number; completedRequests: number; errorRequests: number } {
		const totalRequests = this.sessionLog.entries.length
		const pendingRequests = this.sessionLog.entries.filter((e) => e.status === "pending").length
		const completedRequests = this.sessionLog.entries.filter((e) => e.status === "completed").length
		const errorRequests = this.sessionLog.entries.filter((e) => e.status === "error").length

		return {
			totalRequests,
			pendingRequests,
			completedRequests,
			errorRequests,
		}
	}
}
