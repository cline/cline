/**
 * Multi-Agent Coordination
 *
 * Utilities for orchestrating multiple agents working together.
 */

import {
	type AgentConfig,
	type AgentEvent,
	type AgentResult,
	type AppendMissionLogInput,
	type AttachTeamOutcomeFragmentInput,
	type CreateTeamOutcomeInput,
	type CreateTeamTaskInput,
	type MissionLogEntry,
	type ReviewTeamOutcomeFragmentInput,
	type RouteToTeammateOptions,
	sanitizeFileName,
	type TeamMailboxMessage,
	type TeamMemberSnapshot,
	TeamMessageType,
	type TeammateLifecycleSpec,
	type TeamOutcome,
	type TeamOutcomeFragment,
	type TeamOutcomeStatus,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeSnapshot,
	type TeamRuntimeState,
	type TeamTask,
	type TeamTaskListItem,
	type TeamTaskStatus,
} from "@clinebot/shared";
import { nanoid } from "nanoid";
import { SessionRuntime } from "../../../runtime/session-runtime-orchestrator";

// Re-export shared types for backward compatibility
export {
	type AppendMissionLogInput,
	type AttachTeamOutcomeFragmentInput,
	type CreateTeamOutcomeInput,
	type CreateTeamTaskInput,
	type MissionLogEntry,
	type MissionLogKind,
	type ReviewTeamOutcomeFragmentInput,
	type RouteToTeammateOptions,
	type TeamMailboxMessage,
	type TeamMemberSnapshot,
	TeamMessageType,
	type TeammateLifecycleSpec,
	type TeamOutcome,
	type TeamOutcomeFragment,
	type TeamOutcomeFragmentStatus,
	type TeamOutcomeStatus,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeSnapshot,
	type TeamRuntimeState,
	type TeamTask,
	type TeamTaskListItem,
	type TeamTaskStatus,
} from "@clinebot/shared";

// =============================================================================
// Types that depend on @clinebot/agents (cannot live in shared)
// =============================================================================

export interface TeamMemberConfig extends AgentConfig {
	role?: string;
}

export interface AgentTask {
	agentId: string;
	message: string;
	metadata?: Record<string, unknown>;
}

export interface TaskResult {
	agentId: string;
	result: AgentResult;
	error?: Error;
	metadata?: Record<string, unknown>;
}

export type TeamEvent =
	| { type: TeamMessageType.TaskStart; agentId: string; message: string }
	| {
			type: TeamMessageType.TaskEnd;
			agentId: string;
			result?: AgentResult;
			error?: Error;
			messages?: AgentResult["messages"];
	  }
	| { type: TeamMessageType.AgentEvent; agentId: string; event: AgentEvent }
	| {
			type: TeamMessageType.TeammateSpawned;
			agentId: string;
			role?: string;
			teammate: TeammateLifecycleSpec;
	  }
	| { type: TeamMessageType.TeammateShutdown; agentId: string; reason?: string }
	| { type: TeamMessageType.TeamTaskUpdated; task: TeamTask }
	| { type: TeamMessageType.TeamMessage; message: TeamMailboxMessage }
	| { type: TeamMessageType.TeamMissionLog; entry: MissionLogEntry }
	| { type: TeamMessageType.RunQueued; run: TeamRunRecord }
	| { type: TeamMessageType.RunStarted; run: TeamRunRecord }
	| { type: TeamMessageType.RunProgress; run: TeamRunRecord; message: string }
	| { type: TeamMessageType.RunCompleted; run: TeamRunRecord }
	| { type: TeamMessageType.RunFailed; run: TeamRunRecord }
	| { type: TeamMessageType.RunCancelled; run: TeamRunRecord; reason?: string }
	| {
			type: TeamMessageType.RunInterrupted;
			run: TeamRunRecord;
			reason?: string;
	  }
	| { type: TeamMessageType.OutcomeCreated; outcome: TeamOutcome }
	| {
			type: TeamMessageType.OutcomeFragmentAttached;
			fragment: TeamOutcomeFragment;
	  }
	| {
			type: TeamMessageType.OutcomeFragmentReviewed;
			fragment: TeamOutcomeFragment;
	  }
	| { type: TeamMessageType.OutcomeFinalized; outcome: TeamOutcome };

export interface AgentTeamsRuntimeOptions {
	teamName: string;
	leadAgentId?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	maxConcurrentRuns?: number;
	onTeamEvent?: (event: TeamEvent) => void;
}

export interface SpawnTeammateOptions {
	agentId: string;
	config: TeamMemberConfig;
}

function isAbortLikeError(error: unknown): boolean {
	if (
		typeof DOMException !== "undefined" &&
		error instanceof DOMException &&
		error.name === "AbortError"
	) {
		return true;
	}
	if (!(error instanceof Error)) {
		return false;
	}
	return (
		error.name === "AbortError" ||
		error.message.toLowerCase().includes("aborted")
	);
}

function isIntentionalShutdownAbort(
	member: TeamMemberState | undefined,
	error: unknown,
): boolean {
	return member?.status === "stopped" && isAbortLikeError(error);
}

// =============================================================================
// AgentTeam
// =============================================================================

