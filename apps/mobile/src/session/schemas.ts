/**
 * Runtime validation for everything the session core consumes off the wire.
 *
 * The hub is a separate process (often a different release than the app), so
 * every payload the reducer reads is parsed rather than cast. Nothing in here
 * throws: a bad payload is reported as `invalid` and the caller turns it into a
 * counted diagnostic.
 *
 * Schemas are derived from what the hub actually publishes
 * (`session-event-projector.ts`, `approval-handlers.ts`,
 * `handleSessionMessages`) and from the committed `hub-v1` fixtures, which is
 * why several fields are optional in ways the TypeScript interfaces are not —
 * e.g. the projector's hook branch publishes `tool.started` with only a
 * `toolName`, and `run.started` is published with no payload at all.
 */

import type {
	HubEventEnvelope,
	HubEventName,
	PendingApprovalInfo,
} from "@cline/shared";
import { GeneratedMediaSchema } from "@cline/shared";
import { z } from "zod";
import { reasoningFromMetadata } from "./reasoning";
// Type-only, so this stays a compile-time edge and not an import cycle.
import type { RunStatus } from "./reducer";

// --- token usage -------------------------------------------------------------

export const tokenUsageSchema = z.looseObject({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	totalCost: z.number().optional(),
});

export type TokenUsagePayload = z.infer<typeof tokenUsageSchema>;

// --- approvals ---------------------------------------------------------------

/**
 * `PendingApprovalInfo`. Also the payload of `approval.requested`, so a client
 * that arrives late recovers exactly what the event carried.
 */
export const pendingApprovalSchema = z.looseObject({
	approvalId: z.string().min(1),
	sessionId: z.string().min(1),
	agentId: z.string(),
	conversationId: z.string(),
	iteration: z.number(),
	toolCallId: z.string(),
	toolName: z.string(),
	inputJson: z.string(),
	policy: z.looseObject({}),
	createdAt: z.number(),
	/**
	 * Epoch ms after which the hub auto-denies. Absent from hubs that wait
	 * indefinitely, so optional — but validated, because the client filters on it.
	 */
	expiresAt: z.number().optional(),
});

export const approvalResolvedSchema = z.looseObject({
	approvalId: z.string().min(1),
	approved: z.boolean(),
	reason: z.string().optional(),
	cancelled: z.boolean().optional(),
	/** Set when the hub resolved the approval by timing it out. */
	expired: z.boolean().optional(),
});

// --- pending prompts ---------------------------------------------------------

/**
 * One entry in the machine's turn queue. Sending while a run is active is not an
 * error the client has to prevent: `runTurn` defaults `delivery` to "queue" for an
 * interactive session that cannot start a run, so the prompt is held and replayed
 * when the turn ends. "steer" jumps the queue into the running turn instead.
 */
export const pendingPromptSchema = z.looseObject({
	id: z.string().min(1),
	prompt: z.string(),
	delivery: z.enum(["queue", "steer"]).default("queue"),
	attachmentCount: z.number().int().nonnegative().default(0),
});

/** Projected shape: the passthrough keys of the loose payload stay out of the view. */
export interface PendingPromptView {
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
}

/**
 * A snapshot of the whole queue, not a delta — the hub re-broadcasts the full
 * list on every mutation, so the reducer replaces rather than merges.
 */
export const pendingPromptsSchema = z.looseObject({
	prompts: z.array(pendingPromptSchema),
});

/**
 * The entry just handed to the agent; it leaves the queue and becomes a turn.
 *
 * The prompt is NESTED here, unlike `session.pending_prompts`. The turn queue's
 * internal event is flat (`{ sessionId, id, prompt, … }`) but
 * `session-event-projector.ts` re-wraps it as `{ sessionId, prompt: {…} }` on the
 * way to the wire, and the wire shape is the contract. Reading a top-level `id`
 * parses nothing, and a queue that never drops a submitted entry shows every
 * prompt twice — once queued, once as the user message it became.
 */
export const pendingPromptSubmittedSchema = z.looseObject({
	prompt: pendingPromptSchema,
});

export function toPendingPromptView(
	parsed: z.infer<typeof pendingPromptSchema>,
): PendingPromptView {
	return {
		id: parsed.id,
		prompt: parsed.prompt,
		delivery: parsed.delivery,
		attachmentCount: parsed.attachmentCount,
	};
}

