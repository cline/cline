/**
 * Team tool schemas.
 *
 * Zod schemas, constants, and schema-derived types for the team tool surface.
 */

import { z } from "zod";

export const DEFAULT_OUTCOME_REQUIRED_SECTIONS = [
	"current_state",
	"boundary_analysis",
	"interface_proposal",
];
export const TEAM_AWAIT_TIMEOUT_MS = 60 * 60 * 1000;
export const TEAM_RUN_MESSAGE_PREVIEW_LIMIT = 240;
export const TEAM_RUN_TEXT_PREVIEW_LIMIT = 400;

const IsoTimestampSchema = z.preprocess(
	(value) => (value instanceof Date ? value.toISOString() : value),
	z.string().datetime(),
);

const TeamTaskStatusSchema = z.enum([
	"pending",
	"in_progress",
	"blocked",
	"completed",
]);

const TeamRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
]);

const TeamOutcomeStatusSchema = z.enum(["draft", "in_review", "finalized"]);

const TeamMemberSnapshotSchema = z.object({
	agentId: z.string(),
	role: z.enum(["lead", "teammate"]),
	description: z.string().optional(),
	status: z.enum(["idle", "running", "stopped"]),
});

export const TeamTeammateSpecSchema = z.object({
	agentId: z.string(),
	rolePrompt: z.string(),
	modelId: z.string().optional(),
	maxIterations: z.number().optional(),
});

function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(value) => (value === null ? undefined : value),
		schema.optional(),
	);
}

export const TeamSpawnTeammateInputSchema = z
	.object({
		agentId: z.string().min(1).describe("Teammate identifier"),
		rolePrompt: z
			.string()
			.min(1)
			.describe("System prompt describing teammate role"),
	})
	.strict();

export const TeamShutdownTeammateInputSchema = z.object({
	agentId: z.string().min(1).describe("Teammate identifier"),
	reason: nullableOptional(z.string().min(1)).describe(
		"Optional shutdown reason",
	),
});

export const TeamStatusInputSchema = z.object({});

const TEAM_TASK_REQUIRED_FIELDS_BY_ACTION = {
	create: ["title", "description"],
	list: [],
	claim: ["taskId"],
	complete: ["taskId", "summary"],
	block: ["taskId", "reason"],
} as const;

type TeamTaskAction = "create" | "list" | "claim" | "complete" | "block";

export const TEAM_TASK_IGNORED_FIELDS_BY_ACTION: Partial<
	Record<TeamTaskAction, readonly string[]>
> = {
	create: ["status", "taskId", "summary", "reason"],
} as const;

export const TeamTaskInputSchema = z
	.object({
		action: z.enum(["create", "list", "claim", "complete", "block"]),
		title: nullableOptional(z.string().min(1)).describe("Task title"),
		description: nullableOptional(z.string().min(1)).describe("Task details"),
		dependsOn: nullableOptional(
			z.array(z.string().describe("Dependency task ID")),
		).describe("Array of dependency task IDs"),
		assignee: nullableOptional(z.string().min(1)).describe("Optional assignee"),
		status: nullableOptional(
			z.enum(["pending", "in_progress", "blocked", "completed"]),
		).describe("Optional task status filter"),
		taskId: nullableOptional(z.string()).describe("Task ID"),
		summary: nullableOptional(z.string().min(1)).describe("Completion summary"),
		reason: nullableOptional(z.string().min(1)).describe("Blocking reason"),
	})
	.superRefine((input, ctx) => {
		for (const field of TEAM_TASK_REQUIRED_FIELDS_BY_ACTION[input.action]) {
			if (input[field] !== undefined) {
				continue;
			}
			ctx.addIssue({
				code: "custom",
				path: [field],
				message: `Field "${field}" is required when action=${input.action}`,
			});
		}
	});

export const TeamRunTaskInputSchema = z.object({
	agentId: z.string().describe("Teammate agent ID"),
	task: z.string().min(1).describe("Task instructions for the teammate"),
	taskId: nullableOptional(z.string()).describe("Optional shared task list ID"),
	runMode: nullableOptional(z.enum(["sync", "async"])).describe(
		"Execution mode: 'sync' blocks until the teammate finishes and returns the result (default if omitted); 'async' queues the run and returns a runId immediately — use team_await_runs to collect results later.",
	),
	continueConversation: nullableOptional(z.boolean()).describe(
		"If true, continue the teammate conversation; otherwise start fresh",
	),
});

export const TeamListRunsInputSchema = z.object({
	status: nullableOptional(
		z.enum([
			"queued",
			"running",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		]),
	).describe("Optional run status filter. Omit to include all statuses."),
	agentId: nullableOptional(z.string().min(1)).describe(
		"Optional teammate ID filter. Omit to include all teammates.",
	),
	includeCompleted: nullableOptional(z.boolean()).describe(
		"Include completed/failed runs (default true)",
	),
});

export const TeamCancelRunInputSchema = z.object({
	runId: z.string().min(1).describe("Run ID"),
	reason: nullableOptional(z.string().min(1)).describe(
		"Optional cancellation reason",
	),
});

