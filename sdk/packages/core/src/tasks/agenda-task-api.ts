import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
	FactoryFeedbackAnalysis,
	FactoryPriority,
	FactoryPrioritySetter,
} from "@cline/shared";
import type { FactoryDuplicateReply } from "./factory-duplicates";
import type { FactoryGuidanceRole } from "./factory-guidance";
import type { FactoryReplayInput } from "./factory-replay";
import type {
	FactoryGuidanceSettings,
	FactoryGuidanceSettingsHistoryEntry,
	FactoryGuidanceSettingsTarget,
	FactoryGuidanceSettingsTargetInput,
	FactoryProjectSummary,
	FactoryStorageCleanResult,
	FactoryStorageSummary,
	FactoryVerificationSettings,
} from "./factory-settings";
import type {
	FactoryStageDecision,
	FactoryStagesListing,
	FactoryStageTrustRecord,
} from "./factory-stages";

/**
 * What filing a Factory card returned. `existing`: no card was created and
 * `task` is the stored one, an exact repeat or, with `duplicateOf`, `reason`
 * and `fileAnyway`, a card the duplicate check found already covers it.
 * `relatedTo`: cards linked to a created card.
 */
export type FactoryCardFiling = {
	task: AgendaTaskRecord;
	existing: boolean;
} & Partial<
	Extract<FactoryDuplicateReply, { duplicateOf: unknown }> &
		Extract<FactoryDuplicateReply, { relatedTo: unknown }>
>;

/**
 * The single mutation boundary for agenda tasks. File reconciliation, Hub
 * commands, and agent tools all route through this interface so lifecycle
 * invariants are enforced in one place.
 */
