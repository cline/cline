import { GrpcResponse } from "@shared/ExtensionMessage"
import { GrpcRequest } from "@shared/WebviewMessage"
import { GrpcRecorderBuilder } from "@/core/controller/grpc-recorder/grpc-recorder.builder"
import { ILogFileHandler } from "@/core/controller/grpc-recorder/log-file-handler"
import {
	GrpcLogEntry,
	GrpcPostRecordHook,
	GrpcRequestFilter,
	GrpcSessionLog,
	SessionStats,
} from "@/core/controller/grpc-recorder/types"

export class GrpcRecorderNoops implements IRecorder {
	recordRequest(_request: GrpcRequest): void {}
	recordResponse(_requestId: string, _response: GrpcResponse): void {}
	recordError(_requestId: string, _error: string): void {}
	getSessionLog(): GrpcSessionLog {
		return {
			startTime: "",
			entries: [],
		}
	}
	cleanupSyntheticEntries(): void {}
}

export interface IRecorder {
	recordRequest(request: GrpcRequest, synthetic?: boolean): void
	recordResponse(requestId: string, response: GrpcResponse): void
	recordError(requestId: string, error: string): void
	getSessionLog(): GrpcSessionLog
	cleanupSyntheticEntries(): void
}

/**
 * Default implementation of a gRPC recorder.
 *
 * Responsibilities:
 * - Records requests, responses, and errors.
 * - Tracks request/response lifecycle, including duration and status.
 * - Maintains a session log of all recorded entries.
 * - Persists logs asynchronously through a file handler.
 */
export class GrpcRecorder implements IRecorder {
	private sessionLog: GrpcSessionLog
	private pendingRequests: Map<string, { entry: GrpcLogEntry; startTime: number }> = new Map()

	constructor(
		private fileHandler: ILogFileHandler,
		private requestFilters: GrpcRequestFilter[] = [],
		private postRecordHooks: GrpcPostRecordHook[] = [],
	) {
		this.sessionLog = {
			startTime: new Date().toISOString(),
			entries: [],
		}

		this.fileHandler.initialize(this.sessionLog).catch((error) => {
			console.error("Failed to initialize gRPC log file:", error)
		})
	}

	public static builder(): GrpcRecorderBuilder {
		return new GrpcRecorderBuilder()
	}

	/**
	 * Records a gRPC request.
	 *
	 * - Stores the request as a "pending" log entry.
	 * - Tracks the request start time for later duration calculation.
	 * - Persists the log asynchronously.
	 *
	 * @param request - The incoming gRPC request.
	 */
	public recordRequest(request: GrpcRequest, synthetic: boolean = false): void {
		if (this.shouldFilter(request)) {
			return
		}

		const entry: GrpcLogEntry = {
			requestId: request.request_id,
			service: request.service,
			method: request.method,
			isStreaming: request.is_streaming || false,
			request: {
				message: request.message,
			},
			status: "pending",
			meta: { synthetic },
		}

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

	/**
	 * Records a gRPC response for a given request.
	 *
	 * - Looks up the pending request entry.
	 * - Updates the entry with response data, status, and duration.
	 * - Removes the request from pending if it's not streaming.
	 * - Recomputes session stats.
	 * - Persists the log asynchronously.
	 *
	 * @param requestId - The ID of the request being responded to.
	 * @param response - The corresponding gRPC response.
	 */
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

		this.sessionLog.stats = this.getStats()

		this.flushLogAsync()

		this.runHooks(entry).catch((e) => console.error("Post-record hook failed:", e))
	}

	private async runHooks(entry: GrpcLogEntry): Promise<void> {
		if (entry.meta?.synthetic) return
		for (const hook of this.postRecordHooks) {
			await hook(entry)
		}
	}

	public cleanupSyntheticEntries(): void {
		// Remove synthetic entries from session log
		this.sessionLog.entries = this.sessionLog.entries.filter((entry) => !entry.meta?.synthetic)

		// clean up from pending requests if needed
		for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
			if (pendingRequest.entry.meta?.synthetic) {
				this.pendingRequests.delete(requestId)
			}
		}

		this.sessionLog.stats = this.getStats()
		this.flushLogAsync()
	}

	/**
	 * Records an error for a given request.
	 *
	 * - Marks the request as failed.
	 * - Records the error message and request duration.
	 * - Removes it from the pending requests.
	 * - Persists the log asynchronously.
	 *
	 * @param requestId - The ID of the request that errored.
	 * @param error - Error message.
	 */
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

	private shouldFilter(request: GrpcRequest): boolean {
		return this.requestFilters.some((filter) => filter(request))
	}
}
