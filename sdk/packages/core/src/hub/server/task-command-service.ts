import { isAbsolute, resolve } from "node:path";
import type {
	AgendaAutomationPolicy,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskUpdateInput,
	HubCommandEnvelope,
	HubCommandName,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	applyFactoryAutonomyDefaults,
	FACTORY_CONCURRENCY_DEFAULT,
	FACTORY_DAILY_COST_DEFAULT_USD,
	factoryPrioritySchema,
	factoryReplayRequestSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { z } from "zod";
import type { AgendaTaskManagerApi } from "../../tasks/agenda-task-api";
import {
	FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME,
	type FactoryDefaultsStore,
	parseFactoryConcurrency,
	parseFactoryDailyCostUsd,
} from "../../tasks/factory-defaults";
import {
	FACTORY_GUIDANCE_MAX_CHARS,
	FACTORY_GUIDANCE_ROLES,
} from "../../tasks/factory-guidance";
import { FactorySettingsError } from "../../tasks/factory-settings";
import { factoryManagerProjects } from "../../tasks/factory-tool";
import type { HubConnectionAuthority } from "./command-transport";
import { errorReply, okReply } from "./handlers/context";

/**
 * Factory settings commands: what a person reads and changes in the app's
 * Factory settings. Writes that change trust or guidance need a client
 * trusted across workspaces; none of these is reachable from a model tool.
 */
const FACTORY_SETTINGS_COMMANDS = [
	"task.factory.guidance.get",
	"task.factory.guidance.history",
	"task.factory.guidance.set",
	"task.factory.guidance.resolve",
	"task.factory.verification.get",
	"task.factory.verification.set",
	"task.factory.storage.get",
	"task.factory.storage.clean",
	"task.factory.reset",
	"task.factory.projects.get",
] as const satisfies readonly HubCommandName[];
const FACTORY_SETTINGS_COMMAND_SET = new Set<HubCommandName>(
	FACTORY_SETTINGS_COMMANDS,
);

const TASK_COMMANDS = new Set<HubCommandName>([
	"task.create",
	"task.list",
	"task.get",
	"task.update",
	"task.approve",
	"task.cancel",
	"task.archive",
	"task.restore",
	"task.delete",
	"task.run",
	"task.factory.start",
	"task.factory.stop",
	"task.factory.stamp",
	"task.factory.audit",
	"task.factory.audit.resolve",
	"task.factory.answer",
	"task.factory.design",
	"task.factory.watch",
	"task.factory.priority",
	"task.factory.split.approve",
	"task.factory.split.keep",
	"task.factory.parts.cancel",
	"task.factory.part.start",
	"task.factory.replay",
	"task.factory.defaults.get",
	"task.factory.defaults.set",
	"task.factory.limits.get",
	"task.factory.limits.set",
	"task.factory.stages.get",
	"task.factory.stages.set",
	...FACTORY_SETTINGS_COMMANDS,
	"task.automation.get",
	"task.automation.set",
]);

export function isAgendaTaskCommand(command: HubCommandName): boolean {
	return TASK_COMMANDS.has(command);
}

function payloadOf(envelope: HubCommandEnvelope): Record<string, unknown> {
	return envelope.payload && typeof envelope.payload === "object"
		? envelope.payload
		: {};
}

function taskIdOf(payload: Record<string, unknown>): string {
	return typeof payload.taskId === "string" ? payload.taskId.trim() : "";
}

function requiredRevision(payload: Record<string, unknown>): number {
	const revision = payload.expectedRevision;
	if (
		typeof revision !== "number" ||
		!Number.isInteger(revision) ||
		revision < 1
	) {
		throw new Error("expectedRevision must be a positive integer");
	}
	return revision;
}

export interface HubAgendaTaskCommandServiceOptions {
	/**
	 * Candidate project directories (the Factory manager's): a settings
	 * command may name only a project that passes `factoryManagerProjects`.
	 */
	listProjects?: () => Promise<readonly (string | undefined)[]>;
}

export class HubAgendaTaskCommandService {
	constructor(
		private readonly tasks: AgendaTaskManagerApi,
		private readonly factoryDefaults?: FactoryDefaultsStore,
		private readonly options: HubAgendaTaskCommandServiceOptions = {},
	) {}

	async handleCommand(
		envelope: HubCommandEnvelope,
		authority?: HubConnectionAuthority,
	): Promise<HubReplyEnvelope> {
		const payload = payloadOf(envelope);
		const actor = {
			kind: "user" as const,
			id: envelope.clientId?.trim() || "hub-client",
			clientId: envelope.clientId?.trim() || undefined,
		};
		if (FACTORY_SETTINGS_COMMAND_SET.has(envelope.command))
			return this.handleFactorySettingsCommand(envelope, payload, authority);
		try {
			const authorizedWorkspace = this.resolveWorkspace(authority);
			const allWorkspaces = payload.allWorkspaces === true;
			if (allWorkspaces && authority?.crossWorkspace !== true)
				throw new Error(
					"Cross-workspace task access requires an authenticated local client",
				);
			const workspaceRoot = allWorkspaces ? undefined : authorizedWorkspace;
			switch (envelope.command) {
				case "task.create": {
					const targetWorkspace =
						allWorkspaces && typeof payload.workspaceRoot === "string"
							? resolve(payload.workspaceRoot)
							: authorizedWorkspace;
					// Only approving a breakdown creates a part.
					const {
						allowDuplicate: rawAllowDuplicate,
						allWorkspaces: _allWorkspaces,
						factoryParentTaskId: _parent,
						...fields
					} = payload;
					const allowDuplicate = z
						.boolean()
						.optional()
						.parse(rawAllowDuplicate);
					const input: AgendaTaskCreateInput = {
						...(fields as unknown as AgendaTaskCreateInput),
						scope: "workspace",
						workspaceRoot: targetWorkspace,
						cwd: targetWorkspace,
						requiresApproval: payload.factory !== undefined,
						queueFactoryDesign: z
							.boolean()
							.optional()
							.parse(payload.queueFactoryDesign),
						factory:
							payload.factory === undefined
								? undefined
								: // Delivery defaults read unset fields, so apply them before the
									// schema fills publishPullRequest with false.
									factoryTaskConfigSchema.parse(
										applyFactoryAutonomyDefaults(payload.factory),
									),
						// A client's priority is the person's: never an agent's or
						// the scoper's, and never with a client-chosen reason.
						factoryPriority:
							payload.factoryPriority == null
								? undefined
								: {
										level: factoryPrioritySchema.parse(
											(payload.factoryPriority as { level?: unknown }).level,
										),
										by: "person",
									},
						createdBy: actor,
					};
					// Factory filings go through the duplicate check; the reply
					// keeps `task` (the stored card when one already covers it).
					if (input.factory && this.tasks.fileFactoryCard) {
						const filing = await this.tasks.fileFactoryCard(input, {
							allowDuplicate,
						});
						const { existing, ...reply } = filing;
						return okReply(envelope, {
							...reply,
							...(existing ? { existing } : {}),
						});
					}
					return okReply(envelope, {
						task: await this.tasks.createTask(input),
					});
				}
				case "task.list": {
					const listInput: AgendaTaskListInput = {
						...(payload as unknown as AgendaTaskListInput),
						...z
							.object({
								factoryReplaySourceRunId: z.string().trim().min(1).optional(),
								factoryOnly: z.boolean().optional(),
								factoryComparisonId:
									factoryReplayRequestSchema.shape.comparisonId.optional(),
							})
							.parse(payload),
					};
					if (allWorkspaces)
						return okReply(envelope, {
							tasks: await this.tasks.listTasks({
								...listInput,
								scope: undefined,
								workspaceRoot: undefined,
							}),
						});
					const [workspaceTasks, globalTasks] = await Promise.all([
						this.tasks.listTasks({
							...listInput,
							scope: "workspace",
							workspaceRoot,
						}),
						this.tasks.listTasks({
							...listInput,
							scope: "global",
							workspaceRoot: undefined,
						}),
					]);
					return okReply(envelope, {
						tasks: [...workspaceTasks, ...globalTasks],
					});
				}
				case "task.get": {
					const task = await this.requireScopedTask(payload, workspaceRoot);
					return okReply(envelope, {
						task,
						runs: this.tasks.getTaskRuns?.(task.taskId) ?? [],
					});
				}
				case "task.update": {
					const current = await this.requireScopedTask(payload, workspaceRoot);
					const task = await this.tasks.updateTask({
						...(payload as unknown as AgendaTaskUpdateInput),
						scope: current.scope,
						workspaceRoot: current.workspaceRoot ?? null,
						cwd: current.cwd ?? null,
						updatedBy: actor,
					});
					return okReply(envelope, { task });
				}
				case "task.approve":
					await this.requireScopedTask(payload, workspaceRoot);
					return okReply(envelope, {
						task: await this.tasks.approveTask(
							taskIdOf(payload),
							actor,
							requiredRevision(payload),
						),
					});
				case "task.cancel":
					await this.requireScopedTask(payload, workspaceRoot);
					return okReply(envelope, {
						task: await this.tasks.cancelTask(
							taskIdOf(payload),
							actor,
							requiredRevision(payload),
							typeof payload.reason === "string" ? payload.reason : undefined,
						),
					});
				case "task.archive":
				case "task.restore": {
					await this.requireScopedTask(payload, workspaceRoot, {
						reconcile: false,
					});
					const taskId = taskIdOf(payload);
					const expectedRevision = requiredRevision(payload);
					const task =
						envelope.command === "task.archive"
							? await this.tasks.archiveTask(taskId, actor, expectedRevision)
							: await this.tasks.restoreTask(taskId, actor, expectedRevision);
					return okReply(envelope, { task });
				}
				case "task.delete": {
					await this.requireScopedTask(payload, workspaceRoot, {
						reconcile: false,
					});
					const taskId = taskIdOf(payload);
					await this.tasks.deleteTask(taskId, actor, requiredRevision(payload));
					return okReply(envelope, { taskId });
				}
				case "task.run": {
					await this.requireScopedTask(payload, workspaceRoot);
					const result = await this.tasks.runTask(
						taskIdOf(payload),
						actor,
						requiredRevision(payload),
						envelope.clientId,
					);
					return okReply(envelope, result);
				}
				case "task.factory.replay": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.replayFactoryTask)
						throw new Error("Factory replay is unavailable");
					const input = factoryReplayRequestSchema.parse(payload);
					return okReply(envelope, {
						tasks: await this.tasks.replayFactoryTask({ ...input, actor }),
					});
				}
				case "task.factory.stamp": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.stampFactoryTask)
						throw new Error("Factory stamping is unavailable");
					const expectedHead = z
						.string()
						.trim()
						.min(1)
						.parse(payload.expectedHead);
					return okReply(envelope, {
						task: await this.tasks.stampFactoryTask(
							taskIdOf(payload),
							expectedHead,
						),
					});
				}
				case "task.factory.audit": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.recordFactoryAudit)
						throw new Error("Factory audit is unavailable");
					const finding = z
						.string()
						.trim()
						.max(20_000)
						.optional()
						.parse(payload.finding);
					return okReply(envelope, {
						task: await this.tasks.recordFactoryAudit(
							taskIdOf(payload),
							finding,
							z
								.enum(["manual", "random"])
								.optional()
								.parse(payload.selectionReason),
						),
					});
				}
				case "task.factory.audit.resolve": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.resolveFactoryFeedback)
						throw new Error("Factory feedback is unavailable");
					const decision = z
						.enum(["save", "discard", "retry"])
						.parse(payload.decision);
					// Saving writes guidance used across the user's projects (or
					// into the project's checkout), so only a trusted local client may.
					if (decision === "save" && authority?.crossWorkspace !== true)
						throw new Error(
							"Saving a Factory rule requires an authenticated local client",
						);
					return okReply(
						envelope,
						await this.tasks.resolveFactoryFeedback(
							taskIdOf(payload),
							decision,
							z.string().trim().min(1).optional().parse(payload.expectedHash),
						),
					);
				}
				case "task.factory.answer": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.answerFactoryQuestion)
						throw new Error("Factory questions are unavailable");
					const questionId = z.string().trim().min(1).parse(payload.questionId);
					const answer = z
						.string()
						.trim()
						.min(1)
						.max(50_000)
						.parse(payload.answer);
					return okReply(envelope, {
						task: await this.tasks.answerFactoryQuestion(
							taskIdOf(payload),
							questionId,
							answer,
						),
					});
				}
				case "task.factory.design": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.startFactoryDesign)
						throw new Error("Feature design is unavailable");
					return okReply(
						envelope,
						await this.tasks.startFactoryDesign(
							taskIdOf(payload),
							envelope.clientId,
						),
					);
				}
				case "task.factory.watch": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.setFactoryWatch)
						throw new Error("PR follow-up is unavailable");
					const enabled = z.boolean().parse(payload.enabled);
					return okReply(envelope, {
						task: await this.tasks.setFactoryWatch(
							taskIdOf(payload),
							enabled,
							requiredRevision(payload),
						),
					});
				}
				case "task.factory.priority": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.setFactoryPriority)
						throw new Error("Factory priority is unavailable");
					return okReply(envelope, {
						task: await this.tasks.setFactoryPriority(
							taskIdOf(payload),
							factoryPrioritySchema.nullable().parse(payload.priority),
							"person",
						),
					});
				}
				// Approving a breakdown, cancelling a parent's remaining parts and
				// starting a waiting part anyway are a person's decisions in the
				// app: trusted local clients only, and no tool reaches them.
				case "task.factory.split.approve": {
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Approving a breakdown requires an authenticated local client",
						);
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.approveFactorySplit)
						throw new Error("Splitting Factory work is unavailable");
					const omit = z
						.array(z.number().int().nonnegative())
						.max(20)
						.optional()
						.parse(payload.omit);
					return okReply(
						envelope,
						await this.tasks.approveFactorySplit(
							taskIdOf(payload),
							requiredRevision(payload),
							actor,
							omit,
						),
					);
				}
				case "task.factory.split.keep": {
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.keepFactoryCardWhole)
						throw new Error("Splitting Factory work is unavailable");
					return okReply(envelope, {
						task: await this.tasks.keepFactoryCardWhole(
							taskIdOf(payload),
							requiredRevision(payload),
							actor,
						),
					});
				}
				case "task.factory.parts.cancel": {
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Cancelling a card's parts requires an authenticated local client",
						);
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.cancelFactoryParts)
						throw new Error("Splitting Factory work is unavailable");
					return okReply(
						envelope,
						await this.tasks.cancelFactoryParts(taskIdOf(payload), actor),
					);
				}
				case "task.factory.part.start": {
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Starting a waiting part requires an authenticated local client",
						);
					await this.requireScopedTask(payload, workspaceRoot);
					if (!this.tasks.startFactoryPartAnyway)
						throw new Error("Splitting Factory work is unavailable");
					return okReply(envelope, {
						task: await this.tasks.startFactoryPartAnyway(
							taskIdOf(payload),
							requiredRevision(payload),
							actor,
						),
					});
				}
				case "task.factory.start": {
					const entries = z
						.array(
							z.object({
								taskId: z.string().min(1),
								expectedRevision: z.number().int().positive(),
							}),
						)
						.min(1)
						.max(100)
						.parse(payload.tasks);
					for (const entry of entries)
						await this.requireScopedTask(entry, workspaceRoot);
					if (!this.tasks.startFactoryQueue)
						throw new Error("Feature queue is unavailable");
					await this.tasks.startFactoryQueue(entries, actor, envelope.clientId);
					return okReply(envelope, { queued: entries.length });
				}
				case "task.factory.stop":
					this.tasks.stopFactoryQueue?.(workspaceRoot);
					return okReply(envelope, { stopped: true });

				case "task.factory.defaults.get": {
					const workflow =
						await this.requireFactoryDefaults().getDefaultWorkflow();
					// The fail-closed stand-in is not the user's default.
					return okReply(
						envelope,
						workflow &&
							workflow.name !== FACTORY_DEFAULTS_UNAVAILABLE_WORKFLOW_NAME
							? { workflow }
							: {},
					);
				}
				case "task.factory.defaults.set": {
					// The default applies to work submitted in every project, so only
					// a client trusted across workspaces may change it.
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Changing the default Factory workflow requires an authenticated local client",
						);
					if (!("workflow" in payload))
						throw new Error(
							"task.factory.defaults.set requires a workflow or null",
						);
					const store = this.requireFactoryDefaults();
					// Never-scoped backlog adopts the new default's policy and starts.
					// Hosts resend an unchanged default on every connection; that
					// sweeps only when it is the first default this Hub received.
					const received = await store.getDefaultsReceived();
					const before = await store.getDefaultWorkflow();
					const adopt = (changed: boolean) => {
						if (changed || !received)
							void this.tasks.adoptFactoryBacklog?.().catch(() => undefined);
					};
					if (payload.workflow === null) {
						await store.clearDefaultWorkflow();
						adopt(before !== undefined);
						return okReply(envelope, {});
					}
					const workflow = await store.setDefaultWorkflow(payload.workflow);
					adopt(
						before?.name !== workflow.name ||
							before?.revision !== workflow.revision,
					);
					return okReply(envelope, { workflow });
				}
				case "task.factory.limits.get": {
					const concurrency =
						this.tasks.getFactoryConcurrency?.() ??
						(await this.requireFactoryDefaults().getConcurrency()) ??
						FACTORY_CONCURRENCY_DEFAULT;
					const paused =
						this.tasks.getFactoryPaused?.() ??
						(await this.requireFactoryDefaults().getPaused());
					return okReply(envelope, {
						concurrency,
						paused,
						...(await this.factorySpending()),
						duplicateCheck: await this.factoryDuplicateCheck(),
						...(await this.factorySplitSettings()),
					});
				}
				case "task.factory.limits.set": {
					// The limit spans every project on this Hub, so only a client
					// trusted across workspaces may change it.
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Changing the Factory working limit requires an authenticated local client",
						);
					// Any field may be sent alone; older clients send only concurrency.
					const requestedPause = z.boolean().optional().parse(payload.paused);
					// null (or 0) is "no daily limit"; send 50 for the default.
					const requestedDaily =
						payload.dailyCostUsd === undefined
							? undefined
							: parseFactoryDailyCostUsd(payload.dailyCostUsd);
					const requestedDuplicateCheck = z
						.boolean()
						.optional()
						.parse(payload.duplicateCheck);
					const requestedSplit = z
						.boolean()
						.optional()
						.parse(payload.splitLargeWork);
					const requestedConcurrency =
						payload.concurrency !== undefined ||
						(requestedPause === undefined &&
							requestedDaily === undefined &&
							requestedDuplicateCheck === undefined &&
							requestedSplit === undefined)
							? parseFactoryConcurrency(payload.concurrency)
							: undefined;
					const store = this.requireFactoryDefaults();
					if (requestedSplit !== undefined) {
						if (!store.setSplitLargeWork)
							throw new Error("The Factory split setting is unavailable");
						this.tasks.setFactorySplitLargeWork?.(
							await store.setSplitLargeWork(requestedSplit),
						);
					}
					if (requestedDuplicateCheck !== undefined) {
						if (!store.setDuplicateCheck)
							throw new Error(
								"The Factory duplicate check setting is unavailable",
							);
						this.tasks.setFactoryDuplicateCheck?.(
							await store.setDuplicateCheck(requestedDuplicateCheck),
						);
					}
					if (requestedDaily !== undefined) {
						if (!store.setDailyCostUsd)
							throw new Error(
								"The Factory daily spending limit is unavailable",
							);
						await store.setDailyCostUsd(requestedDaily);
					}
					let concurrency: number;
					if (requestedConcurrency !== undefined) {
						const stored = await store.setConcurrency(requestedConcurrency);
						concurrency = this.tasks.setFactoryConcurrency?.(stored) ?? stored;
					} else
						concurrency =
							this.tasks.getFactoryConcurrency?.() ??
							(await store.getConcurrency()) ??
							FACTORY_CONCURRENCY_DEFAULT;
					let paused: boolean;
					if (requestedPause !== undefined) {
						const stored = await store.setPaused(requestedPause);
						paused = this.tasks.setFactoryPaused?.(stored) ?? stored;
					} else
						paused =
							this.tasks.getFactoryPaused?.() ?? (await store.getPaused());
					return okReply(envelope, {
						concurrency,
						paused,
						...(await this.factorySpending()),
						duplicateCheck: await this.factoryDuplicateCheck(),
						...(await this.factorySplitSettings()),
					});
				}
				case "task.factory.stages.get": {
					if (!this.tasks.getFactoryStages)
						throw new Error("Repository stages are unavailable");
					return okReply(
						envelope,
						await this.tasks.getFactoryStages(
							this.stagesWorkspace(payload, authority, authorizedWorkspace),
						),
					);
				}
				case "task.factory.stages.set": {
					// Approving lets a repository command run on every card of
					// the project, so only a trusted local client may decide.
					if (authority?.crossWorkspace !== true)
						throw new Error(
							"Deciding on a repository stage requires an authenticated local client",
						);
					if (!this.tasks.decideFactoryStage)
						throw new Error("Repository stages are unavailable");
					const decision = z
						.object({
							stageId: z.string().trim().min(1),
							expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
							decision: z.enum(["approved", "declined", "undecided"]),
						})
						.parse(payload);
					return okReply(
						envelope,
						await this.tasks.decideFactoryStage(
							this.stagesWorkspace(payload, authority, authorizedWorkspace),
							decision.stageId,
							decision.expectedHash,
							decision.decision,
						),
					);
				}
				case "task.automation.get":
					return okReply(envelope, {
						policy: await this.tasks.getAutomationPolicy(authorizedWorkspace),
					});
				case "task.automation.set": {
					const rawPolicy =
						payload.policy &&
						typeof payload.policy === "object" &&
						!Array.isArray(payload.policy)
							? (payload.policy as Omit<AgendaAutomationPolicy, "updatedAt">)
							: undefined;
					if (!rawPolicy) {
						throw new Error("task.automation.set requires a policy object");
					}
					return okReply(envelope, {
						policy: await this.tasks.setAutomationPolicy(
							{ ...rawPolicy, scopeKey: authorizedWorkspace },
							actor,
						),
					});
				}
				default:
					return errorReply(
						envelope,
						"unsupported_command",
						`Unsupported agenda task command: ${envelope.command}`,
					);
			}
		} catch (error) {
			return errorReply(
				envelope,
				"task_command_failed",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/** Whether scoping may split large work (on unless turned off), and how it went. */
	private async factorySplitSettings(): Promise<{
		splitLargeWork: boolean;
		splitCounts?: ReturnType<
			NonNullable<AgendaTaskManagerApi["getFactorySplitCounts"]>
		>;
	}> {
		const splitCounts = this.tasks.getFactorySplitCounts?.();
		return {
			splitLargeWork:
				this.tasks.getFactorySplitLargeWork?.() ??
				(await this.requireFactoryDefaults().getSplitLargeWork?.()) ??
				true,
			...(splitCounts ? { splitCounts } : {}),
		};
	}

	/** Whether new filings are checked for duplicates (on unless turned off). */
	private async factoryDuplicateCheck(): Promise<boolean> {
		return (
			this.tasks.getFactoryDuplicateCheck?.() ??
			(await this.requireFactoryDefaults().getDuplicateCheck?.()) ??
			true
		);
	}

	/**
	 * The daily limit (stored, else the default), pushed to the manager so a
	 * restarted Hub enforces the stored value, and today's spend.
	 */
	private async factorySpending(): Promise<{
		dailyCostUsd: number | null;
		spentTodayUsd: number;
		spendingLimitReached: boolean;
	}> {
		const stored = await this.requireFactoryDefaults().getDailyCostUsd?.();
		// null: the person chose no daily limit; unset: the default.
		const dailyCostUsd =
			stored === undefined ? FACTORY_DAILY_COST_DEFAULT_USD : stored;
		this.tasks.setFactoryDailyCostUsd?.(dailyCostUsd);
		const spentTodayUsd = (await this.tasks.getFactorySpentTodayUsd?.()) ?? 0;
		return {
			dailyCostUsd,
			spentTodayUsd,
			spendingLimitReached:
				dailyCostUsd !== null && spentTodayUsd >= dailyCostUsd,
		};
	}

	/**
	 * Factory settings commands. Reads need a Hub-authorized client (another
	 * project, or every project, needs one trusted across workspaces); writes
	 * that change trust or guidance always need one trusted across
	 * workspaces. A project is named only by a `workspaceRoot` Factory knows.
	 * Refusals carry a stable `error.code`; a stale write carries the current
	 * hash in `error.details.currentHash`.
	 */
	private async handleFactorySettingsCommand(
		envelope: HubCommandEnvelope,
		payload: Record<string, unknown>,
		authority: HubConnectionAuthority | undefined,
	): Promise<HubReplyEnvelope> {
		try {
			const authorizedWorkspace = this.resolveWorkspace(authority);
			const trusted = authority?.crossWorkspace === true;
			const requireTrusted = (what: string) => {
				if (!trusted)
					throw new FactorySettingsError(
						"factory_settings_unauthorized",
						`${what} requires an authenticated local client`,
					);
			};
			const engine = <K extends keyof AgendaTaskManagerApi>(
				name: K,
			): NonNullable<AgendaTaskManagerApi[K]> => {
				const method = this.tasks[name];
				if (typeof method !== "function")
					throw new FactorySettingsError(
						"factory_settings_unavailable",
						"This Factory setting is unavailable in this Hub",
					);
				return (method as (...args: never[]) => unknown).bind(
					this.tasks,
				) as NonNullable<AgendaTaskManagerApi[K]>;
			};
			const role = z.enum(FACTORY_GUIDANCE_ROLES);
			const hash16 = z.string().regex(/^[0-9a-f]{16}$/);
			const project = (required: boolean) =>
				this.settingsProject(
					payload.workspaceRoot,
					authority,
					authorizedWorkspace,
					required,
				);
			switch (envelope.command) {
				case "task.factory.guidance.get": {
					z.object({ workspaceRoot: z.string().optional() })
						.strict()
						.parse(payload);
					return okReply(envelope, {
						...(await engine("getFactoryGuidance")(await project(false))),
					});
				}
				case "task.factory.guidance.history": {
					const input = z
						.object({
							role: role.optional(),
							workspaceRoot: z.string().optional(),
							limit: z.number().int().min(1).max(50).default(20),
							before: z.string().max(300).optional(),
						})
						.strict()
						.parse(payload);
					return okReply(
						envelope,
						await engine("getFactoryGuidanceHistory")({
							role: input.role,
							workspaceRoot: await project(false),
							limit: input.limit,
							before: input.before,
						}),
					);
				}
				case "task.factory.guidance.set":
				case "task.factory.guidance.resolve": {
					requireTrusted("Changing Factory guidance");
					const setting = envelope.command === "task.factory.guidance.set";
					const input = z
						.object({
							role,
							scope: z.enum(["user", "repository"]),
							workspaceRoot: z.string().optional(),
							expectedHash: hash16,
							...(setting
								? {
										content: z.string().max(FACTORY_GUIDANCE_MAX_CHARS * 2),
										note: z.string().max(200).optional(),
									}
								: { decision: z.enum(["accept", "discard"]) }),
						})
						.strict()
						.parse(payload) as {
						role: (typeof FACTORY_GUIDANCE_ROLES)[number];
						scope: "user" | "repository";
						workspaceRoot?: string;
						expectedHash: string;
						content?: string;
						note?: string;
						decision?: "accept" | "discard";
					};
					if (input.scope === "user" && input.workspaceRoot !== undefined)
						throw new FactorySettingsError(
							"factory_settings_invalid_input",
							"Your guidance is not tied to a project; omit workspaceRoot",
						);
					const target = {
						role: input.role,
						scope: input.scope,
						...(input.scope === "repository"
							? { workspaceRoot: await project(true) }
							: {}),
					};
					return okReply(
						envelope,
						setting
							? await engine("setFactoryGuidance")({
									...target,
									expectedHash: input.expectedHash,
									content: input.content ?? "",
									note: input.note,
								})
							: await engine("resolveFactoryGuidance")({
									...target,
									expectedHash: input.expectedHash,
									decision: input.decision ?? "accept",
								}),
					);
				}
				case "task.factory.verification.get": {
					z.object({ workspaceRoot: z.string() }).strict().parse(payload);
					return okReply(envelope, {
						...(await engine("getFactoryVerification")(
							(await project(true)) as string,
						)),
					});
				}
				case "task.factory.verification.set": {
					requireTrusted("Changing a project's test setup");
					const input = z
						.object({
							workspaceRoot: z.string(),
							decision: z.enum(["approve", "remove"]),
							expectedHash: z
								.string()
								.regex(/^[0-9a-f]{64}$/)
								.optional(),
							profile: z.record(z.string(), z.unknown()).optional(),
						})
						.strict()
						.parse(payload);
					if (input.decision === "remove" && input.profile !== undefined)
						throw new FactorySettingsError(
							"factory_settings_invalid_input",
							"remove takes no profile",
						);
					return okReply(envelope, {
						...(await engine("setFactoryVerification")({
							workspaceRoot: (await project(true)) as string,
							decision: input.decision,
							expectedHash: input.expectedHash,
							profile: input.profile,
						})),
					});
				}
				case "task.factory.storage.get": {
					// Every project's working copies: a trusted client only.
					requireTrusted("Reading Factory's storage");
					const input = z
						.object({ refresh: z.boolean().optional() })
						.strict()
						.parse(payload);
					return okReply(envelope, {
						...(await engine("getFactoryStorage")({
							refresh: input.refresh,
						})),
					});
				}
				case "task.factory.storage.clean": {
					requireTrusted("Removing Factory working copies");
					z.object({ what: z.literal("finished_worktrees") })
						.strict()
						.parse(payload);
					return okReply(envelope, {
						...(await engine("cleanFactoryStorage")()),
					});
				}
				case "task.factory.reset": {
					requireTrusted("Resetting Factory");
					const input = z
						.object({
							what: z.enum([
								"stage_trust",
								"verification_trust",
								"user_guidance",
								"settings",
							]),
							workspaceRoot: z.string().optional(),
							dryRun: z.boolean().optional(),
						})
						.strict()
						.parse(payload);
					if (input.what === "settings")
						return okReply(envelope, await this.resetFactorySettings(input));
					return okReply(
						envelope,
						await engine("resetFactory")({
							what: input.what,
							...(input.workspaceRoot !== undefined
								? { workspaceRoot: await project(true) }
								: {}),
							dryRun: input.dryRun,
						}),
					);
				}
				case "task.factory.projects.get": {
					requireTrusted("Listing Factory's projects");
					z.object({}).strict().parse(payload);
					return okReply(
						envelope,
						await engine("getFactoryProjects")(await this.knownProjects()),
					);
				}
				default:
					return errorReply(
						envelope,
						"unsupported_command",
						`Unsupported agenda task command: ${envelope.command}`,
					);
			}
		} catch (error) {
			if (error instanceof FactorySettingsError)
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: false,
					error: {
						code: error.code,
						message: error.message,
						...(error.details ? { details: error.details } : {}),
					},
				};
			if (error instanceof z.ZodError)
				return errorReply(
					envelope,
					"factory_settings_invalid_input",
					error.issues
						.slice(0, 3)
						.map(
							(issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
						)
						.join("; "),
				);
			return errorReply(
				envelope,
				"task_command_failed",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/**
	 * "Reset Factory settings" on the Hub: two cards at once, the default
	 * daily limit and the duplicate check on, each pushed to the running
	 * manager as `task.factory.limits.set` does. The pause and the default
	 * workflow are left alone (the host resets its default workflow and
	 * pushes it). `dryRun` reports only.
	 */
	private async resetFactorySettings(input: { dryRun?: boolean }) {
		const store = this.requireFactoryDefaults();
		if (input.dryRun !== true) {
			const concurrency = await store.setConcurrency(
				FACTORY_CONCURRENCY_DEFAULT,
			);
			this.tasks.setFactoryConcurrency?.(concurrency);
			await store.setDailyCostUsd?.(FACTORY_DAILY_COST_DEFAULT_USD);
			this.tasks.setFactoryDailyCostUsd?.(FACTORY_DAILY_COST_DEFAULT_USD);
			if (store.setDuplicateCheck)
				this.tasks.setFactoryDuplicateCheck?.(
					await store.setDuplicateCheck(true),
				);
		}
		return {
			what: "settings",
			dryRun: input.dryRun === true,
			concurrency: FACTORY_CONCURRENCY_DEFAULT,
			dailyCostUsd: FACTORY_DAILY_COST_DEFAULT_USD,
			duplicateCheck: true,
		};
	}

	/** The projects Factory knows: existing git repositories outside Cline's folders. */
	private async knownProjects(): Promise<string[]> {
		return factoryManagerProjects((await this.options.listProjects?.()) ?? []);
	}

	/**
	 * The project a settings command names. Absent: the connection's own
	 * workspace. Named: an absolute path that is the connection's own
	 * workspace, or (for a client trusted across workspaces) a project
	 * Factory knows. Never any other directory.
	 */
	private async settingsProject(
		raw: unknown,
		authority: HubConnectionAuthority | undefined,
		authorizedWorkspace: string,
		required: boolean,
	): Promise<string | undefined> {
		const requested = z.string().trim().min(1).max(4096).optional().parse(raw);
		if (!requested) return required ? authorizedWorkspace : undefined;
		if (!isAbsolute(requested))
			throw new FactorySettingsError(
				"factory_unknown_project",
				"workspaceRoot must be the absolute path of a project Factory knows",
			);
		const root = resolve(requested);
		if (root === authorizedWorkspace) return root;
		if (authority?.crossWorkspace !== true)
			throw new FactorySettingsError(
				"factory_settings_unauthorized",
				"Cross-workspace task access requires an authenticated local client",
			);
		if (!(await this.knownProjects()).includes(root))
			throw new FactorySettingsError(
				"factory_unknown_project",
				"That folder is not a project Factory knows",
			);
		return root;
	}

	private requireFactoryDefaults(): FactoryDefaultsStore {
		if (!this.factoryDefaults)
			throw new Error("Factory defaults are unavailable");
		return this.factoryDefaults;
	}

	/**
	 * The checkout a stages command reads: `workspaceRoot` from a client
	 * trusted across workspaces, else the connection's own workspace.
	 */
	private stagesWorkspace(
		payload: Record<string, unknown>,
		authority: HubConnectionAuthority | undefined,
		authorizedWorkspace: string,
	): string {
		const requested = z
			.string()
			.trim()
			.min(1)
			.optional()
			.parse(payload.workspaceRoot);
		if (!requested) return authorizedWorkspace;
		if (
			authority?.crossWorkspace !== true &&
			resolve(requested) !== authorizedWorkspace
		)
			throw new Error(
				"Cross-workspace task access requires an authenticated local client",
			);
		return resolve(requested);
	}

	private resolveWorkspace(authority?: HubConnectionAuthority): string {
		const workspaceRoot = authority?.workspaceContext?.workspaceRoot?.trim();
		if (!authority?.clientId || !workspaceRoot) {
			throw new Error("task commands require a Hub-authorized workspace");
		}
		return resolve(workspaceRoot);
	}

	private async requireScopedTask(
		payload: Record<string, unknown>,
		workspaceRoot: string | undefined,
		options?: { reconcile?: boolean },
	) {
		const task = await this.tasks.getTask(taskIdOf(payload), options);
		if (
			!task ||
			(workspaceRoot !== undefined &&
				task.scope === "workspace" &&
				(!task.workspaceRoot || resolve(task.workspaceRoot) !== workspaceRoot))
		) {
			throw new Error("task does not exist in this workspace");
		}
		return task;
	}
}
