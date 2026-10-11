/**
 * Computer-use task observability.
 *
 * A recorder orders host events with `clientSequence`. The journal sink sends
 * them to qbt, whose separate sequence combines them with native computer
 * actions and screenshots for the observatory's recent timeline. The journal
 * is bounded and in-memory; acknowledgements do not guarantee durable replay.
 * The event contract lives in ./artifact-events.ts.
 */
export {
	ARTIFACT_EVENT_VERSION,
	type ArtifactBlobRef,
	type ArtifactEventCorrelation,
	type ArtifactEventSink,
	type ArtifactEventSource,
	type ArtifactEventSourceKind,
	type ArtifactEventType,
	type ArtifactSinkStatus,
	type ComputerTaskArtifactEvent,
} from "./artifact-events";
export {
	createJournalEventSink,
	type JournalEventSink,
	type JournalPublishTransport,
} from "./journal-sink";
export { ComputerTaskArtifactRecorder } from "./recorder";
export { createTranscriptRecordingHooks } from "./transcript-observer";
