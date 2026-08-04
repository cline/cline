import { createHash } from "node:crypto";
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

export function normalizeRuntimeCommandName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9_.:@-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

function stableRuntimeCommandSuffix(id: string): string {
	const slug = normalizeRuntimeCommandName(id)
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	const hash = createHash("sha256").update(id).digest("hex").slice(0, 12);
	return `${slug || "command"}-${hash}`;
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
			name:
				normalizeRuntimeCommandName(record.item.name) ||
				`${kind}-${stableRuntimeCommandSuffix(id)}`,
			instructions: record.item.instructions,
			description: resolveCommandDescription(record.item, kind),
			kind,
		}))
		.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
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
	const candidates = commands.map((command) => {
		let name = command.name;
		if (countsByName.get(command.name) !== 1) {
			name = `${command.name}-${command.kind}`;
			if (countsByNameAndKind.get(`${command.name}:${command.kind}`) !== 1) {
				name = `${name}-${stableRuntimeCommandSuffix(command.id)}`;
			}
		}
		return { command, name };
	});
	const countsByCandidate = new Map<string, number>();
	for (const candidate of candidates) {
		countsByCandidate.set(
			candidate.name,
			(countsByCandidate.get(candidate.name) ?? 0) + 1,
		);
	}
	const byName = new Map<string, AvailableRuntimeCommand>();
	for (const candidate of candidates) {
		const { command } = candidate;
		const name =
			countsByCandidate.get(candidate.name) === 1
				? candidate.name
				: `${candidate.name}-${command.kind}-${stableRuntimeCommandSuffix(command.id)}`;
		if (byName.has(name)) {
			throw new Error(`Duplicate runtime slash command token '/${name}'.`);
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
	const rawName = match[1];
	const name = normalizeRuntimeCommandName(rawName);
	if (!name) {
		return input;
	}
	const commandLength = rawName.length + 1;
	const remainder = input.slice(commandLength);
	const matched = listAvailableRuntimeCommandsFromWatcher(watcher).find(
		(command) => command.name === name,
	);
	return matched ? `${matched.instructions}${remainder}` : input;
}
