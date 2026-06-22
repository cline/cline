// Holds the webview's active gRPC streaming response handlers and pushes partial messages and
// state snapshots to them. The subscribeToPartialMessage / subscribeToState handlers register
// their responseStream here; the Controller pushes through this bridge as SDK events arrive.
//
// This deliberately owns the streams (rather than the handler modules owning them) so the
// Controller can push asynchronously from inside the SDK event subscription.

import type { StreamingResponseHandler } from "@core/controller/grpc-handler"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { State } from "@shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { Logger } from "@shared/services/Logger"

export class WebviewBridge {
	private partialMessageStream?: StreamingResponseHandler<ProtoClineMessage>
	private stateStream?: StreamingResponseHandler<State>

	// ---- partial message stream ----

	setPartialMessageStream(stream: StreamingResponseHandler<ProtoClineMessage>): void {
		this.partialMessageStream = stream
	}

	clearPartialMessageStream(): void {
		this.partialMessageStream = undefined
	}

	hasPartialMessageStream(): boolean {
		return this.partialMessageStream !== undefined
	}

	// ---- state stream ----

	setStateStream(stream: StreamingResponseHandler<State>): void {
		this.stateStream = stream
	}

	clearStateStream(): void {
		this.stateStream = undefined
	}

	hasStateStream(): boolean {
		return this.stateStream !== undefined
	}

	// ---- push ----

	/** Push a single ClineMessage (already stamped with ts/seq/epoch/partial) to the webview. */
	async pushMessage(message: ClineMessage): Promise<void> {
		if (!this.partialMessageStream) {
			return
		}
		try {
			const proto = convertClineMessageToProto(message)
			await this.partialMessageStream(proto, false)
		} catch (error) {
			Logger.error("[WebviewBridge] Failed to push partial message:", error)
		}
	}

	/** Push a full ExtensionState snapshot to the webview as a State proto (state_json). */
	async pushState(state: ExtensionState): Promise<void> {
		if (!this.stateStream) {
			return
		}
		try {
			const proto = State.create({ stateJson: JSON.stringify(state) })
			await this.stateStream(proto, false)
		} catch (error) {
			Logger.error("[WebviewBridge] Failed to push state:", error)
		}
	}
}
