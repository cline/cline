/**
 * The pure frame-toolkit surface of @cline/core: the stream assembler,
 * the session-event projector, and their types. Deliberately free of
 * the heavy index's imports (node services, hub transports) so
 * consumers — and test harnesses aliasing around the main entry — can
 * load it cheaply. Mirrors the subpath-export pattern of
 * `@cline/shared/storage`.
 */
export {
	DIAG_AFTER_SESSION_END,
	DIAG_ANNOTATION_UNROUTED,
	DIAG_BLOCK_OPEN_WHILE_OPEN,
	DIAG_ORPHAN_BLOCK_FRAME,
	DIAG_SNAPSHOT_UNROUTED,
	DIAG_STALE_EPOCH,
	DIAG_SUBAGENT_WITHOUT_TURN,
	DIAG_TURN_CLOSE_WITHOUT_OPEN,
	DIAG_TURN_OPEN_WHILE_OPEN,
	StreamAssembler,
} from "./runtime/orchestration/stream-assembler"
export type {
	MediaFinal,
	ReasoningSink,
	SessionConsumer,
	StreamDiagnostic,
	TextSink,
	ToolSink,
	TurnConsumer,
} from "./runtime/orchestration/stream-assembler"
export type { ProjectedAgentEvent } from "./runtime/orchestration/session-event-projector"
export { projectSessionEvent } from "./runtime/orchestration/session-event-projector"
