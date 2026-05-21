import { GrpcRequest } from "@/shared/WebviewMessage"

export type GrpcPostRecordHook = (entry: GrpcLogEntry, controller?: any) => Promise<void> | void

export type GrpcRequestFilter = (request: GrpcRequest) => boolean

export interface GrpcLogEntry {
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
	meta?: { synthetic?: boolean }
}

export interface SessionStats {
	totalRequests: number
	pendingRequests: number
	completedRequests: number
	errorRequests: number
}

export interface GrpcSessionLog {
	startTime: string
	stats?: SessionStats
	entries: GrpcLogEntry[]
}
