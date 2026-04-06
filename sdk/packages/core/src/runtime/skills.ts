import type { UserInstructionConfigWatcher } from "../extensions";
import {
	listAvailableRuntimeCommandsForKindFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./commands";

export type AvailableSkill = {
	id: string;
	name: string;
	instructions: string;
};

function matchesLeadingSlashCommand(input: string, name: string): boolean {
	const match = input.match(/^\/(\S+)/);
	return match?.[1] === name;
}

export function listAvailableSkillsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableSkill[] {
	return listAvailableRuntimeCommandsForKindFromWatcher(watcher, "skill").map(
		(skill) => ({
			id: skill.id,
			name: skill.name,
			instructions: skill.instructions,
		}),
	);
}

/**
 * Expands a leading slash command (e.g. "/release") to skill instructions.
 * If the input starts with "/<skill-name>", that prefix is replaced and the
 * remaining input is preserved unchanged.
 */
export function resolveSkillsSlashCommandFromWatcher(
	input: string,
	watcher: UserInstructionConfigWatcher,
): string {
	const resolved = resolveRuntimeSlashCommandFromWatcher(input, watcher);
	const matched = listAvailableSkillsFromWatcher(watcher).some((skill) =>
		matchesLeadingSlashCommand(input, skill.name),
	);
	return matched ? resolved : input;
}
