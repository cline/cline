import { type MessageWithMetadata, SESSION_STATUS_VALUES } from "@cline/shared";
import { z } from "zod";
import { SessionCompactionStateSchema } from "../models/session-compaction";
import {
	SessionRecordedBlobSchema,
	SessionRecordingSegmentSchema,
} from "./recording-schema";

/**
 * Session replay bundle format, schema version 2.
 *
 * A bundle is a self-describing directory:
 *
 * ```
 * <bundle>/
 *   manifest.json                     SessionReplayBundleManifest
 *   redaction.json                    SessionReplayRedactionReport
 *   sessions/<encoded-session-id>/
 *     transcript.json                 SessionReplayTranscriptFile
 *     events.jsonl                    one SessionReplayEvent per line
 *     compaction.json                 SessionCompactionState (optional)
 *     requests/requests.jsonl         one SessionRecordedModelCall per model call (recorded sessions)
 *     requests/blobs.jsonl            one SessionReplayRequestBlob per distinct request part (recorded sessions)
 * ```
 *
 * `sessions[].iterations` reserves per-iteration restore points (checkpoint
 * ref and compaction state) next to the per-run `sessions[].checkpoints`.
 *
 * Readers must locate files through `manifest.files`, not by deriving paths.
 * The manifest lists every session of the bundle as a flat array linked by
 * `parentSessionId`, so one bundle can carry a whole team/subagent tree.
 *
 * Version 2 adds recordings: `sessions[].recording`, the `request` and
 * `request-blobs` files, `runtime` and `decision` events, and `seq`/`refs` on
 * events. Version 1 bundles migrate with `recording: null`.
 */

export const SESSION_REPLAY_BUNDLE_FORMAT = "cline.session-replay-bundle";
export const SESSION_REPLAY_BUNDLE_SCHEMA_VERSION = 2;
export const SESSION_REPLAY_MANIFEST_FILE = "manifest.json";
export const SESSION_REPLAY_REDACTION_FILE = "redaction.json";

export const SESSION_REPLAY_FILE_KINDS = [
	"transcript",
	"events",
	"compaction",
	"redaction-report",
	/** Per-model-call request/response records (ndjson). */
	"request",
	/** Content-addressed request parts the records point at (ndjson). */
	"request-blobs",
	// Reserved for later schema versions; no writer emits these yet.
	"cassette",
	"environment",
] as const;
export type SessionReplayFileKind = (typeof SESSION_REPLAY_FILE_KINDS)[number];

export const SESSION_REPLAY_EVENT_KINDS = [
	"hook",
	/** Human or host decisions: approvals, mode switches, prompt delivery, aborts. */
	"decision",
	/** Lead-agent runtime milestones: runs, turns, model calls, tool start/finish. */
	"runtime",
] as const;
export type SessionReplayEventKind =
	(typeof SESSION_REPLAY_EVENT_KINDS)[number];

export const SESSION_REPLAY_SESSION_ROLES = [
	"root",
	"subagent",
	"teammate",
] as const;
export type SessionReplaySessionRole =
	(typeof SESSION_REPLAY_SESSION_ROLES)[number];

export const SESSION_REPLAY_EVENT_SOURCES = [
	"session-log",
	"global-log",
	"none",
] as const;

const SafeRelativePathSchema = z
	.string()
	.min(1)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.includes("\\") &&
			!/^[A-Za-z]:/.test(value) &&
			value.split("/").every((part) => part !== ".." && part !== "."),
		{ message: "must be a relative POSIX path inside the bundle" },
	);

export const SessionReplayFileEntrySchema = z.object({
	path: SafeRelativePathSchema,
	kind: z.enum(SESSION_REPLAY_FILE_KINDS),
	sessionId: z.string().min(1).optional(),
	mediaType: z.enum(["application/json", "application/x-ndjson"]),
	bytes: z.number().int().nonnegative(),
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	/** Number of records (messages, events) when the file holds a list. */
	entries: z.number().int().nonnegative().optional(),
});
export type SessionReplayFileEntry = z.infer<
	typeof SessionReplayFileEntrySchema
>;

export const SessionReplaySessionRecordingSchema = z.object({
	/** `SESSION_RECORDING_VERSION` of the recording the bundle was built from. */
	version: z.number().int().positive(),
	/** One entry per host start that recorded; env values are redacted. */
	segments: z.array(SessionRecordingSegmentSchema).min(1),
	counts: z.object({
		modelCalls: z.number().int().nonnegative(),
		blobs: z.number().int().nonnegative(),
		decisions: z.number().int().nonnegative(),
		runtimeEvents: z.number().int().nonnegative(),
	}),
	/**
	 * How the transcript's assistant messages map onto request records.
	 * Messages from before the first segment are not expected to have one.
	 */
	coverage: z.object({
		assistantMessages: z.number().int().nonnegative(),
		preRecording: z.number().int().nonnegative(),
		linked: z.number().int().nonnegative(),
		unlinkedMessageIds: z.array(z.string()),
	}),
});
export type SessionReplaySessionRecording = z.infer<
	typeof SessionReplaySessionRecordingSchema
