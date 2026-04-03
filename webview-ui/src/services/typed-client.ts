/**
 * Typed message client for webview ↔ extension communication.
 *
 * Replaces the gRPC-over-postMessage protocol with simple typed messages.
 * Uses the same postMessage transport but with cleaner JSON payloads
 * instead of proto-encoded gRPC envelopes.
 *
 * During transition, both this and grpc-client.ts coexist.
 */

import { v4 as uuidv4 } from "uuid"
import { PLATFORM_CONFIG } from "../config/platform.config"
import type {
	WebviewInbound,
	WebviewOutbound,
	RpcResponseMessage,
} from "../../../src/shared/WebviewMessages"

// ---------------------------------------------------------------------------
// Sending messages to the extension
// ---------------------------------------------------------------------------

/**
 * Send a typed message to the extension backend.
 * This replaces the gRPC request pattern.
 */
export function sendMessage(message: WebviewInbound): void {
	PLATFORM_CONFIG.postMessage(message)
}

/**
 * Send a typed message and wait for an RPC response.
 * For operations that return data (replaces unary gRPC RPCs).
 */
export function sendRequest<T = unknown>(
	message: Omit<Extract<WebviewInbound, { requestId?: string }>, "requestId"> & { type: string },
	timeoutMs = 30000,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const requestId = uuidv4()
		const msgWithId = { ...message, requestId }

		const handleResponse = (event: MessageEvent) => {
			const data = event.data
			if (
				data?.type === "rpcResponse" &&
				(data as RpcResponseMessage).requestId === requestId
			) {
				window.removeEventListener("message", handleResponse)
				clearTimeout(timer)
				if ((data as RpcResponseMessage).error) {
					reject(new Error((data as RpcResponseMessage).error))
				} else {
					resolve((data as RpcResponseMessage).data as T)
				}
			}
		}

		const timer = setTimeout(() => {
			window.removeEventListener("message", handleResponse)
			reject(new Error(`Request timed out: ${message.type}`))
		}, timeoutMs)

		window.addEventListener("message", handleResponse)
		PLATFORM_CONFIG.postMessage(msgWithId)
	})
}

// ---------------------------------------------------------------------------
// Listening for messages from the extension
// ---------------------------------------------------------------------------

type MessageHandler<T extends WebviewOutbound["type"]> = (
	message: Extract<WebviewOutbound, { type: T }>,
) => void

const listeners = new Map<string, Set<MessageHandler<any>>>()
let globalListenerInstalled = false

function ensureGlobalListener() {
	if (globalListenerInstalled) return
	globalListenerInstalled = true

	window.addEventListener("message", (event: MessageEvent) => {
		const data = event.data
		if (!data || typeof data.type !== "string") return

		// Skip gRPC messages — those are handled by grpc-client-base.ts
		if (
			data.type === "grpc_request" ||
			data.type === "grpc_response" ||
			data.type === "grpc_request_cancel"
		) {
			return
		}

		const handlers = listeners.get(data.type)
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(data)
				} catch (err) {
					console.error(`Error in typed message handler for "${data.type}":`, err)
				}
			}
		}
	})
}

/**
 * Subscribe to typed messages of a specific type from the extension.
 * Returns an unsubscribe function.
 */
export function onMessage<T extends WebviewOutbound["type"]>(
	type: T,
	handler: MessageHandler<T>,
): () => void {
	ensureGlobalListener()

	if (!listeners.has(type)) {
		listeners.set(type, new Set())
	}
	listeners.get(type)!.add(handler)

	return () => {
		const handlers = listeners.get(type)
		if (handlers) {
			handlers.delete(handler)
			if (handlers.size === 0) {
				listeners.delete(type)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Convenience wrappers for common operations
// ---------------------------------------------------------------------------

/** Send a new task to the extension */
export function newTask(text: string, images?: string[]): void {
	sendMessage({ type: "newTask", text, images })
}

/** Send a response to a pending ask */
export function askResponse(response: string, text?: string, images?: string[]): void {
	sendMessage({ type: "askResponse", response, text, images })
}

/** Cancel the current task */
export function cancelTask(): void {
	sendMessage({ type: "cancelTask" })
}

/** Clear the current task */
export function clearTask(): void {
	sendMessage({ type: "clearTask" })
}

/** Toggle plan/act mode */
export function toggleMode(mode: "plan" | "act"): void {
	sendMessage({ type: "toggleMode", mode })
}

/** Update a setting */
export function updateSettings(settings: Record<string, unknown>): void {
	sendMessage({ type: "updateSettings", settings })
}

/** Initialize the webview */
export function ready(): void {
	sendMessage({ type: "ready" })
}
