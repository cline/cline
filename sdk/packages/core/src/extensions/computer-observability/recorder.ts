import { nanoid } from "nanoid";
import type { ComputerUseClientEvent } from "../computer-use/client";
import {
	ARTIFACT_EVENT_VERSION,
	type ArtifactEventCorrelation,
	type ArtifactEventSink,
	type ArtifactEventSource,
	type ArtifactEventType,
	type ArtifactSinkStatus,
	type ComputerTaskArtifactEvent,
} from "./artifact-events";

/**
 * Assigns the artifact's client sequence and fans events into the sink.
 *
 * Observers sharing one recorder have a common host-event emission order.
 * The CLI records the driver transcript here and lets qbt journal native
 * computer actions separately; those actions are not in `clientSequence`.
 */
export class ComputerTaskArtifactRecorder {
	private nextSequence = 1;

	constructor(
		public readonly artifactId: string,
		private readonly sink: ArtifactEventSink,
	) {}

	record(input: {
		type: ArtifactEventType;
		source: ArtifactEventSource;
		payload: Record<string, unknown>;
		correlation?: ArtifactEventCorrelation;
		occurredAt?: number;
	}): ComputerTaskArtifactEvent {
		const event: ComputerTaskArtifactEvent = {
			version: ARTIFACT_EVENT_VERSION,
			artifactId: this.artifactId,
			eventId: `evt_${nanoid(12)}`,
			clientSequence: this.nextSequence++,
			occurredAt: new Date(input.occurredAt ?? Date.now()).toISOString(),
			source: input.source,
			...(input.correlation ? { correlation: input.correlation } : {}),
			type: input.type,
			payload: input.payload,
		};
		this.sink.emit(event);
		return event;
	}

	/**
	 * Optional `ComputerUseClientOptions.observer` adapter for a client's request
	 * lifecycle. Completed responses record only whether an image was present;
	 * this adapter does not upload images or create screenshot references.
	 * The CLI uses qbt's native action journal instead to avoid duplicate events.
	 */
	createComputerObserver(
		source: Omit<ArtifactEventSource, "kind">,
	): (event: ComputerUseClientEvent) => void {
		return (event) => {
			const correlation = { computerActionId: event.actionId };
			const src: ArtifactEventSource = { kind: "computer", ...source };
			switch (event.type) {
				case "action_requested":
					this.record({
						type: "computer.action_requested",
						source: src,
						correlation,
						occurredAt: event.at,
						payload: {
							action: event.request.action,
							coordinate: event.request.coordinate,
							startCoordinate: event.request.startCoordinate,
							// Deliberately omit `text`: typed text can contain
							// credentials. The host event shows that typing happened
							// and where, not what was typed.
							hasText: event.request.text !== undefined,
						},
					});
					break;
				case "action_completed":
					this.record({
						type: "computer.action_completed",
						source: src,
						correlation,
						occurredAt: event.at,
						payload: {
							ok: event.response.ok,
							durationMs: event.durationMs,
							hasImage: event.response.image !== undefined,
						},
					});
					break;
				case "action_failed":
					this.record({
						type: "computer.action_failed",
						source: src,
						correlation,
						occurredAt: event.at,
						payload: {
							error: event.error.message,
							durationMs: event.durationMs,
						},
					});
					break;
				case "action_cancelled":
					this.record({
						type: "computer.action_cancelled",
						source: src,
						correlation,
						occurredAt: event.at,
						payload: {
							reason: event.reason,
							durationMs: event.durationMs,
						},
					});
					break;
			}
		};
	}

	flush(): Promise<ArtifactSinkStatus> {
		return this.sink.flush();
	}
}
