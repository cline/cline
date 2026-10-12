import { z } from "zod";
import { defineHubEvents, hubObject, hubRecord } from "./define";

/**
 * Hub event payload contract (HubEventEnvelope.payload).
 *
 * Payloads are not validated at runtime yet; these schemas record what the
 * Hub publishes so breaking changes show up in the JSON Schema snapshot.
 * A field is required only when every publish site emits it. The session id
 * of session-scoped events travels on the envelope (`sessionId`), not the
 * payload, unless noted.
 */

/** Hub runtime status (HubRuntimeStatus). */
const hubRuntimeStatus = z.enum([
	"idle",
	"running",
	"pending",
	"completed",
	"aborted",
	"failed",
]);

/** Top-level keys of SessionRecord (toHubSessionRecord). */
const sessionRecord = hubObject({
	sessionId: z.string(),
	workspaceRoot: z.string(),
	cwd: z.string().optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
	createdByClientId: z.string(),
	assignedSpokeId: z.string().optional(),
	status: hubRuntimeStatus,
	participants: z.array(hubRecord),
	activeRunId: z.string().optional(),
	runtimeOptions: hubRecord.optional(),
	metadata: hubRecord.optional(),
	runtimeSession: hubRecord.optional(),
	usage: hubRecord.optional(),
	aggregateUsage: hubRecord.optional(),
});

/** CoreSessionSnapshot (messages, status, ...); not pinned down here. */
const sessionSnapshot = hubRecord;

/** SessionPendingPrompt. */
const pendingPrompt = hubObject({
	id: z.string(),
	prompt: z.string(),
	delivery: z.enum(["queue", "steer"]),
	attachmentCount: z.number(),
	userImages: z.array(z.string()).optional(),
	userFiles: z.array(z.string()).optional(),
});

/** Which agent produced a notice/usage event (session-event-projector). */
const agentIdentity = hubObject({
	kind: z.enum(["lead", "subagent", "teammate"]),
	agentId: z.string().optional(),
	conversationId: z.string().optional(),
	parentAgentId: z.string().nullish(),
	teamAgentId: z.string().optional(),
	teamRole: z.enum(["lead", "teammate"]).optional(),
});

/** Token/cost counters in usage.updated (missing cache/cost default to 0). */
const usageCounters = hubObject({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheWriteTokens: z.number(),
	totalCost: z.number(),
});

/**
 * Terminal run payload. Published by run.start (with `result`), by the
 * projector on session end (`reason` + `snapshot`), and for run.failed also
 * on a thrown turn and on unreported agent errors (`error`, `text`).
 */
const terminalRunPayload = hubObject({
	/** AgentFinishReason from run.start; session-ended reason otherwise. */
	reason: z.string(),
	error: z.string().optional(),
	/** Set only by the projector's unreported-agent-error path (run.failed). */
	text: z.string().optional(),
	/** AgentResult of an RPC turn. */
	result: hubRecord.optional(),
	snapshot: sessionSnapshot.optional(),
});

/** Top-level keys of AgendaTaskRecord. */
const agendaTaskRecord = hubObject({
	taskId: z.string(),
	type: z.string(),
	status: z.string(),
	title: z.string(),
	description: z.string().optional(),
	instructions: z.string(),
	scope: z.string(),
	workspaceRoot: z.string().optional(),
	cwd: z.string().optional(),
	resourcePaths: z.array(z.string()),
	priority: z.number(),
	assignee: z.string().optional(),
	modelSelection: hubRecord.optional(),
	mode: z.string().optional(),
	systemPrompt: z.string().optional(),
	maxIterations: z.number().optional(),
	timeoutSeconds: z.number().optional(),
	availableAt: z.string(),
	expiresAt: z.string(),
	automationEligible: z.boolean(),
	revision: z.number(),
	approvedRevision: z.number().optional(),
	createdBy: hubRecord,
	updatedBy: hubRecord,
	originSessionId: z.string().optional(),
	originTaskId: z.string().optional(),
	currentRunId: z.string().optional(),
	lastRunId: z.string().optional(),
	lastSessionId: z.string().optional(),
	specPath: z.string().optional(),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().optional(),
	archivedAt: z.string().optional(),
});

