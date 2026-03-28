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
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Max iterations per teammate run for spawn"),
	})
	.strict();

export const TeamShutdownTeammateInputSchema = z.object({
	agentId: z.string().min(1).describe("Teammate identifier"),
	reason: z.string().min(1).optional().describe("Optional shutdown reason"),
});

export const TeamStatusInputSchema = z.object({});

export const TeamTaskInputSchema = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("create"),
			title: z.string().min(1).describe("Task title"),
			description: z.string().min(1).describe("Task details"),
			dependsOn: z
				.array(z.string().describe("Dependency task ID"))
				.optional()
				.describe("Array of dependency task IDs"),
			assignee: z.string().min(1).optional().describe("Optional assignee"),
		})
		.strict(),
	z
		.object({
			action: z.literal("list"),
			status: z
				.enum(["pending", "in_progress", "blocked", "completed"])
				.optional()
				.describe("Optional task status filter"),
			assignee: z
				.string()
				.min(1)
				.optional()
				.describe("Optional assignee filter"),
			unassignedOnly: z
				.boolean()
				.optional()
				.describe("Only include tasks without an assignee"),
			readyOnly: z
				.boolean()
				.optional()
				.describe("Only include tasks ready to claim now"),
		})
		.strict(),
	z
		.object({
			action: z.literal("claim"),
			taskId: z.string().describe("Task ID"),
		})
		.strict(),
	z
		.object({
			action: z.literal("complete"),
			taskId: z.string().describe("Task ID"),
			summary: z.string().min(1).describe("Completion summary"),
		})
		.strict(),
	z
		.object({
			action: z.literal("block"),
			taskId: z.string().describe("Task ID"),
			reason: z.string().min(1).describe("Blocking reason"),
		})
		.strict(),
]);

export const TeamRunTaskInputSchema = z.object({
	agentId: z.string().describe("Teammate agent ID"),
	task: z.string().min(1).describe("Task instructions for the teammate"),
	taskId: z
		.string()
		.optional()
		.nullable()
		.describe("Optional shared task list ID"),
	runMode: z
		.enum(["sync", "async"])
		.optional()
		.nullable()
		.describe(
			"Execution mode: sync waits for result; async returns a runId immediately",
		),
	continueConversation: z
		.boolean()
		.optional()
		.nullable()
		.describe(
			"If true, continue the teammate conversation; otherwise start fresh",
		),
});

export const TeamListRunsInputSchema = z.object({
	status: z
		.enum([
			"queued",
			"running",
			"completed",
			"failed",
			"cancelled",
			"interrupted",
		])
		.nullable()
		.optional()
		.describe("Optional run status filter. Omit to include all statuses."),
	agentId: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.describe("Optional teammate ID filter. Omit to include all teammates."),
	includeCompleted: z
		.boolean()
		.optional()
		.nullable()
		.describe("Include completed/failed runs (default true)"),
});

export const TeamCancelRunInputSchema = z.object({
	runId: z.string().min(1).describe("Run ID"),
	reason: z.string().min(1).optional().describe("Optional cancellation reason"),
});

export const TeamAwaitRunInputSchema = z.object({
	runId: z.string().min(1).describe("Async run ID to await"),
});

export const TeamAwaitAllRunsInputSchema = z.object({});

export const TeamSendMessageInputSchema = z.object({
	toAgentId: z.string().min(1).describe("Recipient agent ID"),
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: z
		.string()
		.min(1)
		.optional()
		.nullable()
		.describe("Optional task ID context"),
});

export const TeamBroadcastInputSchema = z.object({
	subject: z.string().min(1).describe("Message subject"),
	body: z.string().min(1).describe("Message body"),
	taskId: z
		.string()
		.min(1)
		.optional()
		.nullable()
		.describe("Optional task ID context"),
	includeLead: z
		.boolean()
		.optional()
		.nullable()
		.describe("Include the lead agent in broadcast recipients"),
});

export const TeamReadMailboxInputSchema = z.object({
	unreadOnly: z
		.boolean()
		.optional()
		.describe("Only unread messages for read action (default true)"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.describe("Optional max number of messages for read action"),
});

export const TeamLogUpdateInputSchema = z.object({
	kind: z.enum(["progress", "handoff", "blocked", "decision", "done", "error"]),
	summary: z.string().min(1).describe("Update summary"),
	taskId: z.string().min(1).optional().describe("Optional task ID context"),
	evidence: z
		.array(z.string().min(1))
		.optional()
		.describe("Optional evidence links/snippets"),
	nextAction: z.string().min(1).optional().describe("Planned next step"),
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
	sourceRunId: z.string().optional().describe("Optional source run ID"),
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
