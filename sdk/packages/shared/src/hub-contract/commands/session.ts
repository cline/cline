import { z } from "zod";
import { defineHubCommands, hubObject, hubRecord } from "../define";

/**
 * Session id carried in the payload. Handlers read it via `extractSessionId`,
 * which falls back to `envelope.sessionId` when the payload value is not a
 * string, so it is never required here.
 */
const payloadSessionId = z.string().nullish();

/** Session id and nothing else: the common shape for addressing a session. */
const sessionAddressInput = hubObject({ sessionId: payloadSessionId });

/** A Hub session record / core session snapshot (runtime structures). */
const sessionRecord = hubRecord;

/**
 * Top-level keys of `Partial<RuntimeSessionConfig>`. The handler JSON-clones the
 * object and spreads it into the runtime config; nested values stay untyped.
 */
const sessionConfigInput = hubObject({
	sessionId: z.string().nullish(),
	providerId: z.string().nullish(),
	modelId: z.string().nullish(),
	apiKey: z.string().nullish(),
	cwd: z.string().nullish(),
	workspaceRoot: z.string().nullish(),
	systemPrompt: z.string().nullish(),
	mode: z.string().nullish(),
	// TODO(contract): RuntimeSessionConfig carries many more fields (rules,
	// maxIterations, checkpoint, thinking, ...); they pass through untyped.
});

/**
 * Legacy runtime options read by session.create / session.restore. Every key
 * is type-checked by the handler and ignored when it has the wrong type.
 */
const runtimeOptionsInput = hubObject({
	mode: z.string().nullish(),
	systemPrompt: z.string().nullish(),
	maxIterations: z.number().nullish(),
	timeoutSeconds: z.number().nullish(),
	enableTools: z.boolean().nullish(),
	enableSpawn: z.boolean().nullish(),
	enableTeams: z.boolean().nullish(),
	autoApproveTools: z.boolean().nullish(),
	checkpointEnabled: z.boolean().nullish(),
	clientContext: z.unknown().optional(),
	userContext: z.unknown().optional(),
	clientContributions: z.unknown().optional(),
	configExtensions: z.unknown().optional(),
	toolExecutors: z.unknown().optional(),
});

const modelSelectionInput = hubObject({
	provider: z.string().nullish(),
	model: z.string().nullish(),
	apiKey: z.string().nullish(),
});

/**
 * Fields shared by session.create and session.restore for starting a runtime
 * session. The handler checks `typeof x === "object"` (null tolerated) and
 * falls back to defaults when a field is absent or mistyped.
 */
const sessionStartFields = {
	workspaceRoot: z.string().nullish(),
	cwd: z.string().nullish(),
	sessionConfig: sessionConfigInput.nullish(),
	metadata: hubRecord.nullish(),
	runtimeOptions: runtimeOptionsInput.nullish(),
	modelSelection: modelSelectionInput.nullish(),
	toolPolicies: hubRecord.nullish(),
	// Parsed with SessionCompactionStateSchema; an invalid value is ignored.
	initialCompactionState: hubRecord.nullish(),
};

const sessionWithSnapshotOutput = hubObject({
	session: sessionRecord.optional(),
	snapshot: sessionRecord.optional(),
});

const pendingPromptMutationOutput = hubObject({
	sessionId: z.string().optional(),
	prompts: z.array(hubRecord).optional(),
	prompt: hubRecord.optional(),
	updated: z.boolean().optional(),
	removed: z.boolean().optional(),
});

const sessionSearchHit = hubObject({
	sessionId: z.string(),
	documentId: z.string(),
	ordinal: z.number(),
	role: z.string(),
	startedAt: z.string(),
	workspaceRoot: z.string(),
	title: z.string(),
	snippet: z.string(),
	score: z.number(),
});