// --- consumed event payloads -------------------------------------------------

const runStartedSchema = z.looseObject({}).optional();
const assistantDeltaSchema = z.looseObject({ text: z.string() });
const assistantFinishedSchema = z.looseObject({ text: z.string().optional() });
const assistantMediaSchema = z.looseObject({ media: GeneratedMediaSchema });
const reasoningDeltaSchema = z.looseObject({
	text: z.string(),
	redacted: z.boolean().optional(),
});
const reasoningFinishedSchema = z.looseObject({
	reasoning: z.string().optional(),
	redacted: z.boolean().optional(),
});
const toolStartedSchema = z.looseObject({
	toolCallId: z.string().optional(),
	toolName: z.string(),
	input: z.unknown().optional(),
});
const toolUpdatedSchema = z.looseObject({
	toolCallId: z.string().optional(),
	toolName: z.string().optional(),
	input: z.unknown().optional(),
	output: z.unknown().optional(),
	error: z.string().optional(),
});
const toolFinishedSchema = z.looseObject({
	toolCallId: z.string().optional(),
	toolName: z.string().optional(),
	output: z.unknown().optional(),
	error: z.string().optional(),
});
const usageUpdatedSchema = z.looseObject({
	delta: tokenUsageSchema.optional(),
	totals: tokenUsageSchema.optional(),
	usage: tokenUsageSchema.optional(),
	aggregateUsage: tokenUsageSchema.optional(),
});
const runTerminalSchema = z.looseObject({
	reason: z.string().optional(),
	error: z.string().optional(),
});

const sessionRecordSchema = z.looseObject({
	sessionId: z.string().min(1),
	status: z.string().optional(),
	// Typed on newer hubs; older hubs carry the same pair only in metadata.
	provider: z.string().optional(),
	model: z.string().optional(),
	metadata: z
		.looseObject({
			provider: z.string().optional(),
			model: z.string().optional(),
		})
		.optional(),
});

const sessionRecordReplySchema = z.looseObject({
	session: sessionRecordSchema,
});

/** Provider/model a session is configured to run with, when the hub said. */
export interface SessionModelView {
	providerId?: string;
	modelId?: string;
	reasoning?: import("./reasoning").ReasoningChoice;
	mode?: "act" | "plan" | "yolo";
}

export const ASK_QUESTION_CAPABILITY = "tool_executor.askQuestion";

/** One client-owned `ask_question` request rendered by the mobile session. */
export interface SessionQuestionView {
	requestId: string;
	question: string;
	options: string[];
}

const capabilityRequestSchema = z.looseObject({
	requestId: z.string().min(1),
	targetClientId: z.string().min(1),
	capabilityName: z.string().min(1),
	payload: z.looseObject({ args: z.array(z.unknown()) }),
});

export type AskQuestionCapabilityParseResult =
	| { status: "ignored" }
	| { status: "invalid"; requestId: string; detail: string }
	| { status: "ok"; question: SessionQuestionView };

/** Parse only `ask_question` requests owned by this socket. */
export function parseAskQuestionCapabilityRequest(
	value: unknown,
	clientId: string,
): AskQuestionCapabilityParseResult {
	const parsed = capabilityRequestSchema.safeParse(value);
	if (!parsed.success) {
		return { status: "ignored" };
	}
	if (
		parsed.data.targetClientId !== clientId ||
		parsed.data.capabilityName !== ASK_QUESTION_CAPABILITY
	) {
		return { status: "ignored" };
	}
	const [question, options] = parsed.data.payload.args;
	if (
		typeof question !== "string" ||
		!question.trim() ||
		!Array.isArray(options) ||
		options.length < 2 ||
		options.length > 5 ||
		!options.every((option) => typeof option === "string" && option.trim())
	) {
		return {
			status: "invalid",
			requestId: parsed.data.requestId,
			detail: "ask_question requires one question and 2-5 text options.",
		};
	}
	return {
		status: "ok",
		question: {
			requestId: parsed.data.requestId,
			question: question.trim(),
			// Desktop preserves model-supplied repeats: each remains a distinct
			// selectable row, even though choosing either returns the same answer.
			options: options.map((option) => option.trim()),
		},
	};
}

const capabilityResolvedSchema = z.looseObject({
	requestId: z.string().min(1),
	targetClientId: z.string().min(1),
	capabilityName: z.string().min(1),
});

