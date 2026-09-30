import type { ComputerUseResponse } from "../computer-use/protocol";
import { PUBLISH_EVENT_ACTION } from "../computer-use/protocol";
import type {
	ArtifactEventSink,
	ArtifactSinkStatus,
	ComputerTaskArtifactEvent,
} from "./artifact-events";

/**
 * The slice of `ComputerUseClient` the sink needs. Structural, so tests can
 * supply a fake without opening sockets.
 */
export interface JournalPublishTransport {
	send(request: {
		action: typeof PUBLISH_EVENT_ACTION;
		kind: string;
		payload: unknown;
	}): Promise<ComputerUseResponse>;
}

const MAX_PENDING_EVENTS = 500;

/**
 * An `ArtifactEventSink` that publishes each event into the computer-use
 * backend's journal (a `publish_event` request per event, `kind` = the
 * artifact event type). The backend assigns the journal order and fans the
 * event out to observatory clients.
 *
 * `emit` never blocks the caller: a bounded queue sends events in emission
 * order. If more than 500 events wait, the oldest unsent events are dropped.
 * A failed or dropped send degrades the sink without breaking the action path;
 * `flush()` reports the gap rather than pretending completeness.
 */
export function createJournalEventSink(
	transport: JournalPublishTransport,
): ArtifactEventSink {
	const pending: ComputerTaskArtifactEvent[] = [];
	let drainPromise: Promise<void> | undefined;
	let lastClientSequence = 0;
	let lastAcknowledgedSequence = 0;
	let degraded = false;
	const flushWaiters = new Set<() => void>();

	const wakeFlushWaiters = (): void => {
		for (const wake of flushWaiters) wake();
		flushWaiters.clear();
	};

	const markDegraded = (): void => {
		degraded = true;
		wakeFlushWaiters();
	};

	const startDrain = (): void => {
		if (drainPromise) {
			return;
		}
		drainPromise = (async () => {
			while (pending.length > 0) {
				const event = pending.shift();
				if (!event) {
					continue;
				}
				try {
					const response = await transport.send({
						action: PUBLISH_EVENT_ACTION,
						kind: event.type,
						payload: event,
					});
					if (response.ok) {
						lastAcknowledgedSequence = event.clientSequence;
						wakeFlushWaiters();
					} else {
						markDegraded();
					}
				} catch {
					markDegraded();
				}
			}
		})().finally(() => {
			drainPromise = undefined;
			if (pending.length > 0) {
				startDrain();
			}
		});
	};

	return {
		emit(event: ComputerTaskArtifactEvent): void {
			lastClientSequence = event.clientSequence;
			pending.push(event);
			if (pending.length > MAX_PENDING_EVENTS) {
				pending.splice(0, pending.length - MAX_PENDING_EVENTS);
				markDegraded();
			}
			startDrain();
		},
		async flush(): Promise<ArtifactSinkStatus> {
			// Snapshot the barrier at call time. Later emissions belong to a later
			// flush and cannot extend this wait indefinitely.
			const barrierSequence = lastClientSequence;
			while (!degraded && lastAcknowledgedSequence < barrierSequence) {
				await new Promise<void>((resolve) => flushWaiters.add(resolve));
			}
			return {
				status: degraded ? "degraded" : "complete",
				lastClientSequence: barrierSequence,
				lastAcknowledgedSequence,
			};
		},
	};
}