const TEAMMATE_API_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class AgentTeam {
	private agents: Map<string, SessionRuntime> = new Map();
	private configs: Map<string, TeamMemberConfig> = new Map();
	private onTeamEvent?: (event: TeamEvent) => void;

	constructor(
		configs?: Record<string, TeamMemberConfig>,
		onTeamEvent?: (event: TeamEvent) => void,
	) {
		this.onTeamEvent = onTeamEvent;

		if (configs) {
			for (const [id, config] of Object.entries(configs)) {
				this.addAgent(id, config);
			}
		}
	}

	addAgent(id: string, config: TeamMemberConfig): void {
		if (this.agents.has(id)) {
			throw new Error(`Agent with id "${id}" already exists in the team`);
		}

		const wrappedConfig: AgentConfig = {
			...config,
			onEvent: (event: AgentEvent) => {
				config.onEvent?.(event);
				this.emitEvent({
					type: TeamMessageType.AgentEvent,
					agentId: id,
					event,
				});
			},
		};

		const agent = new SessionRuntime(wrappedConfig);
		if (wrappedConfig.onEvent) {
			agent.subscribeEvents(wrappedConfig.onEvent);
		}
		this.agents.set(id, agent);
		this.configs.set(id, config);
	}

	removeAgent(id: string): boolean {
		this.configs.delete(id);
		return this.agents.delete(id);
	}

	getAgent(id: string): SessionRuntime | undefined {
		return this.agents.get(id);
	}

	getAgentIds(): string[] {
		return Array.from(this.agents.keys());
	}

	get size(): number {
		return this.agents.size;
	}

	async routeTo(agentId: string, message: string): Promise<AgentResult> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent "${agentId}" not found in team`);
		}

		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const result = await agent.run(message);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({
				type: TeamMessageType.TaskEnd,
				agentId,
				error: err,
				messages: agent.getMessages(),
			});
			throw error;
		}
	}

	async continueTo(agentId: string, message: string): Promise<AgentResult> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent "${agentId}" not found in team`);
		}

		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const result = await agent.continue(message);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({
				type: TeamMessageType.TaskEnd,
				agentId,
				error: err,
				messages: agent.getMessages(),
			});
			throw error;
		}
	}

	async runParallel(tasks: AgentTask[]): Promise<TaskResult[]> {
		const executions = tasks.map(async (task): Promise<TaskResult> => {
			const agent = this.agents.get(task.agentId);
			if (!agent) {
				return {
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${task.agentId}" not found in team`),
					metadata: task.metadata,
				};
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId: task.agentId,
				message: task.message,
			});

			try {
				const result = await agent.run(task.message);
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					result,
				});
				return {
					agentId: task.agentId,
					result,
					metadata: task.metadata,
				};
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					error: err,
					messages: agent.getMessages(),
				});
				return {
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: err,
					metadata: task.metadata,
				};
			}
		});

		return Promise.all(executions);
	}

	async runSequential(tasks: AgentTask[]): Promise<TaskResult[]> {
		const results: TaskResult[] = [];

		for (const task of tasks) {
			const agent = this.agents.get(task.agentId);
			if (!agent) {
				results.push({
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${task.agentId}" not found in team`),
					metadata: task.metadata,
				});
				continue;
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId: task.agentId,
				message: task.message,
			});

			try {
				const result = await agent.run(task.message);
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					result,
				});
				results.push({
					agentId: task.agentId,
					result,
					metadata: task.metadata,
				});
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					error: err,
					messages: agent.getMessages(),
				});
				results.push({
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: err,
					metadata: task.metadata,
				});
			}
		}

		return results;
	}

	async runPipeline(
		pipeline: string[],
		initialMessage: string,
		messageTransformer?: (
			prevResult: AgentResult,
			nextAgentId: string,
		) => string,
	): Promise<TaskResult[]> {
		const results: TaskResult[] = [];
		let currentMessage = initialMessage;

		for (const agentId of pipeline) {
			const agent = this.agents.get(agentId);
			if (!agent) {
				results.push({
					agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${agentId}" not found in team`),
				});
				break;
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId,
				message: currentMessage,
			});

			try {
				const result = await agent.run(currentMessage);
				this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
				results.push({ agentId, result });

				const nextIndex = pipeline.indexOf(agentId) + 1;
				if (nextIndex < pipeline.length) {
					const nextAgentId = pipeline[nextIndex];
					currentMessage = messageTransformer
						? messageTransformer(result, nextAgentId)
						: `Previous agent output:\n${result.text}\n\nPlease continue from here.`;
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId,
					error: err,
					messages: agent.getMessages(),
				});
				results.push({
					agentId,
					result: undefined as unknown as AgentResult,
					error: err,
				});
				break;
			}
		}

		return results;
	}

	abortAll(): void {
		for (const agent of this.agents.values()) {
			agent.abort(new Error("Agent team abortAll requested"));
		}
	}

	clear(): void {
		this.abortAll();
		this.agents.clear();
		this.configs.clear();
	}

	private emitEvent(event: TeamEvent): void {
		try {
			this.onTeamEvent?.(event);
		} catch {
			// Ignore callback errors
		}
	}
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createAgentTeam(
	configs: Record<string, TeamMemberConfig>,
	onTeamEvent?: (event: TeamEvent) => void,
): AgentTeam {
	return new AgentTeam(configs, onTeamEvent);
}

export function createWorkerReviewerTeam(configs: {
	worker: TeamMemberConfig;
	reviewer: TeamMemberConfig;
}): AgentTeam & {
	doAndReview: (
		message: string,
	) => Promise<{ workerResult: AgentResult; reviewResult: AgentResult }>;
} {
	const team = createAgentTeam({
		worker: configs.worker,
		reviewer: configs.reviewer,
	});

	const enhanced = team as AgentTeam & {
		doAndReview: (
			message: string,
		) => Promise<{ workerResult: AgentResult; reviewResult: AgentResult }>;
	};

	enhanced.doAndReview = async (message: string) => {
		const workerResult = await team.routeTo("worker", message);
		const reviewResult = await team.routeTo(
			"reviewer",
			`Please review this work:\n\n${workerResult.text}`,
		);
		return { workerResult, reviewResult };
	};

	return enhanced;
}

// =============================================================================
// Agent Teams Runtime (lead + teammate collaboration)
// =============================================================================

