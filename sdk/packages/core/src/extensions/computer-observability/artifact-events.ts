/**
 * Artifact event contract for computer-use task observability.
 *
 * One append-only event stream captures everything needed to replay a
 * computer-use task: both transcripts (driver and computer user), helper
 * notes/questions, computer actions with their screenshots, and coordinator
 * state transitions. Events are emitted live while the task runs and shipped
 * to an artifact ingress (the qwanban observatory's `observed` channel is the
 * seed of that ingress); they are never reconstructed later from logs.
 *
 * Ordering and identity:
 * - `clientSequence` is the emission order assigned by the VM-side recorder.
 *   The ingress assigns its own durable sequence on acknowledgement.
 * - `eventId` makes retries idempotent.
 * - `correlation.computerActionId` ties a tool call to its backend action and
 *   screenshot (see `ComputerUseClientEvent.actionId`).
 * - `correlation.parentEventId` chains helper question → driver injection →
 *   driver reply.
 *
 * Payloads carry blob references (`ArtifactBlobRef`), never inline image
 * bytes: screenshots are content-addressed so the backend stores each image
 * once regardless of how many events reference it.
 */

/** Bump when the event envelope shape changes incompatibly. */
export const ARTIFACT_EVENT_VERSION = 1;

/** Content-addressed reference to a stored blob (screenshot, large output). */
export interface ArtifactBlobRef {
	/** e.g. "sha256:abc123..." */
	digest: string;
	mediaType: string;
	sizeBytes?: number;
}

export type ArtifactEventSourceKind =
	| "driver"
	| "computer_user"
	| "computer"
	| "coordinator";

export interface ArtifactEventSource {
	kind: ArtifactEventSourceKind;
	sessionId?: string;
	runId?: string;
}

export interface ArtifactEventCorrelation {
	parentEventId?: string;
	toolCallId?: string;
	computerActionId?: string;
}

export type ArtifactEventType =
	| "session.started"
	| "session.ended"
	| "transcript.message_committed"
	| "helper.note"
	| "helper.question"
	| "helper.status_changed"
	| "helper.possibly_stuck"
	| "computer.action_requested"
	| "computer.action_completed"
	| "computer.action_failed"
	| "computer.action_cancelled"
	| "computer.screenshot_captured"
	| "artifact.degraded";

export interface ComputerTaskArtifactEvent {
	version: typeof ARTIFACT_EVENT_VERSION;
	artifactId: string;
	eventId: string;
	/** Emission order assigned by the VM-side recorder; gap-free per artifact. */
	clientSequence: number;
	/** ISO-8601 wall-clock time of the underlying occurrence. */
	occurredAt: string;
	source: ArtifactEventSource;
	correlation?: ArtifactEventCorrelation;
	type: ArtifactEventType;
	payload: Record<string, unknown>;
	/** Blob references extracted from the payload, for ingress prefetching. */
	blobs?: ArtifactBlobRef[];
}

/**
 * Recorder-side view of the sink that receives events. Implementations ship
 * to the artifact ingress; `emit` must be non-blocking for the caller (queue
 * internally) so recording can never delay a computer action or model turn.
 */
export interface ArtifactEventSink {
	emit(event: ComputerTaskArtifactEvent): void;
	/**
	 * Resolves once all previously emitted events are durably acknowledged
	 * or the sink has entered a degraded state. Used at task end to decide
	 * the manifest's completeness status.
	 */
	flush(): Promise<ArtifactSinkStatus>;
}

export interface ArtifactSinkStatus {
	status: "complete" | "degraded";
	lastClientSequence: number;
	lastAcknowledgedSequence: number;
}