>;

export const SessionReplayCheckpointRefSchema = z.object({
	ref: z.string().min(1),
	kind: z.enum(["stash", "commit"]).optional(),
	runCount: z.number().int().nonnegative(),
	createdAt: z.number(),
});
export type SessionReplayCheckpointRef = z.infer<
	typeof SessionReplayCheckpointRefSchema
>;

export const SESSION_REPLAY_CHECKPOINT_CAPTURES = [
	// Captured right before this iteration's model call, so it is the
	// workspace as it was before the iteration's tools ran.
	"iteration-start",
	// The checkpoint of the user run the iteration belongs to, captured before
	// the run's first iteration. Changes made by earlier iterations of the same
	// run are not reflected.
	"run-start",
] as const;
export type SessionReplayCheckpointCapture =
	(typeof SESSION_REPLAY_CHECKPOINT_CAPTURES)[number];

/**
 * The workspace checkpoint and model context in force before one iteration's
 * tools ran, so a later replay mode can restore them for `--from N`.
 *
 * v1 exporters fill `checkpoint` from per-run refs (`iteration-start` for a
 * run's first iteration, `run-start` for the rest) and never write
 * `compaction`; recording both for every iteration is left to a later phase.
 * An iteration without an entry has no recorded restore point.
 */
export const SessionReplayIterationRestorePointSchema = z.object({
	/** 1-based iteration index, matching `SessionReplayIteration.index`. */
	index: z.number().int().positive(),
	checkpoint: SessionReplayCheckpointRefSchema.extend({
		capture: z.enum(SESSION_REPLAY_CHECKPOINT_CAPTURES),
	}).optional(),
	/** Compaction state the iteration's model call was made with. */
	compaction: z
		.object({
			/** Compaction file in `manifest.files` holding the state. */
			file: SafeRelativePathSchema.optional(),
			/** Identity of the state, e.g. its `source_prefix_hash`. */
			stateId: z.string().min(1).optional(),
		})
		.refine(
			(value) => value.file !== undefined || value.stateId !== undefined,
			{
				message: "needs a file or a stateId",
			},
		)
		.optional(),
});
export type SessionReplayIterationRestorePoint = z.infer<
	typeof SessionReplayIterationRestorePointSchema
>;

export const SessionReplaySessionEntrySchema = z.object({
	sessionId: z.string().min(1),
	role: z.enum(SESSION_REPLAY_SESSION_ROLES),
	parentSessionId: z.string().min(1).nullable(),
	agentId: z.string().min(1).nullable(),
	parentAgentId: z.string().min(1).nullable(),
	conversationId: z.string().min(1).nullable(),
	/** Session source: `cli`, `automation`, `subagent`, ... (open set). */
	source: z.string().min(1),
	status: z.enum(SESSION_STATUS_VALUES),
	exitCode: z.number().int().nullable(),
	startedAt: z.string().min(1),
	endedAt: z.string().min(1).nullable(),
	interactive: z.boolean(),
	provider: z.string(),
	model: z.string(),
	cwd: z.string(),
	workspaceRoot: z.string(),
	team: z.object({ name: z.string().min(1) }).nullable(),
	/** Per-run checkpoint refs, as recorded in session metadata. */
	checkpoints: z.array(SessionReplayCheckpointRefSchema),
	/** Per-iteration restore points, ordered by strictly increasing index. */
	iterations: z
		.array(SessionReplayIterationRestorePointSchema)
		.refine(
			(points) =>
				points.every(
					(point, position) => point.index > (points[position - 1]?.index ?? 0),
				),
			{ message: "iteration indexes must be strictly increasing" },
		)
		.optional(),
	title: z.string().optional(),
	/** Free-form session metadata, after redaction. */
	metadata: z.record(z.string(), z.unknown()).optional(),
	/** Where `events.jsonl` was sourced from at export time. */
	eventsSource: z.enum(SESSION_REPLAY_EVENT_SOURCES),
	counts: z.object({
		messages: z.number().int().nonnegative(),
		/** Assistant messages, i.e. model calls. */
		iterations: z.number().int().nonnegative(),
		events: z.number().int().nonnegative(),
	}),
	/** The session's recording, or null when it was not recorded. */
	recording: SessionReplaySessionRecordingSchema.nullable(),
});
export type SessionReplaySessionEntry = z.infer<
	typeof SessionReplaySessionEntrySchema
>;

export const SessionReplayBundleManifestSchema = z.object({
	format: z.literal(SESSION_REPLAY_BUNDLE_FORMAT),
	schemaVersion: z.literal(SESSION_REPLAY_BUNDLE_SCHEMA_VERSION),
	createdAt: z.string().min(1),
	producer: z.object({
		name: z.string().min(1),
		version: z.string(),
		host: z.string().optional(),
		hostVersion: z.string().optional(),
	}),
	rootSessionId: z.string().min(1),
	sessions: z.array(SessionReplaySessionEntrySchema).min(1),
	files: z.array(SessionReplayFileEntrySchema),
	redaction: z.object({
		enabled: z.boolean(),
		removedCount: z.number().int().nonnegative(),
		report: SafeRelativePathSchema,
	}),
	/** Reserved for the environment the session ran in (image, mounts, env). */
	environment: z.record(z.string(), z.unknown()).optional(),
});
export type SessionReplayBundleManifest = z.infer<
	typeof SessionReplayBundleManifestSchema
