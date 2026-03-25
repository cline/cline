import type { UserInstructionConfigWatcher, WorkflowConfig } from "../agents";

export type AvailableWorkflow = {
	id: string;
	name: string;
	instructions: string;
};

function isWorkflowEnabled(workflow: WorkflowConfig): boolean {
	return workflow.disabled !== true;
}

export function listAvailableWorkflowsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableWorkflow[] {
	const snapshot = watcher.getSnapshot("workflow");
	return [...snapshot.entries()]
		.map(([id, record]) => ({ id, workflow: record.item as WorkflowConfig }))
		.filter(({ workflow }) => isWorkflowEnabled(workflow))
		.map(({ id, workflow }) => ({
			id,
			name: workflow.name,
			instructions: workflow.instructions,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Expands a leading slash command (e.g. "/release") to workflow instructions.
 * If the input starts with "/<workflow-name>", that prefix is replaced and the
 * remaining input is preserved unchanged.
 */
export function resolveWorkflowSlashCommandFromWatcher(
	input: string,
	watcher: UserInstructionConfigWatcher,
): string {
	if (!input.startsWith("/") || input.length < 2) {
		return input;
	}
	const match = input.match(/^\/(\S+)/);
	if (!match) {
		return input;
	}
	const name = match[1];
	if (!name) {
		return input;
	}
	const commandLength = name.length + 1;
	const remainder = input.slice(commandLength);
	const matched = listAvailableWorkflowsFromWatcher(watcher).find(
		(workflow) => workflow.name === name,
	);
	return matched ? `${matched.instructions}${remainder}` : input;
}
