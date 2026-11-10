import { z } from "zod";
import type {
	FactoryDesignReview,
	FactoryRunState,
	FactoryTaskConfig,
} from "./factory";
import { factoryAgentsSchema, factoryReviewerResultSchema } from "./factory";
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

const factoryDesignProgressFields = {
	revision: z.number().int().positive(),
	repairRound: z.number().int().nonnegative(),
	agents: factoryAgentsSchema,
	designerSessionId: z.string().min(1),
	findings: z.array(z.string()),
};
export const factoryDesignProgressSchema = z.discriminatedUnion("phase", [
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
]);
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
