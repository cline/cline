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
 * The assembler's consumer here is the FrameMessageBridge — the
 * ClineMessage sinks that will replace the v1 translator at switchover.
 * Until then it runs shadow-only: its rows are drained and discarded
 * (parity with the v1 translator is differential-test locked), while its
 * diagnostics are logged and retained exactly as the health monitor's
 * were (legal streams stay silent; repairs surface as warnings).
 */

import type { CoreSessionEvent } from "@cline/core"
import { projectSessionEvent, StreamAssembler } from "@cline/core/frames"
import { type FrameSequencer, SessionFramer, type StreamFrame } from "@cline/shared"
import { FrameMessageBridge } from "./frame-message-bridge"
import { MessageIdMinter } from "./message-id-minter"

export class SdkFrameStream {
	private readonly framer: SessionFramer
	private readonly assembler: StreamAssembler
	private readonly bridge: FrameMessageBridge

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
		this.bridge = new FrameMessageBridge({
			// Same id authority as the v1 translator state; the retag/cwd
			// getters are wired at switchover (shadow rows are discarded).
			nextTs: () => minter.nextId(),
		})
		this.assembler = new StreamAssembler(this.bridge)
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
		return this.bridge.diagnostics
	}

	private pushFrames(frames: readonly StreamFrame[]): void {
		this.assembler.pushAll(frames)
		// Shadow run: the v1 translator remains the production ClineMessage
		// source, so the bridge's rows are drained and discarded here.
		this.bridge.takeMessages()
	}
}
