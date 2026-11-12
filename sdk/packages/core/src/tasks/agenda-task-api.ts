import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
	FactoryFeedbackAnalysis,
} from "@cline/shared";
import type { FactoryReplayInput } from "./factory-replay";
import type {
	FactoryStageDecision,
	FactoryStagesListing,
	FactoryStageTrustRecord,
} from "./factory-stages";

/**
 * The single mutation boundary for agenda tasks. File reconciliation, Hub
 * commands, and agent tools all route through this interface so lifecycle
 * invariants are enforced in one place.
 */
export interface AgendaTaskManagerApi {
	createTask(input: AgendaTaskCreateInput): Promise<AgendaTaskRecord>;
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
	/** The Hub-wide daily spending limit in USD the queue enforces. */
	getFactoryDailyCostUsd?(): number;
	/** Changes the daily limit; raising it above today's spend starts queued work. */
	setFactoryDailyCostUsd?(dailyCostUsd: number): number;
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
