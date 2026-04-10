/**
 * Webview ↔ SDK gRPC Bridge
 *
 * Translates the webview's gRPC-over-postMessage protocol into calls
 * to the SdkController's GrpcHandler. This is the glue between the
 * existing webview (which speaks gRPC envelopes) and the SDK adapter
 * layer (which speaks plain JS objects).
 *
 * For unary requests: extracts method + params, calls GrpcHandler,
 * wraps result as grpc_response.
 *
 * For streaming requests (subscribeToState, subscribeToPartialMessage):
 * stores the request_id and sends incremental updates via postMessage.
 */

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { isTypedInboundMessage } from "@shared/WebviewMessages"
import type { GrpcHandlerDelegate } from "./grpc-handler"
import { GrpcHandler, type GrpcRequest } from "./grpc-handler"
import { InboundMessageHandler } from "./inbound-handler"

const DEBUG = true
function log(...args: any[]) {
	if (DEBUG) Logger.log("[SDK-Bridge]", ...args)
}

// ---------------------------------------------------------------------------
// Types matching the webview's gRPC envelope format
// ---------------------------------------------------------------------------

export interface WebviewGrpcRequest {
	service: string
	method: string
	message?: any
	request_id: string
	is_streaming?: boolean
}

export interface WebviewGrpcResponse {
	message?: any
	request_id: string
	error?: string
	is_streaming?: boolean
	sequence_number?: number
}

export type PostMessageFn = (message: { type: string; [key: string]: any }) => Promise<boolean | undefined> | void

// ---------------------------------------------------------------------------
// WebviewGrpcBridge
// ---------------------------------------------------------------------------

export class WebviewGrpcBridge {
	private grpcHandler: GrpcHandler
	private postMessage: PostMessageFn
	private inboundHandler?: InboundMessageHandler

	// Track streaming subscriptions by request_id
	private stateSubscriptionRequestId?: string
	private partialMessageSubscriptionRequestId?: string
	private mcpServersSubscriptionRequestId?: string
	private authStatusSubscriptionRequestId?: string
	private addToInputSubscriptionRequestId?: string
	private sequenceCounters = new Map<string, number>()

	constructor(delegate: GrpcHandlerDelegate, postMessage: PostMessageFn) {
		this.grpcHandler = new GrpcHandler(delegate)
		this.postMessage = postMessage

		// Wire up navigation callback so gRPC handlers can trigger
		// typed navigate messages (e.g., scrollToSettings)
		this.grpcHandler.setOnNavigate((view, opts) => this.navigate(view, opts))
	}

	/** Set an optional inbound handler for typed messages */
	setInboundHandler(handler: InboundMessageHandler): void {
		this.inboundHandler = handler
	}

	/**
	 * Handle a message from the webview.
	 * Routes gRPC requests, typed messages, and cancellations.
	 */
	async handleMessage(message: any): Promise<void> {
		if (!message || typeof message !== "object") return

		log("← webview:", message.type, message.grpc_request?.method || message.grpc_request?.service || "")

		// Handle gRPC protocol messages
		if (message.type === "grpc_request" && message.grpc_request) {
			await this.handleGrpcRequest(message.grpc_request)
			return
		}

		if (message.type === "grpc_request_cancel" && message.grpc_request_cancel) {
			// For now, cancellation is a no-op — streaming subscriptions
			// stay alive for the lifetime of the webview
			return
		}

		// Handle typed messages (WebviewInbound)
		if (isTypedInboundMessage(message) && this.inboundHandler) {
			await this.inboundHandler.handle(message)
			return
		}
	}

	/**
	 * Handle a gRPC-style request from the webview.
	 */
	private async handleGrpcRequest(request: WebviewGrpcRequest): Promise<void> {
		const { service, method, message, request_id, is_streaming } = request
		log(`gRPC ${is_streaming ? "stream" : "unary"}: ${service}.${method} [${request_id}]`)

		if (is_streaming) {
			await this.handleStreamingRequest(method, message, request_id)
		} else {
			await this.handleUnaryRequest(method, message, request_id)
		}
	}

	/**
	 * Handle a unary (request/response) gRPC request.
	 */
	private async handleUnaryRequest(method: string, message: any, requestId: string): Promise<void> {
		const grpcReq: GrpcRequest = {
			method,
			params: message ?? {},
		}

		try {
			const result = await this.grpcHandler.handleRequest(grpcReq)

			await this.postMessage({
				type: "grpc_response",
				grpc_response: {
					message: result.data ?? {},
					request_id: requestId,
				},
			})
		} catch (error) {
			await this.postMessage({
				type: "grpc_response",
				grpc_response: {
					error: error instanceof Error ? error.message : String(error),
					request_id: requestId,
					is_streaming: false,
				},
			})
		}
	}

