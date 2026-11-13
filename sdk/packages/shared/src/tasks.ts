import { z } from "zod";
import type {
	FactoryDesignReview,
	FactoryDuplicateReports,
	FactoryRunState,
	FactoryTaskConfig,
} from "./factory";
import {
	factoryAgentsSchema,
	factoryDesignConclusionSchema,
	factoryReviewerResultSchema,
	factoryReviewSelectionSchema,
	selectFactoryReviewAgents,
} from "./factory";
import type {
	FactoryPriorityInput,
	FactoryPriorityState,
} from "./factory-priority";
import type { GatewayModelSelection } from "./llms/gateway";

const factoryQuestionFields = {
	questionId: z.string(),
	revision: z.number().int(),
	sessionId: z.string(),
	question: z.string(),
	options: z.array(z.string()).optional(),
	createdAt: z.string(),
};
export const factoryQuestionSchema = z.discriminatedUnion("status", [
	z.object({ ...factoryQuestionFields, status: z.literal("pending") }),
	z.object({
		...factoryQuestionFields,
		status: z.literal("answered"),
		answer: z.string(),
		answeredAt: z.string(),
	}),
]);
export type FactoryQuestion = z.infer<typeof factoryQuestionSchema>;

/**
 * How scoping ran for a card's plan. `prepared`: the plan came with the
 * request and Factory checked it quickly instead of running a designer;
 * `designer`: the designer scoped it, here because a supplied plan was not
 * used (`reason`). Absent: an ordinary card (the designer scoped it).
 */
export const factoryDesignRouteSchema = z.object({
	scoping: z.enum(["prepared", "designer"]),
	/** Who supplied the plan: the card's intake source (such as `agent` or a routine's name). */
	source: z.string().max(200).optional(),
	/** The repository paths the supplied plan said it touches. */
	paths: z.array(z.string().max(1000)).max(100).optional(),
	/**
	 * The deepest quick-check level that ran: `model` (the deterministic
	 * validation and one capped plan reviewer). `checks` (no model) is only on
	 * cards scoped before every supplied plan got the plan reviewer.
	 */
	sweep: z.enum(["checks", "model"]).optional(),
	/** Why the supplied plan went to the designer. */
	reason: z.string().max(4000).optional(),
	/**
	 * The supplied checks, run once at the base commit as the first step of
	 * the approved run, before any builder.
	 * `fails`: at least one fails there (the plan proves a change);
	 * `all_pass`: nothing to prove; `inconclusive`: a check could not run
	 * (missing tool, timeout, no worktree).
	 */
	base: z
		.object({
			commit: z.string().optional(),
			outcome: z.enum(["fails", "all_pass", "inconclusive"]),
			checks: z
				.array(
					z.object({
						name: z.string(),
						status: z.enum(["passed", "failed", "inconclusive"]),
						exitCode: z.number().int().nullable().optional(),
						/** First line of output or the reason, bounded. */
						detail: z.string().max(1000).optional(),
					}),
				)
				.max(20),
			durationMs: z.number().int().nonnegative(),
			at: z.string(),
		})
		.optional(),
});
export type FactoryDesignRoute = z.infer<typeof factoryDesignRouteSchema>;

