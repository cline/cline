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

/**
 * An `ArtifactEventSink` that publishes each event into the computer-use
 * backend's journal (a `publish_event` request per event, `kind` = the
 * artifact event type). The backend assigns the journal order and fans the
 * event out to observatory clients.
 *
 * `emit` never blocks the caller: sends are chained on an internal queue so
 * events reach the journal in emission order, and a failed send degrades the
 * sink without breaking the action path. Once degraded the sink stays
 * degraded — the journal has a gap the observatory cannot repair, so
 * `flush()` reports it rather than pretending completeness.
 */
export function createJournalEventSink(
	transport: JournalPublishTransport,
): ArtifactEventSink {
	let queue: Promise<void> = Promise.resolve();
	let lastClientSequence = 0;
	let lastAcknowledgedSequence = 0;
	let degraded = false;

	return {
		emit(event: ComputerTaskArtifactEvent): void {
			lastClientSequence = event.clientSequence;
			queue = queue.then(async () => {
				try {
					const response = await transport.send({
						action: PUBLISH_EVENT_ACTION,
						kind: event.type,
						payload: event,
					});
					if (response.ok) {
						lastAcknowledgedSequence = event.clientSequence;
					} else {
						degraded = true;
					}
				} catch {
					degraded = true;
				}
			});
		},
		async flush(): Promise<ArtifactSinkStatus> {
			await queue;
			return {
				status: degraded ? "degraded" : "complete",
				lastClientSequence,
				lastAcknowledgedSequence,
			};
		},
	};
}
