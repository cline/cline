import { z } from "zod";

/**
 * On-disk recording a session writes when recording is enabled, under
 * `<sessions-dir>/<session-id>/recording/`:
 *
 * ```
 * recording.json    SessionRecordingHeader (one segment per host start)
 * requests.jsonl    one SessionRecordedModelCall per model call
 * blobs.jsonl       one SessionRecordedBlob per distinct request part
 * events.jsonl      one SessionRecordedEvent per decision/runtime event
 * ```
 *
 * Every line in `requests.jsonl` and `events.jsonl`, and every hook audit
 * line written while recording, carries `seq`: one counter per session, so
 * records from all three streams interleave into a single total order.
 * Order by `seq`, not by file position.
 */

export const SESSION_RECORDING_FORMAT = "cline.session-recording";
export const SESSION_RECORDING_VERSION = 1;
export const SESSION_RECORDING_DIR = "recording";
export const SESSION_RECORDING_FILES = {
	header: "recording.json",
	requests: "requests.jsonl",
	blobs: "blobs.jsonl",
	events: "events.jsonl",
} as const;

/** Version tag folded into {@link SessionRecordedModelCall.request.matchKey}. */
export const SESSION_RECORDING_MATCH_KEY_VERSION = "cline-replay-match-v1";

export const SESSION_RECORDING_BLOB_KINDS = [
	"system-prompt",
	"tools",
	"model-tools",
	"message",
] as const;
export type SessionRecordingBlobKind =
	(typeof SESSION_RECORDING_BLOB_KINDS)[number];

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const SessionRecordingSegmentSchema = z.object({
	startedAt: z.string().min(1),
	pid: z.number().int(),
	/** Lead agent of the session; root hook audit lines carry this agent id. */
	leadAgentId: z.string().min(1).nullable(),
	/** Transcript messages that existed before this segment started. */
	initialMessageCount: z.number().int().nonnegative(),
	/** First `seq` assigned in this segment. */
	firstSeq: z.number().int().nonnegative(),
	mode: z.string().nullable(),
	cwd: z.string(),
	host: z.object({
		platform: z.string(),
		arch: z.string(),
		node: z.string(),
	}),
	/** Allowlisted environment variables the session's commands inherited. */
	env: z.record(z.string(), z.string()),
	envSha256: Sha256Schema,
	toolPolicies: z.record(z.string(), z.unknown()).optional(),
});
export type SessionRecordingSegment = z.infer<
	typeof SessionRecordingSegmentSchema
>;

export const SessionRecordingHeaderSchema = z.object({
	format: z.literal(SESSION_RECORDING_FORMAT),
	version: z.literal(SESSION_RECORDING_VERSION),
	sessionId: z.string().min(1),
	createdAt: z.string().min(1),
	segments: z.array(SessionRecordingSegmentSchema).min(1),
});
export type SessionRecordingHeader = z.infer<
	typeof SessionRecordingHeaderSchema
>;

export const SessionRecordedBlobSchema = z.object({
	sha256: Sha256Schema,
	kind: z.enum(SESSION_RECORDING_BLOB_KINDS),
	/** sha256 of `[role, content]` for messages; feeds the match key. */
	contentSha256: Sha256Schema.optional(),
	value: z.unknown(),
});
export type SessionRecordedBlob = z.infer<typeof SessionRecordedBlobSchema>;

export const SessionRecordedModelEventSchema = z.object({
	/** Milliseconds since the model call started. */
	t: z.number().nonnegative(),
	event: z.record(z.string(), z.unknown()),
});

export const SESSION_RECORDED_MODEL_CALL_OUTCOMES = [
	"completed",
	"interrupted",
	"error",
	"aborted",
] as const;

export const SessionRecordedModelCallSchema = z.object({
	/** 0-based position among the session's model calls. */
	callIndex: z.number().int().nonnegative(),
	seq: z.number().int().nonnegative(),
	sessionId: z.string().min(1),
	agentId: z.string().min(1),
	runId: z.string().nullable(),
	iteration: z.number().int().nonnegative(),
	/** 0-based position among the model calls of this run and iteration. */
	attempt: z.number().int().nonnegative(),
	startedAt: z.string().min(1),
	finishedAt: z.string().min(1),
	durationMs: z.number().nonnegative(),
	/** Compaction state the host had in force when the request was issued. */
	compaction: z
		.object({
			id: z.string().nullable(),
			sourceMessageCount: z.number().int().nonnegative(),
			updatedAt: z.string(),
		})
		.nullable(),
	request: z.object({
		/**
		 * sha256 over the request's system prompt, tool definitions and message
		 * `[role, content]` pairs; ids, timestamps and metadata are excluded.
		 * See SESSION_RECORDING_MATCH_KEY_VERSION.
		 */
		matchKey: Sha256Schema,
		systemPromptSha256: Sha256Schema.nullable(),
		toolsSha256: Sha256Schema,
		modelToolsSha256: Sha256Schema.nullable(),
		/** Number of messages in the request. */
		messageCount: z.number().int().nonnegative(),
		/**
		 * The request's first `count` messages are the first `count` messages
		 * of the earlier call `callIndex`. Null when nothing is shared with the
		 * previous call (first call of a host start, or after compaction).
		 * Resolve with `resolveRecordedRequestMessages` from `@cline/replay`.
		 */
		messagePrefix: z
			.object({
				callIndex: z.number().int().nonnegative(),
				count: z.number().int().positive(),
			})
			.nullable(),
		/**
		 * The request's messages after `messagePrefix`, in order; each names a
		 * `message` blob holding the message without its per-request `id` and
		 * `createdAt`.
		 */
		messageSha256s: z.array(Sha256Schema),
		options: z.record(z.string(), z.unknown()).nullable(),
		/** Connection settings in force; never carries credentials or header values. */
		provider: z.record(z.string(), z.unknown()),
	}),
	response: z.object({
		outcome: z.enum(SESSION_RECORDED_MODEL_CALL_OUTCOMES),
		finishReason: z.string().nullable(),
		requestId: z.string().nullable(),
		error: z.string().nullable(),
		/**
		 * Assistant message the runtime assembled from this call. Calls the
		 * runtime later discarded (retried attempts) keep their id but it never
		 * reaches the transcript.
		 */
		messageId: z.string().nullable(),
		toolCallIds: z.array(z.string()),
		usage: z.record(z.string(), z.unknown()).nullable(),
		/** The model stream as the runtime received it. */
		events: z.array(SessionRecordedModelEventSchema),
	}),
});
export type SessionRecordedModelCall = z.infer<
	typeof SessionRecordedModelCallSchema
>;

export const SESSION_RECORDED_EVENT_KINDS = ["decision", "runtime"] as const;

export const SessionRecordedEventSchema = z.object({
	seq: z.number().int().nonnegative(),
	ts: z.string().min(1),
	kind: z.enum(SESSION_RECORDED_EVENT_KINDS),
	name: z.string().min(1),
	sessionId: z.string().min(1),
	agentId: z.string().nullable(),
	iteration: z.number().int().nonnegative().optional(),
	toolCallId: z.string().min(1).optional(),
	/** Correlation ids kept out of the payload so export redaction keeps them. */
	refs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	payload: z.record(z.string(), z.unknown()),
});
export type SessionRecordedEvent = z.infer<typeof SessionRecordedEventSchema>;
