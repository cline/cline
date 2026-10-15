import type {
	AgendaAutomationPolicy,
	AgendaTaskActor,
	AgendaTaskCreateInput,
	AgendaTaskListInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
} from "@cline/shared";

/**
 * The single mutation boundary for agenda tasks. File reconciliation, Hub
 * commands, and agent tools all route through this interface so lifecycle
 * invariants are enforced in one place.
 */
export interface AgendaTaskManagerApi {
	createTask(input: AgendaTaskCreateInput): Promise<AgendaTaskRecord>;
	listTasks(input?: AgendaTaskListInput): Promise<AgendaTaskRecord[]>;
	getTask(taskId: string): Promise<AgendaTaskRecord | undefined>;
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
	runTask(
		taskId: string,
		actor: AgendaTaskActor,
		expectedRevision: number,
		requestedByClientId?: string,
	): Promise<{ task: AgendaTaskRecord; run?: AgendaTaskRunRecord }>;
	getAutomationPolicy(scopeKey?: string): Promise<AgendaAutomationPolicy>;
	setAutomationPolicy(
		policy: Omit<AgendaAutomationPolicy, "updatedAt">,
		actor: AgendaTaskActor,
	): Promise<AgendaAutomationPolicy>;
}