export function parseAskQuestionCapabilityResolution(
	value: unknown,
	clientId: string,
): string | undefined {
	const parsed = capabilityResolvedSchema.safeParse(value);
	return parsed.success &&
		parsed.data.targetClientId === clientId &&
		parsed.data.capabilityName === ASK_QUESTION_CAPABILITY
		? parsed.data.requestId
		: undefined;
}

/**
 * Typed fields win; `metadata.provider`/`metadata.model` are the compatibility
 * spelling every hub has always sent. Returns undefined when neither names
 * anything, so "the hub said nothing" never overwrites a known model.
 */
export function readSessionModel(
	record: z.infer<typeof sessionRecordSchema>,
): SessionModelView | undefined {
	const providerId =
		record.provider?.trim() || record.metadata?.provider?.trim();
	const modelId = record.model?.trim() || record.metadata?.model?.trim();
	const mode = record.metadata?.mode;
	if (!providerId && !modelId) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(mode === "act" || mode === "plan" || mode === "yolo" ? { mode } : {}),
		...(reasoningFromMetadata(record.metadata)
			? { reasoning: reasoningFromMetadata(record.metadata) }
			: {}),
	};
}

/**
 * The events the reducer projects into the view model. Everything else in
 * `HubEventName` is deliberately ignored (see {@link IGNORED_HUB_EVENTS}).
 */
export const CONSUMED_HUB_EVENTS = [
	"run.started",
	"assistant.delta",
	"assistant.media",
	"assistant.finished",
	"reasoning.delta",
	"reasoning.finished",
	"tool.started",
	"tool.updated",
	"tool.finished",
	"usage.updated",
	"run.completed",
	"run.aborted",
	"run.failed",
	"approval.requested",
	"approval.resolved",
	"session.pending_prompts",
	"session.pending_prompt_submitted",
	"session.updated",
] as const satisfies readonly HubEventName[];

export type ConsumedHubEvent = (typeof CONSUMED_HUB_EVENTS)[number];

const CONSUMED_EVENT_SCHEMAS = {
	"run.started": runStartedSchema,
	"assistant.delta": assistantDeltaSchema,
	"assistant.media": assistantMediaSchema,
	"assistant.finished": assistantFinishedSchema,
	"reasoning.delta": reasoningDeltaSchema,
	"reasoning.finished": reasoningFinishedSchema,
	"tool.started": toolStartedSchema,
	"tool.updated": toolUpdatedSchema,
	"tool.finished": toolFinishedSchema,
	"usage.updated": usageUpdatedSchema,
	"run.completed": runTerminalSchema,
	"run.aborted": runTerminalSchema,
	"run.failed": runTerminalSchema,
	"approval.requested": pendingApprovalSchema,
	"approval.resolved": approvalResolvedSchema,
	"session.pending_prompts": pendingPromptsSchema,
	"session.pending_prompt_submitted": pendingPromptSubmittedSchema,
	// The record rides the event exactly as `session.attach`/`session.get` reply
	// with it, so the same reader serves both.
	"session.updated": sessionRecordReplySchema,
} as const satisfies Record<ConsumedHubEvent, z.ZodType>;

/**
 * Every event name in the v1 protocol. Written as an exhaustive record so that
 * adding an event to `HubEventName` upstream is a compile error here rather than
 * a silent stream of `unknown_event` diagnostics on device.
 */