export interface AgendaTaskManagerApi {
	createTask(input: AgendaTaskCreateInput): Promise<AgendaTaskRecord>;
	/**
	 * Files a Factory card through the duplicate check: an exact repeat or a
	 * card that already covers the work is returned instead of a new one.
	 * `allowDuplicate` skips the check (never the exact repeat match) and
	 * records that it was skipped; `reserve` runs before the check unless the
	 * filing is an exact repeat, and an `existing` result created nothing.
	 */
	fileFactoryCard?(
		input: AgendaTaskCreateInput,
		options?: {
			allowDuplicate?: boolean;
			reserve?: () => Promise<void>;
		},
	): Promise<FactoryCardFiling>;
	replayFactoryTask?(input: FactoryReplayInput): Promise<AgendaTaskRecord[]>;
	listTasks(input?: AgendaTaskListInput): Promise<AgendaTaskRecord[]>;
	getTask(
		taskId: string,
		options?: { reconcile?: boolean },
	): Promise<AgendaTaskRecord | undefined>;
	/** A card by full task id or Factory short id (`F42`, `f42`, `#42`). */
	getTaskByFactoryId?(
		idOrShortId: string,
		options?: { reconcile?: boolean },
	): Promise<AgendaTaskRecord | undefined>;
	updateTask(input: AgendaTaskUpdateInput): Promise<AgendaTaskRecord>;
	approveTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
	): Promise<AgendaTaskRecord>;
	cancelTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
		reason?: string,
	): Promise<AgendaTaskRecord>;
	archiveTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
	): Promise<AgendaTaskRecord>;
	restoreTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
	): Promise<AgendaTaskRecord>;
	deleteTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
	): Promise<void>;
	runTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
		requestedByClientId?: string,
	): Promise<{ task: AgendaTaskRecord; run?: AgendaTaskRunRecord }>;
	startFactoryDesign?(
		taskId: string,
		requestedByClientId?: string,
	): Promise<{ sessionId: string }>;
	getTaskRuns?(taskId: string): AgendaTaskRunRecord[];
	setFactoryWatch?(
		taskId: string,
		enabled: boolean,
		expectedRevision: number,
	): Promise<AgendaTaskRecord>;
	/**
	 * Sets (or with null clears) a Factory card's priority in any status,
	 * without revising its plan; agents and the scoper are capped at High.
	 */
	setFactoryPriority?(
		taskId: string,
		priority: FactoryPriority | null,
		by: FactoryPrioritySetter,
		reason?: string,
	): Promise<AgendaTaskRecord>;
	startFactoryQueue?(
		entries: Array<{ taskId: string; expectedRevision: number }>,
		actor: AgendaTaskActor,
		requestedByClientId?: string,
	): Promise<void>;
	stopFactoryQueue?(workspaceRoot?: string): void;
	answerFactoryQuestion?(
		taskId: string,
		questionId: string,
		answer: string,
	): Promise<AgendaTaskRecord>;
	stampFactoryTask?(
		taskId: string,
		expectedHead: string,
	): Promise<AgendaTaskRecord>;
	/** Queues never-scoped, unheld Factory backlog for scoping. */
	adoptFactoryBacklog?(): Promise<AgendaTaskRecord[]>;
	/** How many Factory cards may be worked at once. */
	getFactoryConcurrency?(): number;
	/** Changes the limit; raising it starts queued work, lowering stops nothing. */
	setFactoryConcurrency?(concurrency: number): number;
	/** Whether new Factory work is paused. */
	getFactoryPaused?(): boolean;
	/** Pauses or resumes new Factory work; running work continues. */
	setFactoryPaused?(paused: boolean): boolean;
	/** The Hub-wide daily spending limit in USD the queue enforces; null: no daily limit. */
	getFactoryDailyCostUsd?(): number | null;
	/** Changes the daily limit (null: none); raising it above today's spend starts queued work. */
	setFactoryDailyCostUsd?(dailyCostUsd: number | null): number | null;
	/** Whether new Factory filings are checked for duplicates. */
	getFactoryDuplicateCheck?(): boolean;
	/** Turns the duplicate check on or off; off means no check at all. */
	setFactoryDuplicateCheck?(enabled: boolean): boolean;
	/** Factory session cost recorded since local midnight across all cards, in USD. */
	getFactorySpentTodayUsd?(): Promise<number>;
	/** Queue order and the cards being worked, for status reports. */
	getFactoryQueueState?(): {
		paused: boolean;
		concurrency: number;
		working: string[];
		queued: Array<{ taskId: string; stage: "design" | "run" }>;
	};
	/** Holds a card that is not being worked; never stops running work. */
	holdFactoryTask?(taskId: string): Promise<AgendaTaskRecord>;
	/** Clears an explicit hold and queues scoping. */
	queueFactoryScoping?(
		taskId: string,
		actor?: AgendaTaskActor,
	): Promise<AgendaTaskRecord>;
	recordFactoryAudit?(
		taskId: string,
		finding?: string,
		selectionReason?: "manual" | "random",
	): Promise<AgendaTaskRecord>;
	/** The checkout's repository stages with each one's trust status. */
	getFactoryStages?(workspaceRoot: string): Promise<FactoryStagesListing>;
	/**
	 * Records a person's decision on one repository stage, exactly the
	 * definition whose hash is `expectedHash`; `undecided` forgets it.
	 */
	decideFactoryStage?(
		workspaceRoot: string,
		stageId: string,
		expectedHash: string,
		decision: FactoryStageDecision | "undecided",
	): Promise<{
		listing: FactoryStagesListing;
		record?: FactoryStageTrustRecord;
	}>;
	/** Every guidance target, yours and (with a project) the repository's. */
	getFactoryGuidance?(workspaceRoot?: string): Promise<FactoryGuidanceSettings>;
	/** One page of guidance history, newest first. */
	getFactoryGuidanceHistory?(input: {
		role?: FactoryGuidanceRole;
		workspaceRoot?: string;
		limit: number;
		before?: string;
	}): Promise<{
		entries: FactoryGuidanceSettingsHistoryEntry[];
		more: boolean;
	}>;
	/** A person's direct edit of one guidance target (Factory settings). */
	setFactoryGuidance?(
		input: FactoryGuidanceSettingsTargetInput & {
			expectedHash: string;
			content: string;
			note?: string;
		},
	): Promise<{
		target: FactoryGuidanceSettingsTarget;
		entry: FactoryGuidanceSettingsHistoryEntry;
	}>;
	/** Accepts or discards a guidance file changed outside Factory. */
	resolveFactoryGuidance?(
		input: FactoryGuidanceSettingsTargetInput & {
			decision: "accept" | "discard";
			expectedHash: string;
		},
	): Promise<{ target: FactoryGuidanceSettingsTarget }>;
	/** A project's test setup with its trust status. */
	getFactoryVerification?(
		workspaceRoot: string,
	): Promise<FactoryVerificationSettings>;
	/** A person approves, saves or stops using a project's test setup. */
	setFactoryVerification?(input: {
		workspaceRoot: string;
		decision: "approve" | "remove";
		expectedHash?: string;
		profile?: unknown;
	}): Promise<FactoryVerificationSettings>;
	/** Factory's folders on this computer and their sizes. */
	getFactoryStorage?(options?: {
		refresh?: boolean;
	}): Promise<FactoryStorageSummary>;
	/**
	 * Removes the working copies of finished and archived cards only, one
	 * removal at a time; `running` when it goes on past `waitMs`.
	 */
	cleanFactoryStorage?(options?: {
		waitMs?: number;
	}): Promise<FactoryStorageCleanResult & { storage: FactoryStorageSummary }>;
	/** Forgets approvals or clears the person's own guidance (or, with dryRun, counts). */
	resetFactory?(input: {
		what: "stage_trust" | "verification_trust" | "user_guidance";
		workspaceRoot?: string;
		dryRun?: boolean;
	}): Promise<{
		what: string;
		dryRun: boolean;
		stages?: number;
		projects?: number;
		roles?: FactoryGuidanceRole[];
	}>;
	/** One line of status per known project. */
	getFactoryProjects?(workspaceRoots: readonly string[]): Promise<{
		projects: FactoryProjectSummary[];
		userGuidanceChanged: FactoryGuidanceRole[];
	}>;
	resolveFactoryFeedback?(
		taskId: string,
		decision: "save" | "discard" | "retry",
		expectedHash?: string,
	): Promise<{ task: AgendaTaskRecord; analysis: FactoryFeedbackAnalysis }>;

	getAutomationPolicy(scopeKey?: string): Promise<AgendaAutomationPolicy>;
	setAutomationPolicy(
		policy: Omit<AgendaAutomationPolicy, "updatedAt">,
		actor: AgendaTaskActor,
	): Promise<AgendaAutomationPolicy>;
}
