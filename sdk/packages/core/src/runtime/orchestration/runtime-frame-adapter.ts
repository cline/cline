/**
 * Dual-emit wrapper for the v1→v2 migration (Phase 1 of the agent event
 * stream v2 design). Wraps — does not modify — `RuntimeEventAdapter`:
 * every v1 consumer keeps its byte-identical event stream, and v2
 * consumers get frames produced from the same adapter output by the
 * shared `AgentEventFramer`.
 *
 * The first frame consumer (the CLI port) lands in Phase 2; this class
 * exists now so the producer side of the contract is pinned by tests
 * before any consumer ports.
 */
import type { AgentEvent, AgentRuntimeEvent } from "@cline/shared";
import { AgentEventFramer, type StreamFrame } from "@cline/shared";
import { RuntimeEventAdapter } from "./runtime-event-adapter";

export interface RuntimeFrameAdapterOptions {
	/** Passed to the framer; defaults to ["root"]. */
	agentPath?: string[];
	/** Passed to the framer; defaults to 0. */
	startEpoch?: number;
}

export class RuntimeFrameAdapter extends RuntimeEventAdapter {
	private readonly framer: AgentEventFramer;

	constructor(options: RuntimeFrameAdapterOptions = {}) {
		super();
		this.framer = new AgentEventFramer({
			...(options.agentPath !== undefined
				? { agentPath: options.agentPath }
				: {}),
			...(options.startEpoch !== undefined
				? { startEpoch: options.startEpoch }
				: {}),
		});
	}

	/**
	 * The host's conversation fence (task switch, cancel, reinit).
	 */
	bumpEpoch(): void {
		this.framer.bumpEpoch();
	}

	/**
	 * Run boundary. The parent's reset() clears its v1 bookkeeping; the
	 * framer's open scopes — which can only exist when the host fences a
	 * run that never reached a v1 terminal — are closed with
	 * `interrupted` here, and the frames are returned so the host can
	 * flush them before the next run's events. A host cancel boundary
	 * should also call bumpEpoch().
	 */
	override reset(): StreamFrame[] {
		super.reset();
		return this.framer.fence();
	}

	/**
	 * Translate one runtime event into both representations. The
	 * `events` array is exactly what the plain adapter returns — that
	 * equality is asserted by test, not by convention.
	 */
	translateWithFrames(
		event: AgentRuntimeEvent,
	): { events: AgentEvent[]; frames: StreamFrame[] } {
		const events = this.translate(event);
		return { events, frames: this.frameEvents(events) };
	}

	/** Frame already-translated v1 events (e.g. replayed history). */
	frameEvents(events: readonly AgentEvent[]): StreamFrame[] {
		return this.framer.frameAll(events);
	}
}