export const sessionCommands = defineHubCommands({
	"session.list": {
		description: "List recent sessions known to the Hub.",
		input: hubObject({
			limit: z.number().optional(),
			rootOnly: z.boolean().optional(),
		}),
		output: hubObject({
			sessions: z.array(sessionRecord).optional(),
		}),
	},
	"session.search": {
		description: "Full-text search over session transcripts.",
		input: hubObject({
			query: z.string().refine((value) => value.trim().length > 0, {
				message: "query must be non-empty",
			}),
			limit: z.number().optional(),
			workspaceRoot: z.string().optional(),
		}),
		output: hubObject({
			hits: z.array(sessionSearchHit),
		}),
	},
	"session.create": {
		description: "Start a new runtime session owned by the calling client.",
		input: hubObject({
			...sessionStartFields,
			initialMessages: z.array(z.unknown()).nullish(),
		}),
		output: sessionWithSnapshotOutput,
	},
	"session.attach": {
		description: "Join an existing session as a participant.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Sent by apps/examples/vscode; not read by the handler.
			role: z.string().optional(),
			metadata: hubRecord.optional(),
		}),
		output: hubObject({
			session: sessionRecord.optional(),
		}),
	},
	"session.detach": {
		description:
			"Leave a session and cancel the client's pending capability requests.",
		input: sessionAddressInput,
	},
	"session.get": {
		description: "Read a session record, optionally with its core snapshot.",
		input: hubObject({
			sessionId: payloadSessionId,
			includeSnapshot: z.boolean().optional(),
		}),
		output: sessionWithSnapshotOutput,
	},
	"session.messages": {
		description: "Read a session's persisted message transcript.",
		input: sessionAddressInput,
		output: hubObject({
			sessionId: z.string().optional(),
			messages: z.array(hubRecord).optional(),
		}),
	},
	"session.restore": {
		description:
			"Restore a session checkpoint, optionally starting a new session from it.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Handler only checks `typeof === "number"`.
			checkpointRunCount: z.number(),
			restore: hubObject({
				messages: z.boolean().optional(),
				workspace: z.boolean().optional(),
				omitCheckpointMessageFromSession: z.boolean().optional(),
			}).nullish(),
			// TODO(contract): sessionConfig is required when restore.messages is
			// not false; the handler enforces that conditional rule.
			...sessionStartFields,
		}),
		output: hubObject({
			session: sessionRecord.optional(),
			snapshot: sessionRecord.optional(),
			messages: z.array(hubRecord).optional(),
			checkpoint: hubRecord.optional(),
		}),
	},
	"session.delete": {
		description: "Delete a session and its derived state.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Sent by the session client; not read by the handler.
			deleteCheckpointRefs: z.boolean().optional(),
		}),
		output: hubObject({
			deleted: z.boolean().optional(),
		}),
	},
	"session.update": {
		description: "Merge client metadata into a session record.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Non-object values are treated as absent.
			metadata: hubRecord.nullish(),
		}),
		output: hubObject({
			updated: z.boolean().optional(),
			session: sessionRecord.optional(),
			snapshot: sessionRecord.optional(),
		}),
	},
	"session.update_connection": {
		description:
			"Change a live session's provider, model, or reasoning settings.",
		input: hubObject({
			sessionId: payloadSessionId,
			// Each key is type-checked by readSessionConnectionUpdate and dropped
			// when mistyped; a missing `updates` is treated as `{}`.
			updates: hubObject({
				providerId: z.string().nullish(),
				modelId: z.string().nullish(),
				apiKey: z.string().nullish(),
				baseUrl: z.string().nullish(),
				headers: hubRecord.nullish(),
				providerConfig: hubRecord.nullish(),
				thinking: z.boolean().nullish(),
				// TODO(contract): validated against ReasoningEffortSchema; invalid
				// values are ignored rather than rejected.
				reasoningEffort: z.string().nullish(),
				thinkingBudgetTokens: z.number().nullish(),
			}).nullish(),
		}),
		output: hubObject({
			sessionId: z.string().optional(),
			updated: z.boolean().optional(),
		}),
	},
	"session.compaction.get": {
		description: "Read a session's compaction state (owner client only).",
		input: sessionAddressInput,
		output: hubObject({
			sessionId: z.string().optional(),
			state: hubRecord.optional(),
		}),
	},
	"session.compaction.update": {
		description: "Replace a session's compaction state (owner client only).",
		input: hubObject({
			sessionId: payloadSessionId,
			// Validated by SessionCompactionStateSchema in the handler.
			state: hubRecord,
		}),
		output: hubObject({
			updated: z.boolean().optional(),
			session: sessionRecord.optional(),
			snapshot: sessionRecord.optional(),
		}),
	},
	"session.pending_prompts": {
		description: "List a session's queued pending prompts.",
		input: sessionAddressInput,
		output: hubObject({
			sessionId: z.string().optional(),
			prompts: z.array(hubRecord).optional(),
		}),
	},
	"session.steer_first_pending_prompt": {
		description: "Promote the first queued prompt to steer delivery.",
		input: sessionAddressInput,
		output: pendingPromptMutationOutput,
	},
	"session.update_pending_prompt": {
		description: "Edit a queued prompt's text or delivery mode.",
		input: hubObject({
			sessionId: payloadSessionId,
			// A missing id is a no-op (`updated: false`), not an error.
			promptId: z.string().optional(),
			prompt: z.string().optional(),
			delivery: z.enum(["queue", "steer"]).optional(),
		}),
		output: pendingPromptMutationOutput,
	},
	"session.remove_pending_prompt": {
		description: "Remove a queued prompt.",
		input: hubObject({
			sessionId: payloadSessionId,
			// A missing id is a no-op (`removed: false`), not an error.
			promptId: z.string().optional(),
		}),
		output: pendingPromptMutationOutput,
	},
	"session.fork": {
		description: "Fork a session (reserved; the Hub has no handler yet).",
		// TODO(contract): no Hub handler or sender exists; only listed in
		// HubCommandName and the drain-refused command set.
		input: hubObject({
			sessionId: payloadSessionId,
		}),
	},
	"session.hook": {
		description: "Dispatch a hook event payload into the session runtime.",
		input: hubObject({
			// Validated by HookEventPayloadSchema; invalid payloads are rejected.
			payload: hubRecord,
		}),
		output: hubObject({
			applied: z.boolean().optional(),
		}),
	},
});
