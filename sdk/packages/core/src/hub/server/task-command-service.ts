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

/**
 * Workspace the client explicitly named in the command payload. Multi-workspace
 * clients (the desktop app's composer can switch workspaces without
 * re-registering its Hub connection) pass this to act on a workspace other
 * than the one recorded on the connection. The connection must still be
 * Hub-authorized either way, so this selects a workspace rather than
 * bypassing the authorization gate.
 */
function explicitWorkspaceOf(
	payload: Record<string, unknown>,
): string | undefined {
	const workspaceRoot =
		typeof payload.workspaceRoot === "string" ? payload.workspaceRoot.trim() : "";
	return workspaceRoot ? resolve(workspaceRoot) : undefined;
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
			// The connection's registered workspace authorizes task access; an
			// explicit payload workspaceRoot selects which workspace to act on.
			const authorityWorkspace = this.resolveWorkspace(authority);
			const workspaceRoot =
				explicitWorkspaceOf(payload) ?? authorityWorkspace;
			switch (envelope.command) {
				case "task.create": {
					const input = payload as unknown as AgendaTaskCreateInput;
					const scope = input.scope === "global" ? "global" : "workspace";
					const task = await this.tasks.createTask({
						...input,
						scope,
						workspaceRoot: scope === "workspace" ? workspaceRoot : undefined,
						cwd: scope === "workspace" ? workspaceRoot : undefined,
						requiresApproval: false,
						createdBy: actor,
					});
					return okReply(envelope, { task });
				}
				case "task.list": {
					const listInput = payload as unknown as AgendaTaskListInput;
					const workspaceQuery = {
						...listInput,
						scope: "workspace" as const,
						workspaceRoot,
					};
					const globalQuery = {
						...listInput,
						scope: "global" as const,
						workspaceRoot: undefined,
					};
					if (listInput.scope === "workspace") {
						return okReply(envelope, {
							tasks: await this.tasks.listTasks(workspaceQuery),
						});
					}
					if (listInput.scope === "global") {
						return okReply(envelope, {
							tasks: await this.tasks.listTasks(globalQuery),
						});
					}
					const [workspaceTasks, globalTasks] = await Promise.all([
						this.tasks.listTasks(workspaceQuery),
						this.tasks.listTasks(globalQuery),
					]);
					return okReply(envelope, {
						tasks: [...workspaceTasks, ...globalTasks],
					});
				}
				case "task.get": {
					const task = await this.requireScopedTask(payload, workspaceRoot);
					return okReply(envelope, {
						task,
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
				case "task.automation.get":
					return okReply(envelope, {
						policy: await this.tasks.getAutomationPolicy(workspaceRoot),
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
					// The global policy (which governs global-scope tasks) is
					// addressable by its literal scope key; any other requested key
					// is pinned to the selected workspace.
					const scopeKey =
						rawPolicy.scopeKey === "global" ? "global" : workspaceRoot;
					return okReply(envelope, {
						policy: await this.tasks.setAutomationPolicy(
							{ ...rawPolicy, scopeKey },
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
		workspaceRoot: string,
	) {
		const task = await this.tasks.getTask(taskIdOf(payload));
		if (
			!task ||
			(task.scope === "workspace" &&
				(!task.workspaceRoot || resolve(task.workspaceRoot) !== workspaceRoot))
		) {
			throw new Error("task does not exist in this workspace");
		}
		return task;
	}
}