interface TeamMemberState extends TeamMemberSnapshot {
	agent?: SessionRuntime;
	runningCount: number;
	lastMissionStep: number;
	lastMissionAt: number;
	pendingSteerMessage?: string;
}

export class AgentTeamsRuntime {
	private readonly teamId: string;
	private readonly teamName: string;
	private readonly onTeamEvent?: (event: TeamEvent) => void;
	private readonly members: Map<string, TeamMemberState> = new Map();
	private readonly tasks: Map<string, TeamTask> = new Map();
	private readonly missionLog: MissionLogEntry[] = [];
	private readonly mailbox: TeamMailboxMessage[] = [];
	private missionStepCounter = 0;
	private taskCounter = 0;
	private messageCounter = 0;
	private missionCounter = 0;
	private runCounter = 0;
	private outcomeCounter = 0;
	private outcomeFragmentCounter = 0;
	private readonly runs: Map<string, TeamRunRecord & { result?: AgentResult }> =
		new Map();
	private readonly runQueue: string[] = [];
	private readonly outcomes: Map<string, TeamOutcome> = new Map();
	private readonly outcomeFragments: Map<string, TeamOutcomeFragment> =
		new Map();
	private readonly missionLogIntervalSteps: number;
	private readonly missionLogIntervalMs: number;
	private readonly maxConcurrentRuns: number;

