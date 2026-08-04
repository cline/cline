import { truncateSplit } from "@cline/shared";
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

function normalizeRuntimeCommandName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeRuntimeCommandId(id: string): string {
	return normalizeRuntimeCommandName(id)
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
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
			name: normalizeRuntimeCommandName(record.item.name),
			instructions: record.item.instructions,
			description: resolveCommandDescription(record.item, kind),
			kind,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function listAvailableRuntimeCommandsFromWatcher(
	watcher: UserInstructionConfigWatcher,
): AvailableRuntimeCommand[] {
	const commands = [
		...listCommandsForKind(watcher, "workflow"),
		...listCommandsForKind(watcher, "skill"),
	];
	const countsByName = new Map<string, number>();
	const countsByNameAndKind = new Map<string, number>();
	for (const command of commands) {
		countsByName.set(command.name, (countsByName.get(command.name) ?? 0) + 1);
		const kindKey = `${command.name}:${command.kind}`;
		countsByNameAndKind.set(
			kindKey,
			(countsByNameAndKind.get(kindKey) ?? 0) + 1,
		);
	}
	const byName = new Map<string, AvailableRuntimeCommand>();
	for (const command of commands) {
		let name = command.name;
		if (countsByName.get(command.name) !== 1) {
			name = `${command.name}-${command.kind}`;
			if (countsByNameAndKind.get(`${command.name}:${command.kind}`) !== 1) {
				const id = normalizeRuntimeCommandId(command.id) || "command";
				name = `${name}-${id}`;
			}
		}
		const baseName = name;
		let suffix = 2;
		while (byName.has(name)) {
			name = `${baseName}-${suffix}`;
			suffix += 1;
		}
		byName.set(name, { ...command, name });
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
	const name = normalizeRuntimeCommandName(match[1]);
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
