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
import { factoryTaskConfigSchema } from "@cline/shared";
import { z } from "zod";
import type { AgendaTaskManagerApi } from "../../tasks/agenda-task-api";
import type { HubConnectionAuthority } from "./command-transport";
import { errorReply, okReply } from "./handlers/context";

const TASK_COMMANDS = new Set<HubCommandName>([
	"task.create",
	"task.list",
	"task.get",
	"task.update",
	"task.approve",
	"task.cancel",
	"task.run",
	"task.factory.start",
	"task.factory.stop",
	"task.factory.design",
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
	constructor(private readonly tasks: AgendaTaskManagerApi) {}

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
						factory:
							payload.factory === undefined
								? undefined
								: factoryTaskConfigSchema.parse(payload.factory),
						createdBy: actor,
					});
					return okReply(envelope, { task });
				}
				case "task.list": {
					const listInput = payload as unknown as AgendaTaskListInput;
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
	) {
		const task = await this.tasks.getTask(taskIdOf(payload));
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
