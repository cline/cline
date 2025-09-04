import { GrpcResponse } from "@shared/ExtensionMessage"
import { GrpcRequest } from "@shared/WebviewMessage"
import { LogFileHandler } from "@/core/controller/grpc-recorder/log-file-handler"
import { GrpcLogEntry, GrpcSessionLog, SessionStats } from "@/core/controller/grpc-recorder/types"

class GrpcRecorderNoops implements IRecorder {
	recordRequest(_request: GrpcRequest): void {}
	recordResponse(_requestId: string, _response: GrpcResponse): void {}
	recordError(_requestId: string, _error: string): void {}
	getSessionLog(): GrpcSessionLog {
		return {
			startTime: "",
			entries: [],
		}
	}
}

export interface IRecorder {
	recordRequest(request: GrpcRequest): void
	recordResponse(requestId: string, response: GrpcResponse): void
	recordError(requestId: string, error: string): void
	getSessionLog(): GrpcSessionLog
}

// WIP: to refactor in different classes, just to reduce responsability here
export class GrpcRecorder implements IRecorder {
	private static instance: IRecorder | null = null
	private sessionLog: GrpcSessionLog
	private pendingRequests: Map<string, { entry: GrpcLogEntry; startTime: number }> = new Map()

	private constructor(private fileHandler: LogFileHandler) {
		this.sessionLog = {
			startTime: new Date().toISOString(),
			entries: [],
		}

		this.fileHandler.initialize(this.sessionLog).catch((error) => {
			console.error("Failed to initialize gRPC log file:", error)
		})
	}

	public static getInstance(): IRecorder {
		const enabled = process.env.GRPC_RECORDER_ENABLED === "true"
		if (!enabled) {
			GrpcRecorder.instance = new GrpcRecorderNoops()
		}
		if (!GrpcRecorder.instance) {
			GrpcRecorder.instance = new GrpcRecorder(new LogFileHandler())
		}
		if (!GrpcRecorder.instance) {
			throw new Error("GrpcRecorder not initialized. Call getInstance with context first.")
		}
		return GrpcRecorder.instance
	}

	public static async dispose(): Promise<void> {
		if (!GrpcRecorder.instance) {
			return
		}
		GrpcRecorder.instance = null
	}

	public recordRequest(request: GrpcRequest): void {
		const entry: GrpcLogEntry = {
			requestId: request.request_id,
			service: request.service,
			method: request.method,
			isStreaming: request.is_streaming || false,
			request: {
				message: request.message,
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

		entry.response = {
			message: response?.message ? response.message : undefined,
			error: response?.error,
			isStreaming: response?.is_streaming,
			sequenceNumber: response?.sequence_number,
		}

		entry.duration = Date.now() - startTime
		entry.status = response?.error ? "error" : "completed"

		if (!response?.is_streaming) {
			this.pendingRequests.delete(requestId)
		}

		// WIP: to add as {stats,...}
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

	private flushLogAsync(): void {
		setImmediate(() => {
			this.fileHandler.write(this.sessionLog).catch((error) => {
				console.error("Failed to flush gRPC log:", error)
			})
		})
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
