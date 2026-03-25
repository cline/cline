import type {
	SkillConfig,
	UserInstructionConfigWatcher,
	WorkflowConfig,
} from "../agents";

export type RuntimeCommandKind = "skill" | "workflow";

export type AvailableRuntimeCommand = {
	id: string;
	name: string;
	instructions: string;
	kind: RuntimeCommandKind;
};

type CommandRecord = {
	item: SkillConfig | WorkflowConfig;
};

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
			kind,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function listAvailableRuntimeCommandsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableRuntimeCommand[] {
	const byName = new Map<string, AvailableRuntimeCommand>();
	for (const command of [
		...listCommandsForKind(watcher, "workflow"),
		...listCommandsForKind(watcher, "skill"),
	]) {
		if (!byName.has(command.name)) {
			byName.set(command.name, command);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveRuntimeSlashCommandFromWatcher(
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
	const matched = listAvailableRuntimeCommandsFromWatcher(watcher).find(
		(command) => command.name === name,
	);
	return matched ? `${matched.instructions}${remainder}` : input;
}

export function listAvailableRuntimeCommandsForKindFromWatcher(
	watcher: UserInstructionConfigWatcher,
	kind: RuntimeCommandKind,
): AvailableRuntimeCommand[] {
	return listCommandsForKind(watcher, kind);
}
