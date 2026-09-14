/**
 * SdkFrameStream — Phase 3c part 1 of the agent event stream v2 design
 * (`sdk/packages/core/docs/agent-event-stream-design.md`): the producer
 * envelope wired into the VSCode host.
 *
 * The (epoch, seq) authority is the host's existing `MessageIdMinter`
 * — frames sample the SAME counter that stamps ClineMessage ids, so
 * frame seq, message ids, and state-snapshot versions share one total
 * order (the minter's documented rationale). The epoch fence therefore
 * already lives in the envelope: `fenceAndFlush()` emits closes for
 * open scopes at the CURRENT epoch, and the caller's existing
 * `minter.bumpEpoch()` (cancel / reinit / task-switch boundaries)
 * makes any later straggler frame stale for every frame consumer.
 *
 * The assembler's consumer here is a stream-health monitor (design,
 * verification gate 4): legal streams are silent; repairs are logged
 * and retained for debugging. The translator port (Phase 3c part 2)
 * replaces this consumer with the real ClineMessage sinks — the frame
 * source and fence wiring stay as built here.
 */

import type { CoreSessionEvent } from "@cline/core"
import { projectSessionEvent, type SessionConsumer, StreamAssembler, type TurnConsumer } from "@cline/core/frames"
import { type FrameSequencer, SessionFramer, type StreamFrame } from "@cline/shared"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"

/** Retained diagnostics, newest last, bounded for a long session. */
const MAX_RETAINED_DIAGNOSTICS = 100

class StreamHealthMonitor implements SessionConsumer {
	diagnostics: Array<{ code: string; detail?: string; seq?: number }> = []
	turnCount = 0

	onTurn(): TurnConsumer {
		this.turnCount += 1
		return this.makeConsumer()
	}

	/** Observe sub-agent streams, not prune them: a health monitor
	 * wants their scopes tracked (and cascade-closed) like the lead's. */
	private makeConsumer(): TurnConsumer {
		return {
			onText: () => ({ onDelta: () => {}, onAnnotation: () => {}, onClose: () => {} }),
			onReasoning: () => ({
				onDelta: () => {},
				onAnnotation: () => {},
				onClose: () => {},
			}),
			onTool: () => ({
				onProgress: () => {},
				onAnnotation: () => {},
				onClose: () => {},
			}),
			onMedia: () => {},
			onSubAgent: () => this.makeConsumer(),
			onNotice: () => {},
			onUsage: () => {},
			onClose: () => {},
		}
	}

	onSessionNotice(): void {}

	onIdle(): void {}

	onDiagnostic(diagnostic: { code: string; seq?: number; detail?: string }): void {
		this.diagnostics.push({
			code: diagnostic.code,
			seq: diagnostic.seq,
			detail: diagnostic.detail,
		})
		if (this.diagnostics.length > MAX_RETAINED_DIAGNOSTICS) {
			this.diagnostics.shift()
		}
		Logger.warn(
			`[SdkFrameStream] ${diagnostic.code}${diagnostic.detail ? ` ${diagnostic.detail}` : ""} (seq ${diagnostic.seq ?? "?"})`,
		)
	}
}

export class SdkFrameStream {
	private readonly framer: SessionFramer
	private readonly assembler: StreamAssembler
	private readonly monitor = new StreamHealthMonitor()

	constructor(minter: MessageIdMinter) {
		// Frames sample the minter's id counter — the same authority that
		// stamps ClineMessage identity — so one total order covers both.
		let lastSeq = 0
		const sequencer: FrameSequencer = {
			epoch: () => minter.epoch,
			nextSeq: () => {
				lastSeq = minter.nextId()
				return lastSeq
			},
			lastSeq: () => lastSeq,
			bumpEpoch: () => {
				minter.bumpEpoch()
			},
		}
		this.framer = new SessionFramer({ sequencer })
		this.assembler = new StreamAssembler(this.monitor)
	}

	/** Feed one CoreSessionEvent: project to agent paths, frame, push. */
	handleSessionEvent(event: CoreSessionEvent): void {
		for (const projected of projectSessionEvent(event)) {
			const frames = this.framer.frameRoutedEvent(projected.agentPath, projected.event)
			this.pushFrames(frames)
		}
	}

	/**
	 * Host fence (cancel / reinit / task switch): emit closes for open
	 * scopes at the CURRENT epoch. The caller's existing
	 * `minter.bumpEpoch()` then fences later stragglers — the envelope
	 * carries the fence (design P4), so the translator's private
	 * straggler-dropping becomes every frame consumer's stale-epoch drop.
	 */
	fenceAndFlush(): void {
		this.pushFrames(this.framer.fence())
	}

	/** Scopes still open — the live set, for debugging and state views. */
	openScopes(): { turnPaths: string[]; blocks: string[] } {
		return this.assembler.openScopes()
	}

	/** Retained stream-health diagnostics (legal streams stay empty). */
	get streamDiagnostics(): ReadonlyArray<{
		code: string
		detail?: string
		seq?: number
	}> {
		return this.monitor.diagnostics
	}

	private pushFrames(frames: readonly StreamFrame[]): void {
		this.assembler.pushAll(frames)
	}
}