export const TeamAwaitRunsInputSchema = z
	.object({
		runId: nullableOptional(z.string().min(1)).describe(
			"Optional async run ID to await. Omit to wait for all active async runs.",
		),
	})
	.strict();

export const TeamSendMessageInputSchema = z.object({
	toAgentId: z.string().min(1).describe("Recipient agent ID"),
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: nullableOptional(z.string().min(1)).describe(
		"Optional task ID context",
	),
});

export const TeamBroadcastInputSchema = z.object({
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: nullableOptional(z.string().min(1)).describe(
		"Optional task ID context",
	),
});

export const TeamReadMailboxInputSchema = z.object({
	unreadOnly: nullableOptional(z.boolean()).describe(
		"Only unread messages for read action (default true)",
	),
});

export const TeamMissionLogInputSchema = z.object({
	kind: z.enum(["progress", "handoff", "blocked", "decision", "done", "error"]),
	summary: z.string().min(1).describe("Update summary"),
	taskId: nullableOptional(z.string().min(1)).describe(
		"Optional task ID context",
	),
	evidence: nullableOptional(z.array(z.string().min(1))).describe(
		"Optional evidence links/snippets",
	),
	nextAction: nullableOptional(z.string().min(1)).describe("Planned next step"),
});

export const TeamCleanupInputSchema = z.object({});

export const TeamCreateOutcomeInputSchema = z.object({
	title: z.string().describe("Outcome title"),
	requiredSections: z
		.array(z.string())
		.default(DEFAULT_OUTCOME_REQUIRED_SECTIONS)
		.describe(
			"Required sections for finalization gate (defaults to current_state,boundary_analysis,interface_proposal)",
		),
});

export const TeamAttachOutcomeFragmentInputSchema = z.object({
	outcomeId: z.string().describe("Outcome ID"),
	section: z.string().describe("Section name"),
	sourceRunId: nullableOptional(z.string()).describe("Optional source run ID"),
	content: z.string().describe("Section fragment content"),
});

export const TeamReviewOutcomeFragmentInputSchema = z.object({
	fragmentId: z.string().describe("Fragment ID"),
	approved: z.boolean().describe("Review decision"),
});

export const TeamFinalizeOutcomeInputSchema = z.object({
	outcomeId: z.string().describe("Outcome ID"),
});

export const TeamListOutcomesInputSchema = z.object({});

export type TeamSpawnTeammateInput = z.infer<
	typeof TeamSpawnTeammateInputSchema
>;
export type TeamShutdownTeammateInput = z.infer<
	typeof TeamShutdownTeammateInputSchema
>;
export type TeamStatusInput = z.infer<typeof TeamStatusInputSchema>;
export type TeamTaskInput = z.infer<typeof TeamTaskInputSchema>;
export type TeamRunTaskInput = z.infer<typeof TeamRunTaskInputSchema>;
export type TeamListRunsInput = z.infer<typeof TeamListRunsInputSchema>;
export type TeamCancelRunInput = z.infer<typeof TeamCancelRunInputSchema>;
export type TeamAwaitRunsInput = z.infer<typeof TeamAwaitRunsInputSchema>;
export type TeamSendMessageInput = z.infer<typeof TeamSendMessageInputSchema>;
export type TeamBroadcastInput = z.infer<typeof TeamBroadcastInputSchema>;
export type TeamReadMailboxInput = z.infer<typeof TeamReadMailboxInputSchema>;
export type TeamMissionLogInput = z.infer<typeof TeamMissionLogInputSchema>;
export type TeamCleanupInput = z.infer<typeof TeamCleanupInputSchema>;
export type TeamCreateOutcomeInput = z.infer<
	typeof TeamCreateOutcomeInputSchema
>;
export type TeamAttachOutcomeFragmentInput = z.infer<
	typeof TeamAttachOutcomeFragmentInputSchema
>;
export type TeamReviewOutcomeFragmentInput = z.infer<
	typeof TeamReviewOutcomeFragmentInputSchema
>;
export type TeamFinalizeOutcomeInput = z.infer<
	typeof TeamFinalizeOutcomeInputSchema
>;
export type TeamListOutcomesInput = z.infer<typeof TeamListOutcomesInputSchema>;

export type TeamTeammateSpec = z.infer<typeof TeamTeammateSpecSchema>;

export const TeamStatusToolResultSchema = z.object({
	teamId: z.string(),
	teamName: z.string(),
	members: z.array(TeamMemberSnapshotSchema),
	taskCounts: z.record(TeamTaskStatusSchema, z.number()),
	unreadMessages: z.number(),
	missionLogEntries: z.number(),
	activeRuns: z.number(),
	queuedRuns: z.number(),
	outcomeCounts: z.record(TeamOutcomeStatusSchema, z.number()),
});

export const TeamTaskListItemToolResultSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	status: TeamTaskStatusSchema,
	createdAt: IsoTimestampSchema,
	updatedAt: IsoTimestampSchema,
	createdBy: z.string(),
	assignee: z.string().optional(),
	dependsOn: z.array(z.string()),
	summary: z.string().optional(),
	isReady: z.boolean(),
	blockedBy: z.array(z.string()),
});