const KNOWN_HUB_EVENTS: Record<HubEventName, true> = {
	"hub.client.registered": true,
	"hub.client.disconnected": true,
	"hub.client.updated": true,
	"session.created": true,
	"session.updated": true,
	"session.attached": true,
	"session.detached": true,
	"session.forked": true,
	"session.pending_prompts": true,
	"session.pending_prompt_submitted": true,
	"session.notice": true,
	"run.started": true,
	"run.heartbeat": true,
	"run.aborted": true,
	"run.completed": true,
	"run.failed": true,
	"run.enqueued": true,
	"run.interrupted": true,
	"hub.drain_changed": true,
	"iteration.started": true,
	"iteration.finished": true,
	"assistant.delta": true,
	"assistant.media": true,
	"assistant.finished": true,
	"reasoning.delta": true,
	"reasoning.finished": true,
	"agent.done": true,
	"usage.updated": true,
	"tool.started": true,
	"tool.updated": true,
	"tool.finished": true,
	"approval.requested": true,
	"approval.resolved": true,
	"capability.requested": true,
	"capability.resolved": true,
	"team.progress": true,
	"artifact.created": true,
	"diff.created": true,
	"spoke.started": true,
	"spoke.failed": true,
	"spoke.stopped": true,
	"peer.registered": true,
	"peer.session_attached": true,
	"peer.session_detached": true,
	"schedule.created": true,
	"schedule.updated": true,
	"schedule.deleted": true,
	"schedule.triggered": true,
	"schedule.execution_completed": true,
	"schedule.execution_failed": true,
	"task.created": true,
	"task.updated": true,
	"task.deleted": true,
	"task.run.started": true,
	"task.run.completed": true,
	"task.run.failed": true,
	"task.automation.updated": true,
	"settings.changed": true,
	"ui.notify": true,
	"ui.show_window": true,
};

/** Protocol events the session core knowingly drops (no diagnostic). */
export const IGNORED_HUB_EVENTS: readonly HubEventName[] = (
	Object.keys(KNOWN_HUB_EVENTS) as HubEventName[]
).filter((name) => !(CONSUMED_HUB_EVENTS as readonly string[]).includes(name));

const IGNORED_EVENT_SET = new Set<string>(IGNORED_HUB_EVENTS);

export type SessionEvent = {
	[K in ConsumedHubEvent]: {
		name: K;
		eventId: string | undefined;
		sessionId: string | undefined;
		timestamp: number | undefined;
		payload: z.infer<(typeof CONSUMED_EVENT_SCHEMAS)[K]>;
	};
}[ConsumedHubEvent];

export type ParsedHubEvent =
	| { status: "ok"; event: SessionEvent }
	| { status: "ignored"; event: string }
	| { status: "unknown"; event: string }
	| { status: "invalid"; event: string; detail: string };

function formatIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.join(".");
			return path ? `${path}: ${issue.message}` : issue.message;
		})
		.join("; ");
}

/** Classify + validate one hub event. Never throws. */
export function parseHubEvent(envelope: HubEventEnvelope): ParsedHubEvent {
	const name = envelope.event;
	if (IGNORED_EVENT_SET.has(name)) {
		return { status: "ignored", event: name };
	}
	const schema = (
		CONSUMED_EVENT_SCHEMAS as Record<string, z.ZodType | undefined>
	)[name];
	if (!schema) {
		return { status: "unknown", event: name };
	}
	const payload =
		name === "approval.requested" && envelope.payload?.createdAt === undefined
			? { ...envelope.payload, createdAt: envelope.timestamp ?? Date.now() }
			: envelope.payload;
	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		return {
			status: "invalid",
			event: name,
			detail: formatIssues(parsed.error),
		};
	}
	return {
		status: "ok",
		event: {
			name,
			eventId: envelope.eventId,
			sessionId: envelope.sessionId,
			timestamp: envelope.timestamp,
			payload: parsed.data,
		} as SessionEvent,
	};
}

// --- session.messages (hydrate) ---------------------------------------------

const KNOWN_BLOCK_TYPES = new Set([
	"text",
	"image",
	"media",
	"file",
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
]);

const textBlockSchema = z.looseObject({
	type: z.literal("text"),
	text: z.string(),
});
const imageBlockSchema = z.looseObject({
	type: z.literal("image"),
	data: z.string(),
	mediaType: z.string().optional(),
});
const mediaBlockSchema = z.looseObject({
	type: z.literal("media"),
	media: GeneratedMediaSchema,
});
const fileBlockSchema = z.looseObject({
	type: z.literal("file"),
	content: z.string(),
	path: z.string().optional(),
});
const toolUseBlockSchema = z.looseObject({
	type: z.literal("tool_use"),
	id: z.string(),
	name: z.string(),
	input: z.unknown().optional(),
});
const toolResultBlockSchema = z.looseObject({
	type: z.literal("tool_result"),
	tool_use_id: z.string(),
	name: z.string().optional(),
	content: z.union([z.string(), z.array(z.unknown())]).optional(),
	is_error: z.boolean().optional(),
});
const thinkingBlockSchema = z.looseObject({
	type: z.literal("thinking"),
	thinking: z.string(),
});
const redactedThinkingBlockSchema = z.looseObject({
	type: z.literal("redacted_thinking"),
	data: z.string().optional(),
});
/**
 * Forward compatibility: a block type this build has never heard of is kept as
 * an opaque `unsupported` block and skipped when projecting. A *known* type with
 * a malformed body still fails, so real drift is not silently swallowed.
 */
