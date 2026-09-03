/**
 * ACP forwarder on the v2 frame stream (Phase 3b of the agent event
 * stream design). Implements the assembler's consumer API; each sink
 * emits the ACP SessionUpdate notifications the v1 translator emitted,
 * with stream structure owned by the assembler instead of implied by
 * event ordering.
 *
 * Fidelity contract (differential-tested against the v1
 * `forwardAgentEvent` reference in session-updates.ts):
 * - Empty text/reasoning deltas are skipped (v1 skipped empty chunks).
 * - Tool opens emit `tool_call` (pending) with title/kind/rawInput;
 *   closes emit `tool_call_update` with completed/failed and
 *   rawOutput (error message preferred, as in v1).
 * - Interrupted tool closes are silent: v1 never observed a dangling
 *   tool close, and an interrupted tool has no result to report.
 * - Errors, iterations, usage, and turn closes emit nothing (v1
 *   ignored them); recoverable errors arrive as notices and stay
 *   silent here.
 * - Media arrives whole and maps to image or text chunks (v1 logic).
 * - Sub-agent distinction: none — the ACP subscription delivers plain
 *   AgentEvents and v1 forwarded them all as top-level chunks, so the
 *   forwarder frames everything on the root path.
 */
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@cline/core";
import {
	StreamAssembler,
	type CloseFinal,
	type MediaFinal,
	type Outcome,
	type ReasoningStart,
	type SessionConsumer,
	type TextSink,
	type ReasoningSink,
	type ToolSink,
	type TurnConsumer,
} from "@cline/core";
import { SessionFramer } from "@cline/shared";
import { buildToolTitle, mapToolKind } from "./tool-utils";

/** Structural slice of AgentSideConnection the forwarder needs —
 * tests pass a capture; production passes the real connection. */
export interface AcpSessionUpdateSender {
	sessionUpdate(params: {
		sessionId: string;
		update: SessionUpdate;
	}): Promise<unknown>;
}

export class AcpStreamForwarder implements SessionConsumer {
	private readonly sender: AcpSessionUpdateSender;
	private readonly sessionId: string;
	private readonly framer = new SessionFramer();
	private readonly assembler: StreamAssembler;

	constructor(sender: AcpSessionUpdateSender, sessionId: string) {
		this.sender = sender;
		this.sessionId = sessionId;
		this.assembler = new StreamAssembler(this);
	}

	/** Frame and forward one agent event (the subscription callback). */
	pushEvent(event: AgentEvent): void {
		this.assembler.pushAll(this.framer.frameEvent(event));
	}

	private send(update: SessionUpdate): void {
		void this.sender.sessionUpdate({ sessionId: this.sessionId, update });
	}

	onTurn = (): TurnConsumer => ({
		onText: (): TextSink => ({
			onDelta: (text: string): void => {
				if (text !== "") {
					this.send({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text },
					});
				}
			},
			onAnnotation: (): void => {},
			onClose: (): void => {
				// v1 did not re-send final text (deltas already streamed).
			},
		}),
		onReasoning: (): ReasoningSink => ({
			onDelta: (reasoning: string): void => {
				if (reasoning !== "") {
					this.send({
						sessionUpdate: "agent_thought_chunk",
						content: { type: "text", text: reasoning },
					});
				}
			},
			onAnnotation: (): void => {},
			onClose: (): void => {},
		}),
		onTool: (start: {
			blockId: string;
			toolName: string;
			input: unknown;
		}): ToolSink => {
			// v1 emitted the pending tool_call at content_start; the open
			// is that moment on the frame stream.
			this.send({
				sessionUpdate: "tool_call",
				toolCallId: start.blockId,
				title: buildToolTitle(start.toolName, start.input),
				kind: mapToolKind(start.toolName),
				status: "pending",
				rawInput: start.input,
			});
			return {
				onProgress: (): void => {
					// v1 did not forward tool progress updates.
				},
				onAnnotation: (): void => {},
				onClose: (outcome: Outcome, final: CloseFinal): void => {
					if (outcome.kind === "interrupted" || outcome.kind === "detached") {
						return;
					}
					if (outcome.kind === "error") {
						this.send({
							sessionUpdate: "tool_call_update",
							toolCallId: start.blockId,
							status: "failed",
							rawOutput: outcome.error.message,
						});
						return;
					}
					this.send({
						sessionUpdate: "tool_call_update",
						toolCallId: start.blockId,
						status: "completed",
						rawOutput: final.type === "tool" ? final.output : undefined,
					});
				},
			};
		},
		onMedia: (media: MediaFinal): void => {
			const generated = media.media as {
				modality: string;
				mediaType: string;
				source: { type: string; data?: string; url?: string };
			};
			if (generated.modality === "image" && generated.source.type === "base64") {
				this.send({
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "image",
						data: generated.source.data ?? "",
						mimeType: generated.mediaType,
					},
				});
				return;
			}
			this.send({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `[Generated ${generated.modality}: ${generated.mediaType}]`,
				},
			});
		},
		onSubAgent: (): null => null,
		onNotice: (): void => {
			// v1 ignored notices and recoverable errors.
		},
		onUsage: (): void => {},
		onClose: (): void => {
			// v1 ignored done/error terminals.
		},
	});

	// The tool_call (pending) is emitted at open — v1 emitted it at
	// content_start — so the forwarder sends it when the sink is created,
	// which happens in onTool. Wrap creation to send the pending update.
	onSessionNotice(): void {}

	onIdle(): void {}

	onDiagnostic(diagnostic: { code: string; detail?: string }): void {
		// Protocol-visible repairs would corrupt the client stream;
		// diagnostics go to the process console.
		console.error(
			`[acp stream] ${diagnostic.code}${diagnostic.detail ? ` ${diagnostic.detail}` : ""}`,
		);
	}
}
