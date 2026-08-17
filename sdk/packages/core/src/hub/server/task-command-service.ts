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

	async handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		const payload = payloadOf(envelope);
		const actor = {
			kind: "user" as const,
			id: envelope.clientId?.trim() || "hub-client",
			clientId: envelope.clientId?.trim() || undefined,
		};
		try {
			switch (envelope.command) {
				case "task.create": {
					const task = await this.tasks.createTask({
						...(payload as unknown as AgendaTaskCreateInput),
						createdBy: actor,
					});
					return okReply(envelope, { task });
				}
				case "task.list":
					return okReply(envelope, {
						tasks: await this.tasks.listTasks(
							payload as unknown as AgendaTaskListInput,
						),
					});
				case "task.get":
					return okReply(envelope, {
						task: await this.tasks.getTask(taskIdOf(payload)),
					});
				case "task.update": {
					const task = await this.tasks.updateTask({
						...(payload as unknown as AgendaTaskUpdateInput),
						updatedBy: actor,
					});
					return okReply(envelope, { task });
				}
				case "task.approve":
					return okReply(envelope, {
						task: await this.tasks.approveTask(
							taskIdOf(payload),
							actor,
							requiredRevision(payload),
						),
					});
				case "task.cancel":
					return okReply(envelope, {
						task: await this.tasks.cancelTask(
							taskIdOf(payload),
							actor,
							requiredRevision(payload),
							typeof payload.reason === "string" ? payload.reason : undefined,
						),
					});
				case "task.run": {
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
						policy: await this.tasks.getAutomationPolicy(),
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
						policy: await this.tasks.setAutomationPolicy(rawPolicy, actor),
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
}
