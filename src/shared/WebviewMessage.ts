export interface WebviewMessage {
	type: "grpc_request" | "grpc_request_cancel" | "webview_debug_log"
	grpc_request?: GrpcRequest
	grpc_request_cancel?: GrpcCancel
	webview_debug_log?: WebviewDebugLog
}

export type WebviewDebugLog = {
	level: "log" | "warn" | "error" | "debug"
	args: string[]
	timestamp: number
}

export type GrpcRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type GrpcCancel = {
	request_id: string // ID of the request to cancel
}

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type ClineCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
