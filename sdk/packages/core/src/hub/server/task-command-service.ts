import { resolve } from "node:path";
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
import type { HubConnectionAuthority } from "./command-transport";
import { errorReply, okReply } from "./handlers/context";

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
	"task.factory.replay",
	"task.factory.defaults.get",
	"task.factory.defaults.set",
	"task.factory.limits.get",
	"task.factory.limits.set",
	"task.factory.stages.get",
	"task.factory.stages.set",
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

export class HubAgendaTaskCommandService {
	constructor(
		private readonly tasks: AgendaTaskManagerApi,
		private readonly factoryDefaults?: FactoryDefaultsStore,
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
					const task = await this.tasks.createTask({
						...(payload as unknown as AgendaTaskCreateInput),
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
						createdBy: actor,
					});
					return okReply(envelope, { task });
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
					const requestedDaily =
						payload.dailyCostUsd === undefined
							? undefined
							: payload.dailyCostUsd === null
								? null
								: parseFactoryDailyCostUsd(payload.dailyCostUsd);
					const requestedConcurrency =
						payload.concurrency !== undefined ||
						(requestedPause === undefined && requestedDaily === undefined)
							? parseFactoryConcurrency(payload.concurrency)
							: undefined;
					const store = this.requireFactoryDefaults();
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

	/**
	 * The daily limit (stored, else the default), pushed to the manager so a
	 * restarted Hub enforces the stored value, and today's spend.
	 */
	private async factorySpending(): Promise<{
		dailyCostUsd: number;
		spentTodayUsd: number;
		spendingLimitReached: boolean;
	}> {
		const dailyCostUsd =
			(await this.requireFactoryDefaults().getDailyCostUsd?.()) ??
			FACTORY_DAILY_COST_DEFAULT_USD;
		this.tasks.setFactoryDailyCostUsd?.(dailyCostUsd);
		const spentTodayUsd = (await this.tasks.getFactorySpentTodayUsd?.()) ?? 0;
		return {
			dailyCostUsd,
			spentTodayUsd,
			spendingLimitReached: spentTodayUsd >= dailyCostUsd,
		};
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