const opaqueBlockSchema = z
	.looseObject({
		type: z
			.string()
			.refine(
				(type) => !KNOWN_BLOCK_TYPES.has(type),
				"unsupported content block shape",
			),
	})
	.transform((block) => ({ type: "unsupported" as const, raw: block }));

export const contentBlockSchema = z.union([
	textBlockSchema,
	imageBlockSchema,
	mediaBlockSchema,
	fileBlockSchema,
	toolUseBlockSchema,
	toolResultBlockSchema,
	thinkingBlockSchema,
	redactedThinkingBlockSchema,
	opaqueBlockSchema,
]);

export type HydratedContentBlock = z.infer<typeof contentBlockSchema>;

export const hydratedMessageSchema = z.looseObject({
	role: z.enum(["user", "assistant"]),
	content: z.union([z.string(), z.array(contentBlockSchema)]),
	// Newer persistence adapters retain this; older LLM-native histories do not.
	createdAt: z.number().optional(),
});

export type HydratedMessage = z.infer<typeof hydratedMessageSchema>;

const sessionMessagesEnvelopeSchema = z.looseObject({
	sessionId: z.string().optional(),
	messages: z.array(z.unknown()),
});

export type ParsedSessionMessages =
	| {
			status: "ok";
			sessionId?: string;
			messages: HydratedMessage[];
			/** Entries skipped because they did not parse. */
			invalidCount: number;
			/** First skipped entry's issues, for the diagnostic. */
			invalidDetail?: string;
	  }
	| { status: "invalid"; detail: string };

/**
 * Parses the transcript entry by entry.
 *
 * Only the envelope is all-or-nothing: without an array of messages there is no
 * transcript to salvage. A single malformed *entry* must not cost the rest,
 * because a blank `hydrated` is not a harmless empty screen — it is also the
 * baseline the optimistic-send reconciliation measures against, so one bad
 * content block used to blank the transcript *and* silently drop a failed send.
 */
export function parseSessionMessagesReply(
	payload: unknown,
): ParsedSessionMessages {
	const envelope = sessionMessagesEnvelopeSchema.safeParse(payload);
	if (!envelope.success) {
		return { status: "invalid", detail: formatIssues(envelope.error) };
	}
	const messages: HydratedMessage[] = [];
	let invalidCount = 0;
	let invalidDetail: string | undefined;
	for (const entry of envelope.data.messages) {
		const parsed = hydratedMessageSchema.safeParse(entry);
		if (parsed.success) {
			messages.push(parsed.data);
			continue;
		}
		invalidCount += 1;
		invalidDetail ??= formatIssues(parsed.error);
	}
	return {
		status: "ok",
		...(envelope.data.sessionId ? { sessionId: envelope.data.sessionId } : {}),
		messages,
		invalidCount,
		...(invalidDetail ? { invalidDetail } : {}),
	};
}

// --- approval.list_pending ---------------------------------------------------

/**
 * Parses a pending-approval list entry by entry: one malformed row must not cost
 * us the other, still-answerable approvals.
 */
export function parsePendingApprovals(value: unknown): {
	approvals: PendingApprovalInfo[];
	invalidCount: number;
} {
	if (!Array.isArray(value)) {
		return { approvals: [], invalidCount: 0 };
	}
	const approvals: PendingApprovalInfo[] = [];
	let invalidCount = 0;
	for (const entry of value) {
		const parsed = pendingApprovalSchema.safeParse(entry);
		if (parsed.success) {
			approvals.push(parsed.data as unknown as PendingApprovalInfo);
		} else {
			invalidCount += 1;
		}
	}
	return { approvals, invalidCount };
}

// --- session.list / session.create ------------------------------------------

export const remoteHubSessionSchema = z.looseObject({
	sessionId: z.string().min(1),
	status: z.string().optional(),
	createdAt: z.number().optional(),
	updatedAt: z.number().optional(),
	workspaceRoot: z.string().optional(),
	cwd: z.string().optional(),
	metadata: z
		.looseObject({
			title: z.string().optional(),
			prompt: z.string().optional(),
			provider: z.string().optional(),
			model: z.string().optional(),
		})
		.optional(),
});

