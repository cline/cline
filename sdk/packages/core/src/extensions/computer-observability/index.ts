/**
 * Computer-use task observability.
 *
 * A shared artifact recorder assigns one total order (`clientSequence`)
 * across driver-transcript, helper-transcript, computer-action, and
 * coordinator events so an off-VM viewer can replay the task as a
 * synchronized timeline. The event contract lives in ./artifact-events.ts;
 * the qwanban observatory (`qbt/src/observed.rs` + `observatory/`) is the
 * ingress this stream is designed to feed.
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
export { ComputerTaskArtifactRecorder } from "./recorder";
