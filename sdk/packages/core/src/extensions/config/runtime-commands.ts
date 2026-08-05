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
	// Keep Unicode letters and numbers so configured names like "发布" stay
	// typeable tokens (and keep resolving as they did before normalization
	// existed); only whitespace and symbol runs collapse into hyphens.
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_.:@-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^-/, "")
		.replace(/-$/, "");
}

function stableRuntimeCommandSuffix(id: string): string {
	const slug = normalizeRuntimeCommandName(id)
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-/, "")
		.replace(/-$/, "");
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
	// Workflows are effectively deprecated in favor of skills, so a skill owns
	// its token outright and a workflow whose normalized name collides with it
	// is dropped rather than renamed — renaming would silently change command
	// tokens users already rely on. Same-kind collisions resolve to the
	// first entry in the deterministic (name, id) sort from
	// listCommandsForKind, so ownership is stable across discovery order.
	const byName = new Map<string, AvailableRuntimeCommand>();
	for (const command of [
		...listCommandsForKind(watcher, "skill"),
		...listCommandsForKind(watcher, "workflow"),
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