export const TeamTaskToolResultSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("create"),
		taskId: z.string(),
		status: TeamTaskStatusSchema,
		ignoredFields: z.array(z.string()).optional(),
		note: z.string().optional(),
	}),
	z.object({
		action: z.literal("list"),
		tasks: z.array(TeamTaskListItemToolResultSchema),
	}),
	z.object({
		action: z.literal("claim"),
		taskId: z.string(),
		status: TeamTaskStatusSchema,
		nextStep: z.string(),
	}),
	z.object({
		action: z.literal("complete"),
		taskId: z.string(),
		status: TeamTaskStatusSchema,
	}),
	z.object({
		action: z.literal("block"),
		taskId: z.string(),
		status: TeamTaskStatusSchema,
	}),
]);

export const TeamRunTaskToolResultSchema = z.object({
	agentId: z.string(),
	mode: z.enum(["sync", "async"]),
	status: z.enum(["dispatched", "running", "queued", "joined"]),
	dispatched: z.boolean(),
	message: z.string(),
	deduped: z.boolean().optional(),
	runId: z.string().optional(),
	text: z.string().optional(),
	iterations: z.number().optional(),
});

export const TeamRunResultSummarySchema = z.object({
	textPreview: z.string(),
	iterations: z.number(),
	finishReason: z.string(),
	durationMs: z.number(),
	usage: z.object({
		inputTokens: z.number(),
		outputTokens: z.number(),
		cacheReadTokens: z.number().optional(),
		cacheWriteTokens: z.number().optional(),
		totalCost: z.number().optional(),
	}),
});

export const TeamRunToolSummarySchema = z.object({
	id: z.string(),
	agentId: z.string(),
	taskId: z.string().optional(),
	status: TeamRunStatusSchema,
	messagePreview: z.string(),
	priority: z.number(),
	retryCount: z.number(),
	maxRetries: z.number(),
	nextAttemptAt: IsoTimestampSchema.optional(),
	continueConversation: z.boolean().optional(),
	startedAt: IsoTimestampSchema,
	endedAt: IsoTimestampSchema.optional(),
	leaseOwner: z.string().optional(),
	heartbeatAt: IsoTimestampSchema.optional(),
	lastProgressAt: IsoTimestampSchema.optional(),
	lastProgressMessage: z.string().optional(),
	currentActivity: z.string().optional(),
	error: z.string().optional(),
	resultSummary: TeamRunResultSummarySchema.optional(),
});

export const TeamMailboxMessageToolResultSchema = z.object({
	id: z.string(),
	teamId: z.string(),
	fromAgentId: z.string(),
	toAgentId: z.string(),
	subject: z.string(),
	body: z.string(),
	taskId: z.string().optional(),
	sentAt: IsoTimestampSchema,
	readAt: IsoTimestampSchema.optional(),
});

export const TeamOutcomeToolResultSchema = z.object({
	id: z.string(),
	teamId: z.string(),
	title: z.string(),
	status: TeamOutcomeStatusSchema,
	requiredSections: z.array(z.string()),
	createdBy: z.string(),
	createdAt: IsoTimestampSchema,
	finalizedAt: IsoTimestampSchema.optional(),
});

export const TeamCreateOutcomeToolResultSchema = z.object({
	outcomeId: z.string(),
	status: TeamOutcomeStatusSchema,
	requiredSections: z.array(z.string()),
});

export const TeamSimpleAgentStatusToolResultSchema = z.object({
	agentId: z.string(),
	status: z.string(),
});

export const TeamCancelRunToolResultSchema = z.object({
	runId: z.string(),
	status: TeamRunStatusSchema,
});

export const TeamSendMessageToolResultSchema = z.object({
	id: z.string(),
	toAgentId: z.string(),
});

export const TeamBroadcastToolResultSchema = z.object({
	delivered: z.number(),
});

export const TeamMissionLogToolResultSchema = z.object({
	id: z.string(),
});

export const TeamCleanupToolResultSchema = z.object({
	status: z.string(),
});

export const TeamOutcomeFragmentToolResultSchema = z.object({
	fragmentId: z.string(),
	status: z.string(),
});

export const TeamFinalizeOutcomeToolResultSchema = z.object({
	outcomeId: z.string(),
	status: TeamOutcomeStatusSchema,
});

export type TeamRunResultSummary = z.infer<typeof TeamRunResultSummarySchema>;
export type TeamRunToolSummary = z.infer<typeof TeamRunToolSummarySchema>;
export type TeamTaskToolResult = z.infer<typeof TeamTaskToolResultSchema>;
export type TeamRunTaskToolResult = z.infer<typeof TeamRunTaskToolResultSchema>;
export type TeamStatusToolResult = z.infer<typeof TeamStatusToolResultSchema>;
export type TeamMailboxMessageToolResult = z.infer<
	typeof TeamMailboxMessageToolResultSchema
>;
export type TeamOutcomeToolResult = z.infer<typeof TeamOutcomeToolResultSchema>;
export type TeamCreateOutcomeToolResult = z.infer<
	typeof TeamCreateOutcomeToolResultSchema
>;
