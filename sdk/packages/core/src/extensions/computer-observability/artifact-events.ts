/**
 * Artifact event contract for computer-use task observability.
 *
 * Host events carry transcript previews and run status to qbt's bounded,
 * in-memory journal. Qbt journals computer actions and screenshots separately;
 * its observatory reads the combined recent timeline. Events can be dropped
 * or evicted, and a backend restart loses the journal: this is best-effort
 * live observation, not a durable task archive.
 *
 * Ordering and identity:
 * - `clientSequence` orders events from one recorder, not qbt's native events.
 *   Qbt assigns a separate journal sequence; its publish acknowledgement
 *   reports acceptance, not that sequence or durable storage.
 * - `eventId` identifies a host event. Qbt does not deduplicate by this ID,
 *   and the journal sink does not retry failed publishes.
 * - `correlation.computerActionId` pairs optional client-observer lifecycle
 *   events. It is not sent with native actions or linked to qbt screenshots.
 * - `correlation.parentEventId` links related events.
 *
 * Built-in observers omit image bytes and do not populate blob references.
 * Qbt retains screenshots under journal-sequence IDs, not content digests.
 * Custom producers may supply blob references with their own storage.
 */

/** Bump when the event envelope shape changes incompatibly. */
export const ARTIFACT_EVENT_VERSION = 1;

/** Optional content-addressed reference for producers managing their own blobs. */
export interface ArtifactBlobRef {
	/** e.g. "sha256:abc123..." */
	digest: string;
	mediaType: string;
	sizeBytes?: number;
}

export type ArtifactEventSourceKind = "driver" | "computer";

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
	| "session.status_changed"
	| "transcript.message_committed"
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
	/** Gap-free emission order within one recorder; delivery can have gaps. */
	clientSequence: number;
	/** ISO-8601 wall-clock time of the underlying occurrence. */
	occurredAt: string;
	source: ArtifactEventSource;
	correlation?: ArtifactEventCorrelation;
	type: ArtifactEventType;
	payload: Record<string, unknown>;
	/** Optional producer-supplied references; the journal sink does not fetch them. */
	blobs?: ArtifactBlobRef[];
}

/**
 * Recorder-side view of the sink that receives events. `emit` must be
 * non-blocking for the caller (queue internally). Hosts can await `flush`
 * separately when they need a publish barrier before a computer action.
 */
export interface ArtifactEventSink {
	emit(event: ComputerTaskArtifactEvent): void;
	/**
	 * Resolves once events emitted before this call have been acknowledged
	 * or the sink has entered a degraded state. "complete" reports publish
	 * acceptance, not durable storage, continued retention, or a stopped drain.
	 */
	flush(): Promise<ArtifactSinkStatus>;
}

export interface ArtifactSinkStatus {
	status: "complete" | "degraded";
	/** Recorder sequence at the flush barrier. */
	lastClientSequence: number;
	/** Latest accepted recorder sequence, not qbt's journal sequence. */
	lastAcknowledgedSequence: number;
}
