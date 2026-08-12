import type { SlashCommandRegistryEntry } from "../../commands/slash-command-registry";

export type SkillsPickerRow =
	| { kind: "header"; label: string }
	| { kind: "command"; command: SlashCommandRegistryEntry }
	| { kind: "marketplace" };

export function skillsPickerCommandMatchesFilter(
	command: SlashCommandRegistryEntry,
	filter: string,
): boolean {
	const query = filter.trim().toLowerCase();
	if (!query) return true;
	return (
		command.name.toLowerCase().includes(query) ||
		command.description.toLowerCase().includes(query) ||
		(command.folder?.toLowerCase().includes(query) ?? false)
	);
}

/**
 * Build the display rows for the skills picker: top-level skills first under
 * a "Skills" header, then one section per grouping folder (sorted by folder
 * path) so skills organized under folders stay visible and navigable.
 */
export function buildSkillsPickerRows(
	commands: SlashCommandRegistryEntry[],
	filter: string,
	options?: { includeMarketplace?: boolean },
): SkillsPickerRow[] {
	const filtered = commands.filter((command) =>
		skillsPickerCommandMatchesFilter(command, filter),
	);

	const topLevel: SlashCommandRegistryEntry[] = [];
	const byFolder = new Map<string, SlashCommandRegistryEntry[]>();
	for (const command of filtered) {
		const folder = command.folder?.trim();
		if (!folder) {
			topLevel.push(command);
			continue;
		}
		const group = byFolder.get(folder);
		if (group) {
			group.push(command);
		} else {
			byFolder.set(folder, [command]);
		}
	}

	const byName = (a: SlashCommandRegistryEntry, b: SlashCommandRegistryEntry) =>
		a.name.localeCompare(b.name);

	const rows: SkillsPickerRow[] = [];
	if (topLevel.length > 0 || filtered.length === 0) {
		rows.push({ kind: "header", label: "Skills" });
		for (const command of [...topLevel].sort(byName)) {
			rows.push({ kind: "command", command });
		}
	}
	for (const folder of [...byFolder.keys()].sort((a, b) =>
		a.localeCompare(b),
	)) {
		rows.push({ kind: "header", label: folder });
		for (const command of [...(byFolder.get(folder) ?? [])].sort(byName)) {
			rows.push({ kind: "command", command });
		}
	}
	if (options?.includeMarketplace) {
		rows.push({ kind: "marketplace" });
	}
	return rows;
}

/** Indexes of rows the selection can land on (commands and the marketplace link). */
export function selectableSkillsPickerRowIndexes(
	rows: SkillsPickerRow[],
): number[] {
	const indexes: number[] = [];
	for (const [index, row] of rows.entries()) {
		if (row.kind !== "header") {
			indexes.push(index);
		}
	}
	return indexes;
}
