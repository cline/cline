import { z } from "zod";
import type { TeamRunRecord, TeamTaskListItem } from "./multi-agent";

export const DEFAULT_OUTCOME_REQUIRED_SECTIONS = [
	"current_state",
	"boundary_analysis",
	"interface_proposal",
];
export const TEAM_AWAIT_TIMEOUT_MS = 60 * 60 * 1000;
export const TEAM_RUN_MESSAGE_PREVIEW_LIMIT = 240;
export const TEAM_RUN_TEXT_PREVIEW_LIMIT = 400;

function nullableOptional<T extends z.ZodTypeAny>(schema: T) {
	return z.preprocess(
		(value) => (value === null ? undefined : value),
		schema.optional(),
	);
}

export interface TeamTeammateSpec {
	agentId: string;
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
}

export const TeamSpawnTeammateInputSchema = z
	.object({
		agentId: z.string().min(1).describe("Teammate identifier"),
		rolePrompt: z
			.string()
			.min(1)
			.describe("System prompt describing teammate role"),
		maxIterations: z
			.preprocess(
				(value) => (value === null ? undefined : value),
				z.number().int().min(1).optional(),
			)
			.describe("Max iterations per teammate run for spawn"),
	})
	.strict();

export const TeamShutdownTeammateInputSchema = z.object({
	agentId: z.string().min(1).describe("Teammate identifier"),
	reason: nullableOptional(z.string().min(1)).describe(
		"Optional shutdown reason",
	),
});

export const TeamStatusInputSchema = z.object({});

const TEAM_TASK_FIELDS_BY_ACTION = {
	create: ["title", "description", "dependsOn", "assignee"],
	list: ["status", "assignee", "unassignedOnly", "readyOnly"],
	claim: ["taskId"],
	complete: ["taskId", "summary"],
	block: ["taskId", "reason"],
} as const;

const TEAM_TASK_REQUIRED_FIELDS_BY_ACTION = {
	create: ["title", "description"],
	list: [],
	claim: ["taskId"],
	complete: ["taskId", "summary"],
	block: ["taskId", "reason"],
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
		unassignedOnly: nullableOptional(z.boolean()).describe(
			"Only include tasks without an assignee",
		),
		readyOnly: nullableOptional(z.boolean()).describe(
			"Only include tasks ready to claim now",
		),
		taskId: nullableOptional(z.string()).describe("Task ID"),
		summary: nullableOptional(z.string().min(1)).describe("Completion summary"),
		reason: nullableOptional(z.string().min(1)).describe("Blocking reason"),
	})
	.superRefine((input, ctx) => {
		const allowedFields = new Set([
			"action",
			...TEAM_TASK_FIELDS_BY_ACTION[input.action],
		]);
		for (const [key, value] of Object.entries(input)) {
			if (key === "action" || value === undefined || allowedFields.has(key)) {
				continue;
			}
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: `Field "${key}" is not allowed when action=${input.action}`,
			});
		}

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
		"Execution mode: sync waits for result; async returns a runId immediately",
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

export const TeamAwaitRunInputSchema = z.object({
	runId: z.string().min(1).describe("Async run ID to await"),
});

export const TeamAwaitAllRunsInputSchema = z.object({});

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
	includeLead: nullableOptional(z.boolean()).describe(
		"Include the lead agent in broadcast recipients",
	),
});

export const TeamReadMailboxInputSchema = z.object({
	unreadOnly: nullableOptional(z.boolean()).describe(
		"Only unread messages for read action (default true)",
	),
	limit: nullableOptional(z.number().int().min(1).max(100)).describe(
		"Optional max number of messages for read action",
	),
});

export const TeamLogUpdateInputSchema = z.object({
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
export type TeamAwaitRunInput = z.infer<typeof TeamAwaitRunInputSchema>;
export type TeamAwaitAllRunsInput = z.infer<typeof TeamAwaitAllRunsInputSchema>;
export type TeamSendMessageInput = z.infer<typeof TeamSendMessageInputSchema>;
export type TeamBroadcastInput = z.infer<typeof TeamBroadcastInputSchema>;
export type TeamReadMailboxInput = z.infer<typeof TeamReadMailboxInputSchema>;
export type TeamLogUpdateInput = z.infer<typeof TeamLogUpdateInputSchema>;
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

export interface TeamRunResultSummary {
	textPreview: string;
	iterations: number;
	finishReason: string;
	durationMs: number;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
}

export interface TeamRunToolSummary {
	id: string;
	agentId: string;
	taskId?: string;
	status: TeamRunRecord["status"];
	messagePreview: string;
	priority: number;
	retryCount: number;
	maxRetries: number;
	nextAttemptAt?: Date;
	continueConversation?: boolean;
	startedAt: Date;
	endedAt?: Date;
	leaseOwner?: string;
	heartbeatAt?: Date;
	lastProgressAt?: Date;
	lastProgressMessage?: string;
	currentActivity?: string;
	error?: string;
	resultSummary?: TeamRunResultSummary;
}

export type TeamTaskToolResult =
	| { action: "create"; taskId: string; status: string }
	| { action: "list"; tasks: TeamTaskListItem[] }
	| { action: "claim"; taskId: string; status: string; nextStep: string }
	| { action: "complete"; taskId: string; status: string }
	| { action: "block"; taskId: string; status: string };