/** Top-level keys of AgendaTaskRunRecord. */
const agendaTaskRunRecord = hubObject({
	runId: z.string(),
	taskId: z.string(),
	taskRevision: z.number(),
	attempt: z.number(),
	status: z.string(),
	claimToken: z.string().optional(),
	claimUntilAt: z.string().optional(),
	requestedByClientId: z.string().optional(),
	sessionId: z.string().optional(),
	claimedAt: z.string(),
	startedAt: z.string().optional(),
	completedAt: z.string().optional(),
	resultSummary: z.string().optional(),
	error: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

/** AgendaTaskManager.publish: `{ task, run? }`. */
const taskPayload = hubObject({
	task: agendaTaskRecord,
	run: agendaTaskRunRecord.optional(),
});

/** Same as taskPayload, but every publish site passes a run. */
const taskRunPayload = hubObject({
	task: agendaTaskRecord,
	run: agendaTaskRunRecord,
});

/** Top-level keys of ScheduleRecord. */
const scheduleRecord = hubObject({
	scheduleId: z.string(),
	name: z.string(),
	cronPattern: z.string(),
	timezone: z.string().optional(),
	prompt: z.string(),
	workspaceRoot: z.string(),
	cwd: z.string().optional(),
	modelSelection: hubRecord.optional(),
	enabled: z.boolean(),
	mode: z.string().optional(),
	systemPrompt: z.string().optional(),
	maxIterations: z.number().optional(),
	timeoutSeconds: z.number().optional(),
	maxParallel: z.number().optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
	nextRunAt: z.number().optional(),
	lastRunAt: z.number().optional(),
	createdBy: z.string().optional(),
	tags: z.array(z.string()).optional(),
	runtimeOptions: hubRecord.optional(),
	metadata: hubRecord.optional(),
});

/** ScheduleExecutionStatus. */
const scheduleExecutionStatus = z.enum([
	"pending",
	"running",
	"success",
	"completed",
	"failed",
	"timeout",
	"aborted",
]);

/** Top-level keys of ScheduleExecutionRecord. */
const scheduleExecutionRecord = hubObject({
	executionId: z.string(),
	scheduleId: z.string(),
	sessionId: z.string().optional(),
	triggeredAt: z.number(),
	startedAt: z.number().optional(),
	endedAt: z.number().optional(),
	status: scheduleExecutionStatus,
	exitCode: z.number().optional(),
	errorMessage: z.string().optional(),
	iterations: z.number().optional(),
	tokensUsed: z.number().optional(),
	costUsd: z.number().optional(),
});

/** CronRunner.publishScheduleExecutionEvent payload (no envelope sessionId). */
const scheduleExecutionEventPayload = hubObject({
	scheduleId: z.string(),
	executionId: z.string(),
	sessionId: z.string().optional(),
	triggeredAt: z.number(),
	startedAt: z.number().optional(),
	endedAt: z.number().optional(),
	status: scheduleExecutionStatus,
	errorMessage: z.string().optional(),
});

/**
 * Declared in HubEventName but no Hub code publishes it.
 * TODO(contract): define once the Hub emits this event.
 */
const unemittedPayload = hubRecord;

export const hubEvents = defineHubEvents({
	"hub.client.registered": {
		description: "A client registered with the Hub.",
		payload: hubObject({
			clientId: z.string(),
			clientType: z.string(),
			displayName: z.string().optional(),
			connectedAt: z.number(),
		}),
	},
	"hub.client.disconnected": {
		description: "A client unregistered from the Hub.",
		payload: hubObject({
			clientId: z.string(),
		}),
	},
	"session.created": {
		description: "A session was created or restored from a checkpoint.",
		payload: hubObject({
			session: sessionRecord,
			snapshot: sessionSnapshot.optional(),
		}),
	},
	"session.updated": {
		description: "A session's record or snapshot changed.",
		// Two shapes: `{ session, snapshot? }` (status/update/connection
		// changes) and `{ sessionId, snapshot }` (runtime session_snapshot).
		payload: hubObject({
			session: sessionRecord.optional(),
			sessionId: z.string().optional(),
			snapshot: sessionSnapshot.optional(),
		}),
	},
	"session.attached": {
		description: "A client attached to a session as a participant.",
		payload: hubObject({
			session: sessionRecord,
		}),
	},
	"session.detached": {
		description: "A client detached from a session.",
		// `session`/`snapshot` are omitted when the session no longer exists.
		payload: hubObject({
			clientId: z.string(),
			session: sessionRecord.optional(),
			snapshot: sessionSnapshot.optional(),
		}),
	},
	"session.forked": {
		description: "A session was forked (not currently emitted).",
		payload: unemittedPayload,
	},
	"session.pending_prompts": {
		description: "Full snapshot of a session's pending prompt queue.",
		payload: hubObject({
			sessionId: z.string(),
			prompts: z.array(pendingPrompt),
		}),
	},
	"session.pending_prompt_submitted": {
		description: "A queued prompt left the queue and started a turn.",
		payload: hubObject({
			sessionId: z.string(),
			prompt: pendingPrompt,
		}),
	},
	"run.started": {
		description: "A run.start / session.send_input turn began.",
		payload: hubObject({
			requestId: z.string().optional(),
			clientId: z.string().optional(),
		}),
	},
	"run.heartbeat": {
		description: "Periodic liveness signal for a long-running turn.",
		payload: hubObject({
			requestId: z.string().optional(),
			elapsedMs: z.number(),
			timeoutMs: z.number().optional(),
		}),
	},
	"run.aborted": {
		description: "A run ended because it was aborted.",
		payload: terminalRunPayload,
	},
	"run.completed": {
		description: "A run ended normally.",
		payload: terminalRunPayload,
	},
	"run.failed": {
		description: "A run ended with an error.",
		payload: terminalRunPayload,
	},
	"run.enqueued": {
		description: "A run was accepted into the durable run queue.",
		payload: hubObject({
			runId: z.string(),
			acceptedAt: z.number(),
			queuePosition: z.number(),
			clientId: z.string().optional(),
		}),
	},
	"run.interrupted": {
		description: "A queued run was interrupted by a Hub restart.",
		payload: hubObject({
			runId: z.string(),
			error: z.string().nullish(),
			reason: z.literal("hub_restart"),
		}),
	},
	"hub.drain_changed": {
		description: "The Hub entered or left drain mode.",
		payload: hubObject({
			draining: z.boolean(),
			reason: z.string().optional(),
		}),
	},
	"iteration.started": {
		description: "An agent loop iteration started.",
		payload: hubObject({
			iteration: z.number(),
		}),
	},
	"iteration.finished": {
		description: "An agent loop iteration finished.",
		payload: hubObject({
			iteration: z.number(),
			hadToolCalls: z.boolean(),
			toolCallCount: z.number(),
		}),
	},
	"assistant.delta": {
		description: "A non-empty chunk of assistant text.",
		payload: hubObject({
			text: z.string(),
		}),
	},
	"assistant.media": {
		description: "Generated media returned by the model.",
		payload: hubObject({
			// GeneratedMedia.
			media: hubRecord,
		}),
	},
	"assistant.finished": {
		description: "Assistant text content ended.",
		payload: hubObject({
			text: z.string().optional(),
		}),
	},
	"session.notice": {
		description: "An agent notice (recovery, stop, or status).",
		payload: hubObject({
			sessionId: z.string(),
			message: z.string(),
			noticeType: z.enum(["recovery", "stop", "status"]),
			displayRole: z.enum(["system", "status"]).optional(),
			reason: z.string().optional(),
			metadata: hubRecord.optional(),
			agent: agentIdentity,
		}),
	},
	"reasoning.delta": {
		description: "A chunk of model reasoning, possibly redacted.",
		payload: hubObject({
			text: z.string(),
			redacted: z.boolean(),
		}),
	},
	"reasoning.finished": {
		description: "Reasoning content ended.",
		payload: hubObject({
			reasoning: z.string().optional(),
		}),
	},
	"agent.done": {
		description: "The agent loop reported it finished.",
		payload: hubObject({
			// AgentFinishReason.
			reason: z.string(),
			text: z.string(),
			iterations: z.number(),
			// LegacyAgentUsage.
			usage: hubRecord.optional(),
		}),
	},
	"usage.updated": {
		description: "Token and cost usage for a model turn plus running totals.",
		payload: hubObject({
			sessionId: z.string(),
			delta: usageCounters,
			totals: usageCounters,
			// SessionUsageSummary, when the session host can report it.
			usage: hubRecord.optional(),
			aggregateUsage: hubRecord.optional(),
			agent: agentIdentity,
		}),
	},
	"tool.started": {
		description: "A tool call started.",
		// The hook projection sends only `toolName`.
		payload: hubObject({
			toolCallId: z.string().optional(),
			toolName: z.string().optional(),
			input: z.unknown().optional(),
		}),
	},
	"tool.updated": {
		description: "A tool call reported progress.",
		payload: hubObject({
			toolCallId: z.string().optional(),
			toolName: z.string().optional(),
			update: z.unknown().optional(),
		}),
	},
	"tool.finished": {
		description: "A tool call finished.",
		// The hook projection sends only `toolName`.
		payload: hubObject({
			toolCallId: z.string().optional(),
			toolName: z.string().optional(),
			output: z.unknown().optional(),
			error: z.string().optional(),
		}),
	},
	"approval.requested": {
		description: "A tool call is waiting for client approval.",
		payload: hubObject({
			approvalId: z.string(),
			sessionId: z.string(),
			agentId: z.string(),
			conversationId: z.string(),
			iteration: z.number(),
			toolCallId: z.string(),
			toolName: z.string(),
			/** JSON-encoded tool input (`"null"` when absent). */
			inputJson: z.string(),
			// ToolPolicy.
			policy: hubRecord.optional(),
			agendaTaskId: z.string().optional(),
		}),
	},
	"approval.resolved": {
		description: "A pending tool approval was answered or cancelled.",
		payload: hubObject({
			approvalId: z.string(),
			approved: z.boolean(),
			reason: z.string().optional(),
			cancelled: z.boolean().optional(),
		}),
	},
	"capability.requested": {
		description: "The Hub asks a specific client to run a capability.",
		payload: hubObject({
			requestId: z.string(),
			targetClientId: z.string(),
			capabilityName: z.string(),
			payload: hubRecord,
		}),
	},
	"capability.resolved": {
		description: "A capability request was answered or cancelled.",
		payload: hubObject({
			requestId: z.string(),
			capabilityName: z.string(),
			targetClientId: z.string(),
			respondedByClientId: z.string().optional(),
			ok: z.boolean(),
			cancelled: z.boolean().optional(),
			payload: hubRecord.optional(),
			error: z.string().optional(),
		}),
	},
	"team.progress": {
		description: "Team progress projection for a multi-agent session.",
		payload: hubObject({
			type: z.literal("team_progress_projection"),
			version: z.literal(1),
			sessionId: z.string(),
			// TeamProgressSummary.
			summary: hubRecord,
			// TeamProgressLifecycleEvent.
			lastEvent: hubRecord,
		}),
	},
	"artifact.created": {
		description: "An artifact was created (not currently emitted).",
		payload: unemittedPayload,
	},
	"diff.created": {
		description: "A diff was created (not currently emitted).",
		payload: unemittedPayload,
	},
	"spoke.started": {
		description: "A spoke started (not currently emitted).",
		payload: unemittedPayload,
	},
	"spoke.failed": {
		description: "A spoke failed (not currently emitted).",
		payload: unemittedPayload,
	},
	"spoke.stopped": {
		description: "A spoke stopped (not currently emitted).",
		payload: unemittedPayload,
	},
	"peer.registered": {
		description: "A peer Hub registered (not currently emitted).",
		payload: unemittedPayload,
	},
	"peer.session_attached": {
		description: "A peer attached to a session (not currently emitted).",
		payload: unemittedPayload,
	},
	"peer.session_detached": {
		description: "A peer detached from a session (not currently emitted).",
		payload: unemittedPayload,
	},
	"schedule.created": {
		description: "A schedule was created.",
		payload: hubObject({
			schedule: scheduleRecord,
		}),
	},
	"schedule.updated": {
		description: "A schedule was updated, enabled, or disabled.",
		// The schedule.update/enable/disable replies may lack `schedule`.
		payload: hubObject({
			schedule: scheduleRecord.optional(),
		}),
	},
	"schedule.deleted": {
		description: "A schedule was deleted.",
		// Only the agent schedule tool includes `scheduleId`.
		payload: hubObject({
			deleted: z.boolean(),
			scheduleId: z.string().optional(),
		}),
	},
	"schedule.triggered": {
		description: "A schedule was triggered manually.",
		payload: hubObject({
			execution: scheduleExecutionRecord.optional(),
		}),
	},
	"schedule.execution_completed": {
		description: "A scheduled run finished successfully.",
		payload: scheduleExecutionEventPayload,
	},
	"schedule.execution_failed": {
		description: "A scheduled run failed or was cancelled.",
		payload: scheduleExecutionEventPayload,
	},
	"task.created": {
		description: "An agenda task was created.",
		payload: taskPayload,
	},
	"task.updated": {
		description: "An agenda task changed.",
		payload: taskPayload,
	},
	"task.deleted": {
		description: "An agenda task was archived.",
		payload: taskPayload,
	},
	"task.run.started": {
		description: "An agenda task run started.",
		payload: taskRunPayload,
	},
	"task.run.completed": {
		description: "An agenda task run completed.",
		payload: taskRunPayload,
	},
	"task.run.failed": {
		description: "An agenda task run failed.",
		payload: taskRunPayload,
	},
	"task.automation.updated": {
		description: "The agenda automation policy changed.",
		payload: hubObject({
			// AgendaAutomationPolicy.
			policy: hubObject({
				scopeKey: z.string(),
				mode: z.string(),
				applyToAgentCreated: z.boolean(),
				maxConcurrentRuns: z.number(),
				maxChainDepth: z.number(),
				maxStartsPerHour: z.number(),
				enabledBy: hubRecord.optional(),
				enabledAt: z.string().optional(),
				updatedAt: z.string(),
			}),
		}),
	},
	"settings.changed": {
		description: "Settings were toggled via settings.toggle.",
		payload: hubObject({
			types: z.array(z.string()),
			snapshot: hubRecord,
		}),
	},
	"ui.notify": {
		description: "A user-facing notification for UI clients.",
		// Relayed verbatim from the ui.notify command; the Hub's own
		// completion notification always sets title, body, and severity.
		payload: hubObject({
			title: z.string().optional(),
			body: z.string().optional(),
			severity: z.enum(["info", "warning", "error"]).optional(),
			sessionId: z.string().optional(),
			clientId: z.string().optional(),
		}),
	},
	"ui.show_window": {
		description: "Ask UI clients to show a window.",
		// Relayed verbatim from the ui.show_window command.
		payload: hubObject({
			windowId: z.string().optional(),
			focus: z.boolean().optional(),
		}),
	},
	"hub.client.updated": {
		description: "A client's registration changed (not currently emitted).",
		payload: unemittedPayload,
	},
});