	constructor(options: AgentTeamsRuntimeOptions) {
		this.teamName = options.teamName;
		this.teamId = `t_${sanitizeFileName(nanoid(10))}`;
		this.onTeamEvent = options.onTeamEvent;
		this.missionLogIntervalSteps = Math.max(
			1,
			options.missionLogIntervalSteps ?? 3,
		);
		this.missionLogIntervalMs = Math.max(
			1000,
			options.missionLogIntervalMs ?? 120000,
		);
		this.maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 2);
		const leadAgentId = options.leadAgentId ?? "lead";
		this.members.set(leadAgentId, {
			agentId: leadAgentId,
			role: "lead",
			status: "idle",
			runningCount: 0,
			lastMissionStep: 0,
			lastMissionAt: Date.now(),
		});
	}

	getTeamId(): string {
		return this.teamId;
	}

	getTeamName(): string {
		return this.teamName;
	}

	getMemberRole(agentId: string): "lead" | "teammate" | undefined {
		return this.members.get(agentId)?.role;
	}

	getMemberIds(): string[] {
		return Array.from(this.members.keys());
	}

	getTeammateIds(): string[] {
		return Array.from(this.members.values())
			.filter((member) => member.role === "teammate")
			.map((member) => member.agentId);
	}

	getTask(taskId: string): TeamTask | undefined {
		return this.tasks.get(taskId);
	}

	listTasks(): TeamTask[] {
		return Array.from(this.tasks.values());
	}

	listTaskItems(options?: {
		status?: TeamTaskStatus;
		assignee?: string;
	}): TeamTaskListItem[] {
		return Array.from(this.tasks.values())
			.map((task) => {
				const blockedBy = this.getUnresolvedDependencies(task);
				return {
					...task,
					blockedBy,
					isReady:
						task.status === "pending" &&
						!task.assignee &&
						blockedBy.length === 0,
				};
			})
			.filter((task) => {
				if (options?.status && task.status !== options.status) {
					return false;
				}
				if (options?.assignee && task.assignee !== options.assignee) {
					return false;
				}
				return true;
			});
	}

	listMissionLog(limit?: number): MissionLogEntry[] {
		if (!limit || limit <= 0) {
			return [...this.missionLog];
		}
		return this.missionLog.slice(Math.max(0, this.missionLog.length - limit));
	}

	listMailbox(
		agentId: string,
		options?: { unreadOnly?: boolean; markRead?: boolean; limit?: number },
	): TeamMailboxMessage[] {
		const unreadOnly = options?.unreadOnly ?? true;
		const markRead = options?.markRead ?? true;
		const limit = options?.limit;
		const messages = this.mailbox.filter(
			(message) =>
				message.toAgentId === agentId && (!unreadOnly || !message.readAt),
		);
		const selected =
			typeof limit === "number" && limit > 0
				? messages.slice(Math.max(0, messages.length - limit))
				: messages;
		if (markRead) {
			const now = new Date();
			for (const message of selected) {
				if (!message.readAt) {
					message.readAt = now;
				}
			}
		}
		return selected.map((message) => ({ ...message }));
	}

	getSnapshot(): TeamRuntimeSnapshot {
		const taskCounts: Record<TeamTaskStatus, number> = {
			pending: 0,
			in_progress: 0,
			blocked: 0,
			completed: 0,
		};
		for (const task of this.tasks.values()) {
			taskCounts[task.status]++;
		}
		const outcomeCounts: Record<TeamOutcomeStatus, number> = {
			draft: 0,
			in_review: 0,
			finalized: 0,
		};
		for (const outcome of this.outcomes.values()) {
			outcomeCounts[outcome.status]++;
		}
		return {
			teamId: this.teamId,
			teamName: this.teamName,
			members: Array.from(this.members.values()).map((member) => ({
				agentId: member.agentId,
				role: member.role,
				description: member.description,
				status: member.status,
			})),
			taskCounts,
			unreadMessages: this.mailbox.filter((message) => !message.readAt).length,
			missionLogEntries: this.missionLog.length,
			activeRuns: Array.from(this.runs.values()).filter(
				(run) => run.status === "running",
			).length,
			queuedRuns: Array.from(this.runs.values()).filter(
				(run) => run.status === "queued",
			).length,
			outcomeCounts,
		};
	}

	exportState(): TeamRuntimeState {
		return {
			teamId: this.teamId,
			teamName: this.teamName,
			members: Array.from(this.members.values()).map((member) => ({
				agentId: member.agentId,
				role: member.role,
				description: member.description,
				status: member.status,
			})),
			tasks: Array.from(this.tasks.values()).map((task) => ({ ...task })),
			mailbox: this.mailbox.map((message) => ({ ...message })),
			missionLog: this.missionLog.map((entry) => ({ ...entry })),
			runs: Array.from(this.runs.values()).map((run) => ({ ...run })),
			outcomes: Array.from(this.outcomes.values()).map((outcome) => ({
				...outcome,
			})),
			outcomeFragments: Array.from(this.outcomeFragments.values()).map(
				(fragment) => ({ ...fragment }),
			),
		};
	}

	hydrateState(state: TeamRuntimeState): void {
		this.tasks.clear();
		for (const task of state.tasks) {
			this.tasks.set(task.id, { ...task });
		}

		this.mailbox.length = 0;
		this.mailbox.push(...state.mailbox.map((message) => ({ ...message })));

		this.missionLog.length = 0;
		this.missionLog.push(...state.missionLog.map((entry) => ({ ...entry })));

		this.runs.clear();
		for (const run of state.runs ?? []) {
			this.runs.set(run.id, { ...run } as TeamRunRecord & {
				result?: AgentResult;
			});
		}
		this.runQueue.length = 0;
		this.runQueue.push(
			...Array.from(this.runs.values())
				.filter((run) => run.status === "queued")
				.map((run) => run.id),
		);

		this.outcomes.clear();
		for (const outcome of state.outcomes ?? []) {
			this.outcomes.set(outcome.id, { ...outcome });
		}

		this.outcomeFragments.clear();
		for (const fragment of state.outcomeFragments ?? []) {
			this.outcomeFragments.set(fragment.id, { ...fragment });
		}

		const leadMembers = Array.from(this.members.values()).filter(
			(member) => member.role === "lead",
		);
		this.members.clear();
		for (const lead of leadMembers) {
			this.members.set(lead.agentId, {
				...lead,
				status: "idle",
				runningCount: 0,
				lastMissionStep: this.missionStepCounter,
				lastMissionAt: Date.now(),
			});
		}
		for (const member of state.members) {
			if (member.role !== "teammate") {
				continue;
			}
			this.members.set(member.agentId, {
				agentId: member.agentId,
				role: "teammate",
				description: member.description,
				status: "stopped",
				agent: undefined,
				runningCount: 0,
				lastMissionStep: this.missionStepCounter,
				lastMissionAt: Date.now(),
			});
		}

		this.taskCounter = Math.max(
			this.taskCounter,
			maxCounter(
				state.tasks.map((task) => task.id),
				"task_",
			),
		);
		this.messageCounter = Math.max(
			this.messageCounter,
			maxCounter(
				state.mailbox.map((message) => message.id),
				"msg_",
			),
		);
		this.missionCounter = Math.max(
			this.missionCounter,
			maxCounter(
				state.missionLog.map((entry) => entry.id),
				"log_",
			),
		);
		this.runCounter = Math.max(
			this.runCounter,
			maxCounter(
				(state.runs ?? []).map((run) => run.id),
				"run_",
			),
		);
		this.outcomeCounter = Math.max(
			this.outcomeCounter,
			maxCounter(
				(state.outcomes ?? []).map((outcome) => outcome.id),
				"out_",
			),
		);
		this.outcomeFragmentCounter = Math.max(
			this.outcomeFragmentCounter,
			maxCounter(
				(state.outcomeFragments ?? []).map((fragment) => fragment.id),
				"frag_",
			),
		);
	}

	isTeammateActive(agentId: string): boolean {
		const member = this.members.get(agentId);
		return !!member && member.role === "teammate" && !!member.agent;
	}

	spawnTeammate({ agentId, config }: SpawnTeammateOptions): TeamMemberSnapshot {
		const existing = this.members.get(agentId);
		if (existing && existing.role !== "teammate") {
			throw new Error(
				`Team member "${agentId}" already exists and is not a teammate`,
			);
		}
		if (existing && existing.runningCount > 0) {
			throw new Error(
				`Teammate "${agentId}" is currently running and cannot be respawned`,
			);
		}

		const wrappedConfig: TeamMemberConfig = {
			...config,
			apiTimeoutMs: TEAMMATE_API_TIMEOUT_MS,
			consumePendingUserMessage: () => {
				const member = this.members.get(agentId);
				if (!member || !member.pendingSteerMessage) {
					return undefined;
				}
				const message = member.pendingSteerMessage;
				member.pendingSteerMessage = undefined;
				return message;
			},
			onEvent: (event: AgentEvent) => {
				config.onEvent?.(event);
				this.emitEvent({ type: TeamMessageType.AgentEvent, agentId, event });
				this.trackMeaningfulEvent(agentId, event);
			},
		};

		const agent = new SessionRuntime(wrappedConfig);
		if (wrappedConfig.onEvent) {
			agent.subscribeEvents(wrappedConfig.onEvent);
		}
		const teammate: TeamMemberState = {
			agentId,
			role: "teammate",
			description: config.role,
			status: "idle",
			agent,
			runningCount: 0,
			lastMissionStep: 0,
			lastMissionAt: Date.now(),
		};
		this.members.set(agentId, teammate);
		this.emitEvent({
			type: TeamMessageType.TeammateSpawned,
			agentId,
			role: config.role,
			teammate: {
				rolePrompt: config.systemPrompt,
				modelId: config.modelId,
				maxIterations: config.maxIterations,
				runtimeAgentId: agent.getAgentId(),
				conversationId: agent.getConversationId(),
				parentAgentId: null,
			},
		});
		return {
			agentId: teammate.agentId,
			role: teammate.role,
			description: teammate.description,
			status: teammate.status,
		};
	}

	shutdownTeammate(agentId: string, reason?: string): void {
		const member = this.members.get(agentId);
		if (!member || member.role !== "teammate") {
			throw new Error(`Teammate "${agentId}" was not found`);
		}
		try {
			member.agent?.abort();
		} catch (error) {
			if (!isAbortLikeError(error)) {
				throw error;
			}
		}
		member.status = "stopped";
		this.emitEvent({ type: TeamMessageType.TeammateShutdown, agentId, reason });
	}

	updateTeammateConnections(
		overrides: Partial<Pick<AgentConfig, "apiKey" | "baseUrl" | "headers">>,
	): void {
		for (const member of this.members.values()) {
			if (member.role !== "teammate" || !member.agent) {
				continue;
			}
			member.agent.updateConnection(overrides);
		}
	}

	createTask(input: CreateTeamTaskInput): TeamTask {
		const taskId = `task_${String(++this.taskCounter).padStart(4, "0")}`;
		const now = new Date();
		const task: TeamTask = {
			id: taskId,
			title: input.title,
			description: input.description,
			status: input.assignee ? "in_progress" : "pending",
			createdAt: now,
			updatedAt: now,
			createdBy: input.createdBy,
			assignee: input.assignee,
			dependsOn: input.dependsOn ?? [],
		};
		this.tasks.set(taskId, task);
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		return { ...task };
	}

	claimTask(taskId: string, agentId: string): TeamTask {
		const task = this.requireTask(taskId);
		this.assertDependenciesResolved(task);
		task.status = "in_progress";
		task.assignee = agentId;
		task.updatedAt = new Date();
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "progress",
			summary: `Claimed task "${task.title}"`,
		});
		return { ...task };
	}

	blockTask(taskId: string, agentId: string, reason: string): TeamTask {
		const task = this.requireTask(taskId);
		task.status = "blocked";
		task.updatedAt = new Date();
		task.summary = reason;
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "blocked",
			summary: reason,
		});
		return { ...task };
	}

	completeTask(taskId: string, agentId: string, summary: string): TeamTask {
		const task = this.requireTask(taskId);
		task.status = "completed";
		task.updatedAt = new Date();
		task.summary = summary;
		if (!task.assignee) {
			task.assignee = agentId;
		}
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "done",
			summary,
		});
		return { ...task };
	}

	async routeToTeammate(
		agentId: string,
		message: string,
		options?: RouteToTeammateOptions,
	): Promise<AgentResult> {
		const member = this.members.get(agentId);
		if (!member || member.role !== "teammate" || !member.agent) {
			throw new Error(`Teammate "${agentId}" was not found`);
		}
		if (!member.agent.canStartRun()) {
			throw new Error(
				`Cannot start a new run while another run is already in progress`,
			);
		}

		member.runningCount++;
		member.status = "running";
		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const unreadMail = this.listMailbox(agentId, {
				unreadOnly: true,
				markRead: true,
			});
			const enrichedMessage =
				unreadMail.length > 0
					? `${this.buildMailboxNotification(unreadMail)}\n\n${message}`
					: message;
			const result = options?.continueConversation
				? await member.agent.continue(enrichedMessage)
				: await member.agent.run(enrichedMessage);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			this.recordProgressStep(
				agentId,
				`Completed a delegated run (${result.iterations} iterations)`,
				options?.taskId,
				true,
			);
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({
				type: TeamMessageType.TaskEnd,
				agentId,
				error: err,
				messages: member.agent.getMessages(),
			});
			if (!isIntentionalShutdownAbort(member, err)) {
				this.appendMissionLog({
					agentId,
					taskId: options?.taskId,
					kind: "error",
					summary: err.message,
				});
			}
			throw err;
		} finally {
			member.runningCount--;
			if (
				member.runningCount <= 0 &&
				this.members.get(agentId)?.status !== "stopped"
			) {
				member.status = "idle";
			}
		}
	}

	startTeammateRun(
		agentId: string,
		message: string,
		options?: RouteToTeammateOptions & {
			priority?: number;
			maxRetries?: number;
			leaseOwner?: string;
		},
	): TeamRunRecord {
		const runId = `run_${String(++this.runCounter).padStart(5, "0")}`;
		const record: TeamRunRecord & { result?: AgentResult } = {
			id: runId,
			agentId,
			taskId: options?.taskId,
			status: "queued",
			message,
			priority: options?.priority ?? 0,
			retryCount: 0,
			maxRetries: Math.max(0, options?.maxRetries ?? 0),
			continueConversation: options?.continueConversation,
			startedAt: new Date(0),
			leaseOwner: options?.leaseOwner,
			heartbeatAt: undefined,
			lastProgressAt: new Date(),
			lastProgressMessage: "queued",
			currentActivity: "queued",
		};
		this.runs.set(runId, record);
		this.runQueue.push(runId);
		this.emitEvent({ type: TeamMessageType.RunQueued, run: { ...record } });
		this.dispatchQueuedRuns();
		return { ...record };
	}

	private dispatchQueuedRuns(): void {
		while (
			this.countActiveRuns() < this.maxConcurrentRuns &&
			this.runQueue.length > 0
		) {
			const nextRunIndex = this.selectNextQueuedRunIndex();
			const [runId] = this.runQueue.splice(nextRunIndex, 1);
			const run = runId ? this.runs.get(runId) : undefined;
			if (!run || run.status !== "queued") {
				continue;
			}
			void this.executeQueuedRun(run);
		}
	}

	private selectNextQueuedRunIndex(): number {
		let selectedIndex = 0;
		let bestPriority = Number.NEGATIVE_INFINITY;
		for (let index = 0; index < this.runQueue.length; index++) {
			const run = this.runs.get(this.runQueue[index]);
			if (!run || run.status !== "queued") {
				continue;
			}
			if (run.priority > bestPriority) {
				bestPriority = run.priority;
				selectedIndex = index;
			}
		}
		return selectedIndex;
	}

	private countActiveRuns(): number {
		let count = 0;
		for (const run of this.runs.values()) {
			if (run.status === "running") {
				count++;
			}
		}
		return count;
	}

	private async executeQueuedRun(
		run: TeamRunRecord & { result?: AgentResult },
	): Promise<void> {
		run.status = "running";
		run.startedAt = new Date();
		run.heartbeatAt = new Date();
		run.currentActivity = "run_started";
		this.emitEvent({ type: TeamMessageType.RunStarted, run: { ...run } });

		const heartbeatTimer = setInterval(() => {
			if (run.status !== "running") {
				return;
			}
			this.recordRunProgress(run, "heartbeat");
		}, 2000);

		try {
			const result = await this.routeToTeammate(run.agentId, run.message, {
				taskId: run.taskId,
				continueConversation: run.continueConversation,
			});
			run.status = "completed";
			run.result = result;
			run.endedAt = new Date();
			run.currentActivity = "completed";
			this.emitEvent({ type: TeamMessageType.RunCompleted, run: { ...run } });
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: String(error ?? "Unknown error");
			run.error = message;
			run.endedAt = new Date();
			const member = this.members.get(run.agentId);
			if (isIntentionalShutdownAbort(member, error)) {
				run.status = "cancelled";
				run.currentActivity = "cancelled";
				this.emitEvent({
					type: TeamMessageType.RunCancelled,
					run: { ...run },
					reason: message,
				});
			} else if (run.retryCount < run.maxRetries) {
				run.retryCount++;
				run.status = "queued";
				run.nextAttemptAt = new Date(
					Date.now() + Math.min(30000, 1000 * 2 ** run.retryCount),
				);
				this.runQueue.push(run.id);
				this.recordRunProgress(run, `retry_scheduled_${run.retryCount}`);
			} else {
				run.status = "failed";
				run.currentActivity = "failed";
				this.emitEvent({ type: TeamMessageType.RunFailed, run: { ...run } });
			}
		} finally {
			clearInterval(heartbeatTimer);
			this.dispatchQueuedRuns();
		}
	}

	listRuns(options?: {
		status?: TeamRunStatus | null;
		agentId?: string | null;
		includeCompleted?: boolean | null;
	}): TeamRunRecord[] {
		const includeCompleted = options?.includeCompleted ?? true;
		return Array.from(this.runs.values())
			.filter((run) => {
				if (!includeCompleted && !["running", "queued"].includes(run.status)) {
					return false;
				}
				if (options?.status && run.status !== options.status) {
					return false;
				}
				if (options?.agentId && run.agentId !== options.agentId) {
					return false;
				}
				return true;
			})
			.map((run) => ({ ...run }));
	}

	getRun(runId: string): TeamRunRecord | undefined {
		const run = this.runs.get(runId);
		return run ? { ...run } : undefined;
	}

	async awaitRun(runId: string, pollIntervalMs = 250): Promise<TeamRunRecord> {
		const run = this.runs.get(runId);
		if (!run) {
			throw new Error(`Run "${runId}" was not found`);
		}
		while (run.status === "running") {
			await sleep(pollIntervalMs);
		}
		return { ...run };
	}

	async awaitAllRuns(pollIntervalMs = 250): Promise<TeamRunRecord[]> {
		while (
			Array.from(this.runs.values()).some((run) =>
				["queued", "running"].includes(run.status),
			)
		) {
			await sleep(pollIntervalMs);
		}
		return this.listRuns();
	}

	cancelRun(runId: string, reason?: string): TeamRunRecord {
		const run = this.runs.get(runId);
		if (!run) {
			throw new Error(`Run "${runId}" was not found`);
		}
		if (run.status === "completed" || run.status === "failed") {
			return { ...run };
		}
		run.status = "cancelled";
		run.error = reason;
		run.endedAt = new Date();
		run.currentActivity = "cancelled";
		const queueIndex = this.runQueue.indexOf(runId);
		if (queueIndex >= 0) {
			this.runQueue.splice(queueIndex, 1);
		}
		this.emitEvent({
			type: TeamMessageType.RunCancelled,
			run: { ...run },
			reason,
		});
		return { ...run };
	}

	markStaleRunsInterrupted(reason = "runtime_recovered"): TeamRunRecord[] {
		const interrupted: TeamRunRecord[] = [];
		for (const run of this.runs.values()) {
			if (!["queued", "running"].includes(run.status)) {
				continue;
			}
			run.status = "interrupted";
			run.error = reason;
			run.endedAt = new Date();
			run.currentActivity = "interrupted";
			interrupted.push({ ...run });
			this.emitEvent({
				type: TeamMessageType.RunInterrupted,
				run: { ...run },
				reason,
			});
		}
		this.runQueue.length = 0;
		return interrupted;
	}

	sendMessage(
		fromAgentId: string,
		toAgentId: string,
		subject: string,
		body: string,
		taskId?: string,
	): TeamMailboxMessage {
		if (!this.members.has(fromAgentId)) {
			throw new Error(`Unknown sender "${fromAgentId}"`);
		}
		const recipient = this.members.get(toAgentId);
		if (!recipient) {
			throw new Error(`Unknown recipient "${toAgentId}"`);
		}
		const message: TeamMailboxMessage = {
			id: `msg_${String(++this.messageCounter).padStart(5, "0")}`,
			teamId: this.teamId,
			fromAgentId,
			toAgentId,
			subject,
			body,
			taskId,
			sentAt: new Date(),
		};
		this.mailbox.push(message);
		this.emitEvent({
			type: TeamMessageType.TeamMessage,
			message: { ...message },
		});
		if (
			recipient.role === "teammate" &&
			recipient.runningCount > 0 &&
			recipient.agent
		) {
			recipient.pendingSteerMessage = `[MAILBOX] You got a message from ${fromAgentId}. Subject: "${subject}". Use the team_read_mailbox tool to read it at your convenience.`;
		}
		return { ...message };
	}

	broadcast(
		fromAgentId: string,
		subject: string,
		body: string,
		options?: { taskId?: string },
	): TeamMailboxMessage[] {
		const messages: TeamMailboxMessage[] = [];
		for (const member of this.members.values()) {
			if (member.agentId === fromAgentId) {
				continue;
			}
			if (member.role === "lead") {
				continue;
			}
			messages.push(
				this.sendMessage(
					fromAgentId,
					member.agentId,
					subject,
					body,
					options?.taskId,
				),
			);
		}
		return messages;
	}

	appendMissionLog(input: AppendMissionLogInput): MissionLogEntry {
		if (!this.members.has(input.agentId)) {
			throw new Error(`Unknown team member "${input.agentId}"`);
		}
		const entry: MissionLogEntry = {
			id: `log_${String(++this.missionCounter).padStart(6, "0")}`,
			ts: new Date(),
			teamId: this.teamId,
			agentId: input.agentId,
			taskId: input.taskId,
			kind: input.kind,
			summary: input.summary,
			evidence: input.evidence,
			nextAction: input.nextAction,
		};
		this.missionLog.push(entry);
		const member = this.members.get(input.agentId);
		if (member) {
			member.lastMissionAt = Date.now();
			member.lastMissionStep = this.missionStepCounter;
		}
		this.emitEvent({
			type: TeamMessageType.TeamMissionLog,
			entry: { ...entry },
		});
		return { ...entry };
	}

	createOutcome(input: CreateTeamOutcomeInput): TeamOutcome {
		const outcome: TeamOutcome = {
			id: `out_${String(++this.outcomeCounter).padStart(4, "0")}`,
			teamId: this.teamId,
			title: input.title,
			status: "draft",
			requiredSections: [...new Set(input.requiredSections)],
			createdBy: input.createdBy,
			createdAt: new Date(),
		};
		this.outcomes.set(outcome.id, outcome);
		this.emitEvent({
			type: TeamMessageType.OutcomeCreated,
			outcome: { ...outcome },
		});
		return { ...outcome };
	}

	listOutcomes(): TeamOutcome[] {
		return Array.from(this.outcomes.values()).map((outcome) => ({
			...outcome,
		}));
	}

	attachOutcomeFragment(
		input: AttachTeamOutcomeFragmentInput,
	): TeamOutcomeFragment {
		const outcome = this.outcomes.get(input.outcomeId);
		if (!outcome) {
			throw new Error(`Outcome "${input.outcomeId}" was not found`);
		}
		if (!outcome.requiredSections.includes(input.section)) {
			throw new Error(
				`Section "${input.section}" is not part of outcome "${input.outcomeId}"`,
			);
		}
		const fragment: TeamOutcomeFragment = {
			id: `frag_${String(++this.outcomeFragmentCounter).padStart(5, "0")}`,
			teamId: this.teamId,
			outcomeId: input.outcomeId,
			section: input.section,
			sourceAgentId: input.sourceAgentId,
			sourceRunId: input.sourceRunId,
			content: input.content,
			status: "draft",
			createdAt: new Date(),
		};
		this.outcomeFragments.set(fragment.id, fragment);
		if (outcome.status === "draft") {
			outcome.status = "in_review";
		}
		this.emitEvent({
			type: TeamMessageType.OutcomeFragmentAttached,
			fragment: { ...fragment },
		});
		return { ...fragment };
	}

	reviewOutcomeFragment(
		input: ReviewTeamOutcomeFragmentInput,
	): TeamOutcomeFragment {
		const fragment = this.outcomeFragments.get(input.fragmentId);
		if (!fragment) {
			throw new Error(`Fragment "${input.fragmentId}" was not found`);
		}
		fragment.status = input.approved ? "reviewed" : "rejected";
		fragment.reviewedBy = input.reviewedBy;
		fragment.reviewedAt = new Date();
		this.emitEvent({
			type: TeamMessageType.OutcomeFragmentReviewed,
			fragment: { ...fragment },
		});
		return { ...fragment };
	}

	listOutcomeFragments(outcomeId: string): TeamOutcomeFragment[] {
		return Array.from(this.outcomeFragments.values())
			.filter((fragment) => fragment.outcomeId === outcomeId)
			.map((fragment) => ({ ...fragment }));
	}

	finalizeOutcome(outcomeId: string): TeamOutcome {
		const outcome = this.outcomes.get(outcomeId);
		if (!outcome) {
			throw new Error(`Outcome "${outcomeId}" was not found`);
		}
		const fragments = this.listOutcomeFragments(outcomeId);
		for (const section of outcome.requiredSections) {
			const approvedForSection = fragments.some(
				(fragment) =>
					fragment.section === section && fragment.status === "reviewed",
			);
			if (!approvedForSection) {
				throw new Error(
					`Outcome "${outcomeId}" cannot be finalized. Section "${section}" is missing a reviewed fragment.`,
				);
			}
		}
		outcome.status = "finalized";
		outcome.finalizedAt = new Date();
		this.emitEvent({
			type: TeamMessageType.OutcomeFinalized,
			outcome: { ...outcome },
		});
		return { ...outcome };
	}

	cleanup(): void {
		for (const member of this.members.values()) {
			if (member.role === "teammate" && member.runningCount > 0) {
				throw new Error(
					`Cannot cleanup team while teammate "${member.agentId}" is still running`,
				);
			}
		}
		if (
			Array.from(this.runs.values()).some((run) =>
				["queued", "running"].includes(run.status),
			)
		) {
			throw new Error(
				"Cannot cleanup team while async teammate runs are still active",
			);
		}

		for (const member of this.members.values()) {
			if (member.role === "teammate") {
				try {
					member.agent?.abort();
				} catch (error) {
					if (!isAbortLikeError(error)) {
						throw error;
					}
				}
			}
		}

		this.tasks.clear();
		this.mailbox.length = 0;
		this.missionLog.length = 0;
		this.runs.clear();
		this.runQueue.length = 0;
		this.outcomes.clear();
		this.outcomeFragments.clear();

		for (const [memberId, member] of this.members.entries()) {
			if (member.role === "teammate") {
				this.members.delete(memberId);
			}
		}
	}

	private requireTask(taskId: string): TeamTask {
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task "${taskId}" was not found`);
		}
		return task;
	}

	private assertDependenciesResolved(task: TeamTask): void {
		const blockedBy = this.getUnresolvedDependencies(task);
		if (blockedBy.length > 0) {
			throw new Error(`Task "${task.id}" is blocked by "${blockedBy[0]}"`);
		}
	}

	private getUnresolvedDependencies(task: TeamTask): string[] {
		return task.dependsOn.filter((dependencyId) => {
			const dependency = this.tasks.get(dependencyId);
			return !dependency || dependency.status !== "completed";
		});
	}

	private trackMeaningfulEvent(agentId: string, event: AgentEvent): void {
		this.recordRunActivityFromAgentEvent(agentId, event);

		if (event.type === "iteration_end" && event.hadToolCalls) {
			this.recordProgressStep(
				agentId,
				`Completed iteration ${event.iteration} with ${event.toolCallCount} tool call(s)`,
			);
			return;
		}

		if (
			event.type === "content_end" &&
			event.contentType === "tool" &&
			!event.error
		) {
			this.recordProgressStep(
				agentId,
				`Finished tool "${event.toolName ?? "unknown"}"`,
			);
			return;
		}

		if (event.type === "done") {
			this.appendMissionLog({
				agentId,
				kind: "done",
				summary: `Completed a delegated run (${event.iterations} iterations)`,
			});
			return;
		}

		if (event.type === "error") {
			this.appendMissionLog({
				agentId,
				kind: "error",
				summary: event.error.message,
			});
		}
	}

	private recordRunActivityFromAgentEvent(
		agentId: string,
		event: AgentEvent,
	): void {
		let activity: string | undefined;
		switch (event.type) {
			case "iteration_start":
				activity = `iteration_${event.iteration}_started`;
				break;
			case "content_start":
				if (event.contentType === "tool") {
					activity = `running_tool_${event.toolName ?? "unknown"}`;
				}
				break;
			case "content_end":
				if (event.contentType === "tool") {
					activity = event.error
						? this.formatProgressErrorActivity(
								`tool_${event.toolName ?? "unknown"}_error`,
								event.error,
							)
						: `finished_tool_${event.toolName ?? "unknown"}`;
				}
				break;
			case "done":
				activity = "finalizing_response";
				break;
			case "error":
				activity = this.formatProgressErrorActivity(
					"run_error",
					event.error.message,
				);
				break;
			default:
				break;
		}
		if (!activity) {
			return;
		}
		for (const run of this.runs.values()) {
			if (run.agentId !== agentId || run.status !== "running") {
				continue;
			}
			this.recordRunProgress(run, activity);
		}
	}

	private recordRunProgress(run: TeamRunRecord, message: string): void {
		const now = new Date();
		run.heartbeatAt = now;
		run.lastProgressAt = now;
		run.lastProgressMessage = message;
		run.currentActivity = message;
		this.emitEvent({
			type: TeamMessageType.RunProgress,
			run: { ...run },
			message,
		});
	}

	private formatProgressErrorActivity(prefix: string, detail: string): string {
		const summary = detail.replace(/\s+/g, " ").trim();
		if (summary.length === 0) {
			return prefix;
		}
		const suffix =
			summary.length > 240 ? `${summary.slice(0, 237).trimEnd()}...` : summary;
		return `${prefix}: ${suffix}`;
	}

	private recordProgressStep(
		agentId: string,
		summary: string,
		taskId?: string,
		force = false,
	): void {
		this.missionStepCounter++;
		const member = this.members.get(agentId);
		if (!member) {
			return;
		}
		const stepsSinceLast = this.missionStepCounter - member.lastMissionStep;
		const elapsedMs = Date.now() - member.lastMissionAt;
		if (
			!force &&
			stepsSinceLast < this.missionLogIntervalSteps &&
			elapsedMs < this.missionLogIntervalMs
		) {
			return;
		}
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "progress",
			summary,
		});
	}

	private buildMailboxNotification(messages: TeamMailboxMessage[]): string {
		if (messages.length === 0) {
			return "";
		}
		const lines: string[] = [
			`[MAILBOX] You have ${messages.length} unread message(s):`,
		];
		for (const msg of messages) {
			lines.push(
				`--- Message from ${msg.fromAgentId} | subject: ${msg.subject} ---`,
			);
			lines.push(msg.body);
		}
		lines.push("---");
		return lines.join("\n");
	}

	private emitEvent(event: TeamEvent): void {
		try {
			this.onTeamEvent?.(event);
		} catch {
			// Ignore callback errors to avoid disrupting execution.
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function maxCounter(ids: string[], prefix: string): number {
	let max = 0;
	for (const id of ids) {
		if (!id.startsWith(prefix)) {
			continue;
		}
		const value = Number.parseInt(id.slice(prefix.length), 10);
		if (Number.isFinite(value)) {
			max = Math.max(max, value);
		}
	}
	return max;
}
