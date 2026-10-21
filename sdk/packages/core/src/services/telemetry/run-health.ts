import type {
	AgentMessage,
	AgentModelFinishReason,
	AgentRuntimeEvent,
	ITelemetryService,
	TelemetryProperties,
} from "@cline/shared";
import { captureRunIdle } from "./core-events";
import { classifyFinalTurnText } from "./stall-signals";

/** Silence (no runtime event, stream deltas included) before a run reports `task.run_idle`. */
export const RUN_IDLE_REPORT_MS = 60_000;

/** Coarse shape of a message; never carries content. */
function messageShape(message: AgentMessage): string {
	if (message.content.length === 0) {
		return "empty";
	}
	const types = new Set(message.content.map((part) => part.type));
	if (types.has("tool-call")) return "tool_call";
	return `assistant_${types.has("text") ? "text" : "other"}`;
}

function messageText(message: AgentMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
}

/**
 * Stall diagnostics for one agent run, derived only from its runtime events.
 * `endProperties()` enriches the run's `agent.run-finished` /
 * `agent.run-failed` telemetry; `task.run_idle` is sent while the run is
 * still stuck.
 */
export class RunHealthObserver {
	private lastEventAt = Date.now();
	private lastEventType = "";
	private maxIdleMs = 0;
	private maxIdleAfter = "";
	private idleReported = false;
	private agentId = "";
	private runId = "";
	private finishReason?: AgentModelFinishReason;
	private turnStarted = false;
	/** The current turn streamed something but has no assistant message yet. */
	private turnHadOutput = false;
	/** The current turn's assistant message, once the runtime accepts one. */
	private turnMessage?: AgentMessage;
	private idleTimer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly telemetry: ITelemetryService,
		private readonly context: {
			sessionId?: string;
			isSubagent: boolean;
			providerId?: string;
			modelId?: string;
		},
	) {
		this.scheduleIdleCheck();
	}

	observe(event: AgentRuntimeEvent): void {
		this.recordGap();
		this.lastEventType = event.type;
		this.agentId = event.snapshot.agentId;
		this.runId = event.snapshot.runId ?? "";
		switch (event.type) {
			case "turn-started":
				this.turnStarted = true;
				this.turnHadOutput = false;
				this.turnMessage = undefined;
				this.finishReason = undefined;
				break;
			case "assistant-text-delta":
			case "assistant-reasoning-delta":
			case "assistant-media":
			case "tool-call-delta":
				this.turnHadOutput = true;
				break;
			case "assistant-message":
				this.turnMessage = event.message;
				this.finishReason = event.finishReason;
				break;
		}
	}

	/** Read once when the run ends; stops the idle check. */
	endProperties(): TelemetryProperties {
		this.dispose();
		const msSinceLastEvent = Date.now() - this.lastEventAt;
		this.recordGap();
		// A turn the runtime rejected before it reached history (an empty
		// response) still counts as the final turn, and as empty.
		const endedOn = this.turnMessage
			? messageShape(this.turnMessage)
			: !this.turnStarted
				? "none"
				: this.turnHadOutput
					? "unfinished"
					: "empty";
		// agent.* events carry no session or model of their own; these let a
		// run be grouped by model and paired with the user's next message.
		const { sessionId, isSubagent, providerId, modelId } = this.context;
		return {
			...(sessionId ? { sessionId } : {}),
			isSubagent,
			...(providerId ? { providerId } : {}),
			...(modelId ? { modelId } : {}),
			maxIdleMs: this.maxIdleMs,
			maxIdleAfter: this.maxIdleAfter,
			idleReported: this.idleReported,
			msSinceLastEvent,
			lastEventType: this.lastEventType,
			finishReason: this.finishReason,
			endedOn,
			// Only a text or empty final turn has a text signature (detector
			// parity); a media-only reply is not an empty one.
			...(endedOn === "empty" || endedOn === "assistant_text"
				? {
						textSignature: classifyFinalTurnText(
							this.turnMessage ? messageText(this.turnMessage) : "",
						),
					}
				: {}),
		};
	}

	dispose(): void {
		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private recordGap(): void {
		const now = Date.now();
		if (now - this.lastEventAt > this.maxIdleMs) {
			this.maxIdleMs = now - this.lastEventAt;
			this.maxIdleAfter = this.lastEventType;
		}
		this.lastEventAt = now;
	}

	/** One pending timer per run, re-armed from the last event rather than per event. */
	private scheduleIdleCheck(): void {
		const delayMs = this.lastEventAt + RUN_IDLE_REPORT_MS - Date.now();
		this.idleTimer = setTimeout(
			() => {
				const idleMs = Date.now() - this.lastEventAt;
				if (idleMs < RUN_IDLE_REPORT_MS) {
					this.scheduleIdleCheck();
					return;
				}
				this.idleReported = true;
				this.idleTimer = undefined;
				captureRunIdle(this.telemetry, {
					ulid: this.context.sessionId,
					agentId: this.agentId,
					runId: this.runId,
					idleMs,
					lastEventType: this.lastEventType,
					isSubagent: this.context.isSubagent,
				});
			},
			Math.max(delayMs, 0),
		);
		this.idleTimer.unref?.();
	}
}
