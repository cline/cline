import { truncateSplit } from "@cline/shared";
import type { BuiltinSkill } from "./builtin-skills";
import type {
	SkillConfig,
	UserInstructionConfigWatcher,
	WorkflowConfig,
} from "./user-instruction-config-loader";

export type RuntimeCommandKind = "skill" | "workflow";

export type AvailableRuntimeCommand = {
	id: string;
	name: string;
	instructions: string;
	description?: string;
	kind: RuntimeCommandKind;
};

type CommandRecord = {
	item: SkillConfig | WorkflowConfig;
};

function builtinSkillCommands(
	builtinSkills: ReadonlyArray<BuiltinSkill>,
): AvailableRuntimeCommand[] {
	return builtinSkills.map(({ id, skill }) => ({
		id,
		name: skill.name,
		instructions: skill.instructions,
		description: resolveCommandDescription(skill, "skill"),
		kind: "skill",
	}));
}

function resolveCommandDescription(
	item: SkillConfig | WorkflowConfig,
	kind: RuntimeCommandKind,
): string | undefined {
	if (item.description?.trim()) {
		return truncateSplit(item.description, ".");
	}
	if (kind === "workflow") {
		return undefined;
	}
	return truncateSplit(item.instructions, ".");
}

function isCommandEnabled(command: SkillConfig | WorkflowConfig): boolean {
	return command.disabled !== true;
}

function listCommandsForKind(
	watcher: UserInstructionConfigWatcher,
	kind: RuntimeCommandKind,
): AvailableRuntimeCommand[] {
	return [...watcher.getSnapshot(kind).entries()]
		.map(([id, record]) => ({ id, record: record as CommandRecord }))
		.filter(({ record }) => isCommandEnabled(record.item))
		.map(({ id, record }) => ({
			id,
			name: record.item.name,
			instructions: record.item.instructions,
			description: resolveCommandDescription(record.item, kind),
			kind,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function listAvailableRuntimeCommandsFromWatcher(
	watcher: UserInstructionConfigWatcher,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
): AvailableRuntimeCommand[] {
	const byName = new Map<string, AvailableRuntimeCommand>();
	for (const command of [
		...builtinSkillCommands(builtinSkills),
		...listCommandsForKind(watcher, "workflow"),
		...listCommandsForKind(watcher, "skill"),
	]) {
		const normalizedName = command.name.trim().toLowerCase();
		if (!byName.has(normalizedName)) {
			byName.set(normalizedName, command);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveRuntimeSlashCommandFromWatcher(
	input: string,
	watcher: UserInstructionConfigWatcher,
	builtinSkills: ReadonlyArray<BuiltinSkill> = [],
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
	const matched = listAvailableRuntimeCommandsFromWatcher(
		watcher,
		builtinSkills,
	).find((command) => command.name === name);
	return matched ? `${matched.instructions}${remainder}` : input;
}
