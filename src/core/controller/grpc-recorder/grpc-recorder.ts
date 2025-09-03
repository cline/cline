import { GrpcResponse } from "@shared/ExtensionMessage"
import { GrpcRequest } from "@shared/WebviewMessage"
import { writeFile } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { GrpcLogEntry, GrpcSessionLog, SessionStats } from "@/core/controller/grpc-recorder/types"

class GrpcRecorderNoops implements Recorder {
	recordRequest(_request: GrpcRequest): void {}
	recordResponse(_requestId: string, _response: GrpcResponse): void {}
	recordError(_requestId: string, _error: string): void {}
	async flushLog(): Promise<void> {}
	getLogFilePath(): string {
		return ""
	}
	getSessionLog(): GrpcSessionLog {
		return {
			sessionId: "",
			startTime: "",
			entries: [],
		}
	}
}

export interface Recorder {
	// WIP: maybe we might want to improve this name
	recordRequest(request: GrpcRequest): void
	recordResponse(requestId: string, response: GrpcResponse): void
	recordError(requestId: string, error: string): void
	flushLog(): Promise<void>
	getLogFilePath(): string
	getSessionLog(): GrpcSessionLog
}

// WIP: to refactor in different classes, just to reduce responsability here
export class GrpcRecorder implements Recorder {
	private static instance: Recorder | null = null
	private sessionLog: GrpcSessionLog
	private logFilePath: string
	private pendingRequests: Map<string, { entry: GrpcLogEntry; startTime: number }> = new Map()

	private constructor() {
		const fileName = this.getFileName()
		const workspaceFolder = process.env.DEV_WORKSPACE_FOLDER ?? process.cwd()
		const folderPath = path.join(workspaceFolder, "tests", "specs")

		this.logFilePath = path.join(folderPath, fileName)

		this.sessionLog = {
			sessionId: this.generateSessionId(),
			startTime: new Date().toISOString(),
			entries: [],
		}

		this.initializeLogFile().catch((error) => {
			console.error("Failed to initialize gRPC log file:", error)
		})
	}

	public static getInstance(): Recorder {
		const enabled = process.env.GRPC_RECORDER_ENABLED === "true"
		if (!enabled) {
			GrpcRecorder.instance = new GrpcRecorderNoops()
		}
		if (!GrpcRecorder.instance) {
			GrpcRecorder.instance = new GrpcRecorder()
		}
		if (!GrpcRecorder.instance) {
			throw new Error("GrpcRecorder not initialized. Call getInstance with context first.")
		}
		return GrpcRecorder.instance
	}

	public static async dispose(): Promise<void> {
		if (GrpcRecorder.instance) {
			try {
				await GrpcRecorder.instance.flushLog()
				console.log("gRPC log flushed successfully on dispose")
			} catch (error) {
				console.error("Failed to flush gRPC log on dispose:", error)
			}
			GrpcRecorder.instance = null
		}
	}

	// random temporary unique id. it's not universally unique, but enough for testing
	private generateSessionId(): string {
		return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
	}

	private getFileName(): string {
		const envFileName = process.env.GRPC_RECORDER_FILE_NAME
		if (envFileName && envFileName.trim().length > 0) {
			return `${envFileName}.json`
		}

		const sessionId = this.generateSessionId()
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
		return `grpc-recorded-session-${timestamp}-${sessionId}.json`
	}

	private async initializeLogFile(): Promise<void> {
		try {
			// Ensure directory exists
			await fs.mkdir(path.dirname(this.logFilePath), { recursive: true })

			// Write initial session log
			await writeFile(this.logFilePath, JSON.stringify(this.sessionLog, null, 2), "utf8")

			console.log(`gRPC session log initialized: ${this.logFilePath}`)
		} catch (error) {
			console.error("Failed to initialize gRPC log file:", error)
		}
	}

	public recordRequest(request: GrpcRequest): void {
		const entry: GrpcLogEntry = {
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

	public getSessionLog(): GrpcSessionLog {
		return this.sessionLog
	}

	public recordResponse(requestId: string, response: GrpcResponse): void {
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

		this.sessionLog.stats = this.getStats()

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
			// WIP: this should be extracted into a new class +
			// Create a deep copy and remove any potential circular references
			return JSON.parse(
				JSON.stringify(message, (_key, value) => {
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
		// this.flushLog().catch((error) => {
		// 	console.error("Failed to flush gRPC log:", error)
		// })
		// Use setImmediate to avoid blocking the main thread
		setImmediate(() => {
			this.flushLog().catch((error) => {
				console.error("Failed to flush gRPC log:", error)
			})
		})
	}

	public async flushLog(): Promise<void> {
		try {
			await writeFile(this.logFilePath, JSON.stringify(this.sessionLog, null, 2), "utf8")
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

	public getStats(): SessionStats {
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
