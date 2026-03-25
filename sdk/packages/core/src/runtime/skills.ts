import type { SkillConfig, UserInstructionConfigWatcher } from "../agents";

export type AvailableSkill = {
	id: string;
	name: string;
	instructions: string;
};

function isSkillEnabled(skill: SkillConfig): boolean {
	return skill.disabled !== true;
}

export function listAvailableSkillsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableSkill[] {
	const skills = [...watcher.getSnapshot("skill").entries()]
		.map(([id, record]) => ({ id, skill: record.item as SkillConfig }))
		.filter(({ skill }) => isSkillEnabled(skill))
		.map(({ id, skill }) => ({
			id,
			name: skill.name,
			instructions: skill.instructions,
		}));

	return [...skills].sort((a, b) => a.name.localeCompare(b.name));
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
	const matched = listAvailableSkillsFromWatcher(watcher).find(
		(skill) => skill.name === name,
	);
	return matched ? `${matched.instructions}${remainder}` : input;
}