	/**
	 * Handle a streaming gRPC request.
	 *
	 * IMPORTANT: The webview's gRPC layer expects proto-encoded responses,
	 * but the SDK adapter produces plain JS objects. Instead of trying to
	 * proto-encode, we use typed messages (which the webview's dual-listen
	 * pattern picks up) for the critical state/message paths.
	 */
	private async handleStreamingRequest(method: string, message: any, requestId: string): Promise<void> {
		switch (method) {
			case "subscribeToState": {
				this.stateSubscriptionRequestId = requestId
				this.sequenceCounters.set(requestId, 0)

				// Push initial state via typed message (bypasses proto encoding)
				const grpcReq: GrpcRequest = { method: "getLatestState", params: {} }
				const result = await this.grpcHandler.handleRequest(grpcReq)
				const state = result.data ?? {}
				this.postMessage({ type: "state", state })
				break
			}

			case "subscribeToPartialMessage": {
				this.partialMessageSubscriptionRequestId = requestId
				this.sequenceCounters.set(requestId, 0)
				break
			}

			case "subscribeToMcpServers": {
				this.mcpServersSubscriptionRequestId = requestId
				this.sequenceCounters.set(requestId, 0)

				// Push initial MCP servers from disk via typed message.
				// The gRPC streaming response uses proto encoding which may
				// not match the SDK's plain-object format, so we also send
				// as a typed message for the dual-listen pattern.
				const mcpReq: GrpcRequest = { method: "getLatestMcpServers", params: {} }
				const mcpResult = await this.grpcHandler.handleRequest(mcpReq)
				if (mcpResult.data) {
					const servers = (mcpResult.data as any).mcpServers ?? []
					this.postMessage({ type: "mcpServers", servers })
				}
				break
			}

			case "subscribeToAuthStatusUpdate": {
				this.authStatusSubscriptionRequestId = requestId
				this.sequenceCounters.set(requestId, 0)

				// Push initial auth state from disk
				const authReq: GrpcRequest = { method: "subscribeToAuthStatusUpdate", params: {} }
				const authResult = await this.grpcHandler.handleRequest(authReq)
				if (authResult.data) {
					this.sendStreamingResponse(requestId, authResult.data)
				}
				break
			}

			case "subscribeToAddToInput": {
				this.addToInputSubscriptionRequestId = requestId
				this.sequenceCounters.set(requestId, 0)
				break
			}

			default: {
				// For other streaming subscriptions (models, navigation,
				// etc.) the SDK adapter will push real data via typed messages.
				// No gRPC response needed.
				break
			}
		}
	}

	// -----------------------------------------------------------------------
	// Push notifications (called by SdkController when state changes)
	// -----------------------------------------------------------------------

	/** Push state update to the webview via the streaming subscription */
	pushState(state: ExtensionState): void {
		if (this.stateSubscriptionRequestId) {
			this.sendStreamingResponse(this.stateSubscriptionRequestId, state)
		}

		// Also send as a typed message for the dual-listen pattern
		this.postMessage({ type: "state", state })
	}

	/** Push partial message update to the webview */
	pushPartialMessage(message: ClineMessage): void {
		if (this.partialMessageSubscriptionRequestId) {
			this.sendStreamingResponse(this.partialMessageSubscriptionRequestId, message)
		}

		// Also send as typed message
		this.postMessage({ type: "partialMessage", message })
	}

	/**
	 * Push auth status update to the webview via the streaming subscription.
	 * Called after logout/login to notify the webview's ClineAuthContext
	 * of auth state changes. The webview checks response.user.uid — if
	 * falsy, it sets user to null and shows the sign-in view.
	 */
	pushAuthStatus(authData: Record<string, unknown>): void {
		if (this.authStatusSubscriptionRequestId) {
			this.sendStreamingResponse(this.authStatusSubscriptionRequestId, authData)
		}
	}

	/**
	 * Push an addToInput message to the webview.
	 * Used by the "Add to Cline" right-click command to insert selected
	 * code into the chat input area.
	 *
	 * Sends via the gRPC streaming subscription (which ChatView's
	 * subscribeToAddToInput listens for) and also as a typed message
	 * for the dual-listen pattern.
	 */
	pushAddToInput(text: string): void {
		if (this.addToInputSubscriptionRequestId) {
			// ChatView expects { value: string } matching the ProtoString shape
			this.sendStreamingResponse(this.addToInputSubscriptionRequestId, { value: text })
		}
		// Also send as typed message for the dual-listen pattern
		this.postMessage({ type: "addToInput", text })
	}

	// -----------------------------------------------------------------------
	// Navigation (called externally or by gRPC handlers via callback)
	// -----------------------------------------------------------------------

	/**
	 * Send a typed navigate message to the webview.
	 * This triggers the webview's navigation listeners (used by top-bar
	 * buttons and scrollToSettings).
	 */
	navigate(view: string, opts?: { tab?: string; targetSection?: string }): void {
		this.postMessage({
			type: "navigate",
			view,
			tab: opts?.tab,
			targetSection: opts?.targetSection,
		})
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private async sendStreamingResponse(requestId: string, data: any): Promise<void> {
		const seq = (this.sequenceCounters.get(requestId) ?? 0) + 1
		this.sequenceCounters.set(requestId, seq)

		await this.postMessage({
			type: "grpc_response",
			grpc_response: {
				message: data,
				request_id: requestId,
				is_streaming: true,
				sequence_number: seq,
			},
		})
	}
}
