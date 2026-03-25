import type { UserInstructionConfigWatcher } from "../agents";
import {
	listAvailableRuntimeCommandsForKindFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./commands";

export type AvailableWorkflow = {
	id: string;
	name: string;
	instructions: string;
};

function matchesLeadingSlashCommand(input: string, name: string): boolean {
	const match = input.match(/^\/(\S+)/);
	return match?.[1] === name;
}

export function listAvailableWorkflowsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableWorkflow[] {
	return listAvailableRuntimeCommandsForKindFromWatcher(
		watcher,
		"workflow",
	).map((workflow) => ({
		id: workflow.id,
		name: workflow.name,
		instructions: workflow.instructions,
	}));
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
	const resolved = resolveRuntimeSlashCommandFromWatcher(input, watcher);
	const matched = listAvailableWorkflowsFromWatcher(watcher).some((workflow) =>
		matchesLeadingSlashCommand(input, workflow.name),
	);
	return matched ? resolved : input;
}