export type HubSessionSummary = z.infer<typeof remoteHubSessionSchema>;

export type ParsedSessionList =
	| { status: "ok"; sessions: HubSessionSummary[]; invalidCount: number }
	| { status: "invalid"; detail: string };

export function parseSessionListReply(payload: unknown): ParsedSessionList {
	const envelope = z
		.looseObject({ sessions: z.array(z.unknown()) })
		.safeParse(payload);
	if (!envelope.success) {
		return { status: "invalid", detail: formatIssues(envelope.error) };
	}
	const sessions: HubSessionSummary[] = [];
	let invalidCount = 0;
	for (const entry of envelope.data.sessions) {
		const parsed = remoteHubSessionSchema.safeParse(entry);
		if (parsed.success) {
			sessions.push(parsed.data);
		} else {
			invalidCount += 1;
		}
	}
	return { status: "ok", sessions, invalidCount };
}

// --- session.attach / session.get (authoritative run status) -----------------

/**
 * `HubRuntimeStatus` -> {@link RunStatus}.
 *
 * The hub distinguishes `aborted` from `failed`, so nothing is lost in
 * translation. `pending` (work accepted, run not started yet) maps to `running`
 * because the UI has no third "queued" state, and a status this build has never
 * heard of maps to `undefined` so the caller keeps whatever it already had rather
 * than inventing one.
 */
const HUB_STATUS_TO_RUN_STATUS: Record<string, RunStatus> = {
	idle: "idle",
	running: "running",
	pending: "running",
	completed: "completed",
	aborted: "aborted",
	failed: "failed",
};

export type ParsedSessionRecord =
	| {
			status: "ok";
			sessionId: string;
			runStatus?: RunStatus;
			model?: SessionModelView;
	  }
	| { status: "invalid"; detail: string };

/**
 * Parses the `{ session }` reply shared by `session.attach`, `session.get` and
 * `session.create`, keeping only what the session core acts on: the id and the
 * authoritative run status.
 */
export function parseSessionRecordReply(payload: unknown): ParsedSessionRecord {
	const parsed = sessionRecordReplySchema.safeParse(payload);
	if (!parsed.success) {
		return { status: "invalid", detail: formatIssues(parsed.error) };
	}
	const runStatus = parsed.data.session.status
		? HUB_STATUS_TO_RUN_STATUS[parsed.data.session.status]
		: undefined;
	const model = readSessionModel(parsed.data.session);
	return {
		status: "ok",
		sessionId: parsed.data.session.sessionId,
		...(runStatus ? { runStatus } : {}),
		...(model ? { model } : {}),
	};
}

// --- model catalog -------------------------------------------------------------

const catalogModelSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().optional(),
	supportsThinking: z.boolean().optional(),
});

const catalogProviderSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().min(1),
	enabled: z.boolean(),
	defaultModelId: z.string().optional(),
});

/** `catalog.list` reply: the models the connected machine can actually run. */
const modelCatalogSchema = z.looseObject({
	providers: z.array(catalogProviderSchema),
	modelsByProvider: z.record(z.string(), z.array(catalogModelSchema)),
});

export type ModelCatalogView = z.infer<typeof modelCatalogSchema>;

export type ParsedModelCatalog =
	| { status: "ok"; catalog: ModelCatalogView }
	| { status: "invalid"; detail: string };

export function parseModelCatalogReply(payload: unknown): ParsedModelCatalog {
	const parsed = modelCatalogSchema.safeParse(payload);
	if (!parsed.success) {
		return { status: "invalid", detail: formatIssues(parsed.error) };
	}
	return { status: "ok", catalog: parsed.data };
}

export type ParsedSessionCreate =
	| { status: "ok"; sessionId: string }
	| { status: "invalid"; detail: string };

export function parseSessionCreateReply(payload: unknown): ParsedSessionCreate {
	const parsed = z
		.looseObject({
			session: z.looseObject({ sessionId: z.string().min(1) }),
		})
		.safeParse(payload);
	if (!parsed.success) {
		return { status: "invalid", detail: formatIssues(parsed.error) };
	}
	return { status: "ok", sessionId: parsed.data.session.sessionId };
}