const factoryDesignProgressFields = {
	/** The brief this design started from; generated plans replace task instructions. */
	originalRequest: z.string().optional(),
	reviewSelection: factoryReviewSelectionSchema.optional(),
	formatRetries: z.number().int().nonnegative().optional(),
	formatFeedback: z.string().max(120_000).optional(),
	revision: z.number().int().positive(),
	repairRound: z.number().int().nonnegative(),
	agents: factoryAgentsSchema,
	designerSessionId: z.string().min(1),
	findings: z.array(z.string()),
	/**
	 * The plan-fault findings Factory last sent back to scoping by itself for
	 * this card's plan lineage; the same set again stops instead of looping.
	 */
	planFaultFindings: z.array(z.string()).optional(),
	/**
	 * How many times Factory sent this plan lineage back to scoping by itself
	 * for a plan fault, whatever the findings' wording; capped at
	 * FACTORY_MAX_PLAN_FAULT_REDESIGNS. A person's edit starts a new lineage.
	 */
	planFaultRedesigns: z.number().int().nonnegative().optional(),
	/**
	 * Re-scopes an agent (not a person) made of this card after it stopped;
	 * capped at FACTORY_MAX_AGENT_RETRIES with run retries' `agentRetries`.
	 */
	agentRetries: z.number().int().nonnegative().optional(),
	/** Set only with phase "complete": the designer found nothing to build at this revision. */
	conclusion: factoryDesignConclusionSchema.optional(),
	/** How scoping ran when the request came with a plan (see factoryDesignRouteSchema). */
	route: factoryDesignRouteSchema.optional(),
	/**
	 * A person (not automatic approval) approved this plan revision, and when.
	 * Runs freeze it as `planApprovedByPerson`, so delivery asks only about
	 * what went beyond the plan (factoryStampRequirement).
	 */
	approvedByPerson: z.object({ at: z.string() }).optional(),
};
export const factoryDesignProgressSchema = z
	.discriminatedUnion("phase", [
		z.object({ ...factoryDesignProgressFields, phase: z.literal("designing") }),
		z.object({
			...factoryDesignProgressFields,
			phase: z.enum(["reviewing", "complete"]),
			reviewerSessions: z.array(
				z.object({
					reviewerIndex: z.number().int().nonnegative(),
					sessionId: z.string().min(1),
				}),
			),
			reviews: z.array(factoryReviewerResultSchema),
		}),
	])
	.superRefine((progress, context) => {
		try {
			selectFactoryReviewAgents(progress.agents, progress.reviewSelection);
		} catch (error) {
			context.addIssue({
				code: "custom",
				path: ["reviewSelection"],
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
export type FactoryDesignProgress = z.infer<typeof factoryDesignProgressSchema>;

/** Semantic labels used to group work on a user's agenda. */
export type AgendaTaskType =
	| "suggestion"
	| "follow-up"
	| "todo"
	| "handoff"
	| "idea"
	| "reminder";

export type AgendaTaskStatus =
	| "pending_approval"
	| "approved"
	| "in_progress"
	| "completed"
	| "failed"
	| "cancelled"
	| "expired";

/** Lower numbers are more urgent. P3 is the default priority. */
export type AgendaTaskPriority = 0 | 1 | 2 | 3 | 4 | 5;

export type AgendaTaskScope = "workspace" | "global";

export interface AgendaTaskActor {
	kind: "user" | "agent" | "system" | "automation_policy";
	id?: string;
	displayName?: string;
	clientId?: string;
	sessionId?: string;
	agentId?: string;
}

export type AgendaTaskRunStatus =
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "interrupted";

export interface AgendaTaskRecord {
	factoryQuestions?: FactoryQuestion[];
	factoryDesignSessionIds?: string[];
	factoryDesignProgress?: FactoryDesignProgress;
	factory?: FactoryTaskConfig;
	factoryDesignReview?: FactoryDesignReview;
	/**
	 * The Factory queue entry waiting for this card, when there is one:
	 * `design` waits to start scoping, `run` waits to start execution.
	 */
	factoryQueued?: "design" | "run";
	/**
	 * When the card's current Factory queue entry was created, present with
	 * `factoryQueued`. The queue starts work by priority rank, then this.
	 */
	factoryQueuedAt?: string;
	/**
	 * The Factory card's priority; absent means No priority. Not the agenda
	 * `priority`: it is stored on its own, so changing it never revises the
	 * plan, revokes approval or changes status, and plan edits keep it.
	 */
	factoryPriority?: FactoryPriorityState;
	/**
	 * Later filings matched to this card as repeats of the same work. Stored
	 * on its own, so recording one never revises the plan, revokes approval
	 * or changes `updatedAt`.
	 */
	factoryDuplicateReports?: FactoryDuplicateReports;
	/**
	 * The card's short number within its Hub task database, shown as
	 * `F<n>` (see `formatFactoryId`). Present on Factory cards; assigned at
	 * creation and never reused.
	 */
	factoryNumber?: number;
	taskId: string;
	type: AgendaTaskType;
	status: AgendaTaskStatus;
	title: string;
	description?: string;
	instructions: string;
	scope: AgendaTaskScope;
	workspaceRoot?: string;
	cwd?: string;
	resourcePaths: string[];
	priority: AgendaTaskPriority;
	assignee?: string;
	modelSelection?: GatewayModelSelection;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	/** Task cannot be started before this ISO-8601 timestamp. */
	availableAt: string;
	/** Required latest-start timestamp. */
	expiresAt: string;
	automationEligible: boolean;
	revision: number;
	approvedRevision?: number;
	createdBy: AgendaTaskActor;
	updatedBy: AgendaTaskActor;
	originSessionId?: string;
	originTaskId?: string;
	currentRunId?: string;
	lastRunId?: string;
	lastSessionId?: string;
	/** Canonical Markdown source file backing this task. */
	specPath?: string;
	error?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	archivedAt?: string;
}

export interface AgendaTaskRunRecord {
	factory?: FactoryRunState;
	runId: string;
	taskId: string;
	taskRevision: number;
	attempt: number;
	status: AgendaTaskRunStatus;
	claimToken?: string;
	claimUntilAt?: string;
	requestedByClientId?: string;
	sessionId?: string;
	claimedAt: string;
	startedAt?: string;
	completedAt?: string;
	resultSummary?: string;
	error?: string;
	createdAt: string;
	updatedAt: string;
}

export interface AgendaTaskCreateInput {
	factory?: FactoryTaskConfig;
	/** Queue initial Factory design unless false; applies only to this creation request. */
	queueFactoryDesign?: boolean;
	/**
	 * Factory cards only. The manager clamps an agent's or scoper's `urgent`
	 * to `high`; the Hub records a client's value as the person's.
	 */
	factoryPriority?: FactoryPriorityInput;
	taskId?: string;
	type: AgendaTaskType;
	title: string;
	description?: string;
	instructions: string;
	scope: AgendaTaskScope;
	workspaceRoot?: string;
	cwd?: string;
	resourcePaths?: string[];
	priority?: AgendaTaskPriority;
	assignee?: string;
	modelSelection?: GatewayModelSelection;
	mode?: "act" | "plan" | "yolo";
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	availableAt?: string;
	expiresAt: string;
	automationEligible?: boolean;
	/** False only when a trusted interactive user directly authored the item. */
	requiresApproval?: boolean;
	createdBy: AgendaTaskActor;
	originSessionId?: string;
	originTaskId?: string;
	/** Optional explicit source path; managers normally derive this. */
	specPath?: string;
}

/** Editable task fields. Lifecycle transitions are owned by the task manager. */
export interface AgendaTaskUpdateInput {
	factory?: FactoryTaskConfig | null;
	taskId: string;
	expectedRevision: number;
	type?: AgendaTaskType;
	title?: string;
	description?: string | null;
	instructions?: string;
	scope?: AgendaTaskScope;
	workspaceRoot?: string | null;
	cwd?: string | null;
	resourcePaths?: string[];
	priority?: AgendaTaskPriority;
	assignee?: string | null;
	modelSelection?: GatewayModelSelection | null;
	mode?: "act" | "plan" | "yolo" | null;
	systemPrompt?: string | null;
	maxIterations?: number | null;
	timeoutSeconds?: number | null;
	availableAt?: string;
	expiresAt?: string;
	automationEligible?: boolean;
	updatedBy: AgendaTaskActor;
}

export interface AgendaTaskListInput {
	statuses?: AgendaTaskStatus[];
	types?: AgendaTaskType[];
	/** Explicit scope filtering. Omit to include global tasks with a workspace view. */
	scope?: AgendaTaskScope;
	/**
	 * Selected workspace. With no explicit scope, results contain global tasks plus
	 * tasks for this workspace. `scope: "workspace"` is workspace-only, while
	 * `scope: "global"` ignores this value and remains global-only.
	 */
	workspaceRoot?: string;
	priorities?: AgendaTaskPriority[];
	automationEligible?: boolean;
	availableBefore?: string;
	includeArchived?: boolean;
	/** Only Factory replays of this source run, newest first. */
	factoryReplaySourceRunId?: string;
	/** Only Factory replays created by this comparison request. */
	factoryComparisonId?: string;
	/** Only Factory cards, newest first. */
	factoryOnly?: boolean;
	limit?: number;
}

export type AgendaAutomationMode = "manual" | "auto_start" | "unattended";

export interface AgendaAutomationPolicy {
	/** `global` in v1; allows workspace/type-specific policies later. */
	scopeKey: string;
	mode: AgendaAutomationMode;
	applyToAgentCreated: boolean;
	maxConcurrentRuns: number;
	maxChainDepth: number;
	maxStartsPerHour: number;
	enabledBy?: AgendaTaskActor;
	enabledAt?: string;
	updatedAt: string;
}