>;

function isMessageWithMetadata(value: unknown): value is MessageWithMetadata {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const candidate = value as Partial<MessageWithMetadata>;
	if (candidate.role !== "user" && candidate.role !== "assistant") {
		return false;
	}
	return (
		typeof candidate.content === "string" || Array.isArray(candidate.content)
	);
}

const PersistedMessageSchema = z.custom<MessageWithMetadata>(
	isMessageWithMetadata,
	{ message: "expected a persisted user or assistant message" },
);

/** The raw persisted message list, as resume/fork would consume it. */
export const SessionReplayTranscriptFileSchema = z.object({
	sessionId: z.string().min(1),
	systemPrompt: z.string().optional(),
	messages: z.array(PersistedMessageSchema),
});
export type SessionReplayTranscriptFile = z.infer<
	typeof SessionReplayTranscriptFileSchema
>;

export const SessionReplayEventSchema = z.object({
	/** Position in this events file, assigned at export (0-based). */
	index: z.number().int().nonnegative(),
	/**
	 * Per-session ordering key assigned while the session was recorded;
	 * shared with request records. Absent on events from unrecorded periods.
	 */
	seq: z.number().int().nonnegative().optional(),
	ts: z.string().min(1),
	kind: z.enum(SESSION_REPLAY_EVENT_KINDS),
	/** Hook name (`tool_call`, `agent_end`, ...), decision or runtime event name. */
	name: z.string().min(1),
	sessionId: z.string().min(1),
	agentId: z.string().nullable().optional(),
	parentAgentId: z.string().nullable().optional(),
	/** Runtime iteration number within its run, when the source carried one. */
	iteration: z.number().int().nonnegative().optional(),
	toolCallId: z.string().min(1).optional(),
	/** Correlation ids (runId, messageId, promptId, modelCallIndex); not redacted. */
	refs: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	/** The source record, after redaction. */
	payload: z.record(z.string(), z.unknown()),
});
export type SessionReplayEvent = z.infer<typeof SessionReplayEventSchema>;

export const SessionReplayRedactionReportSchema = z.object({
	enabled: z.boolean(),
	ruleset: z.literal("vcr-sanitizer"),
	rules: z.object({
		keysExact: z.array(z.string()),
		keySuffixes: z.array(z.string()),
		valuePatterns: z.array(z.string()),
	}),
	/** Bundle locations the redaction pass ran over. */
	covered: z.array(z.string()),
	/** Bundle locations deliberately left verbatim. */
	notCovered: z.array(z.string()),
	/** One record per removed value. Values themselves are never recorded. */
	redactions: z.array(
		z.object({
			file: z.string().min(1),
			path: z.string(),
			rule: z.string().min(1),
		}),
	),
});
export type SessionReplayRedactionReport = z.infer<
	typeof SessionReplayRedactionReportSchema
>;

export const SessionReplayCompactionFileSchema = SessionCompactionStateSchema;

const MEDIA_TYPES: Record<
	SessionReplayFileKind,
	SessionReplayFileEntry["mediaType"]
> = {
	transcript: "application/json",
	events: "application/x-ndjson",
	compaction: "application/json",
	"redaction-report": "application/json",
	request: "application/x-ndjson",
	"request-blobs": "application/x-ndjson",
	cassette: "application/json",
	environment: "application/json",
};

export function sessionReplayFileMediaType(
	kind: SessionReplayFileKind,
): SessionReplayFileEntry["mediaType"] {
	return MEDIA_TYPES[kind];
}

/** Directory of one session inside a bundle, relative to the bundle root. */
export function sessionReplaySessionDir(sessionId: string): string {
	return `sessions/${encodeURIComponent(sessionId)}`;
}

export const sessionReplayBundlePaths = {
	transcript: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/transcript.json`,
	events: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/events.jsonl`,
	compaction: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/compaction.json`,
	requestsDir: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests`,
	requests: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests/requests.jsonl`,
	requestBlobs: (sessionId: string) =>
		`${sessionReplaySessionDir(sessionId)}/requests/blobs.jsonl`,
} as const;

/**
 * A recorded request part. `sha256` is the recording-time hash of `value`;
 * when export redaction changed `value` (message metadata), `redacted` is set
 * and the hash no longer verifies, but references and `contentSha256` (which
 * covers role and content only) still hold.
 */
export const SessionReplayRequestBlobSchema = SessionRecordedBlobSchema.extend({
	redacted: z.literal(true).optional(),
});
export type SessionReplayRequestBlob = z.infer<
	typeof SessionReplayRequestBlobSchema
>;
