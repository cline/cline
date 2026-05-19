import {
	getFileIndex,
	type ProviderSettings,
	type UserInstructionConfigService,
} from "@cline/core";
import { byLengthAsc, Fzf, type FzfResultItem } from "fzf";
import type { Config } from "../utils/types";
import { formatClineCredits, loadClineAccountSnapshot } from "./cline-account";

export interface InteractiveSlashCommand {
	name: string;
	instructions: string;
	description?: string;
	kind?: "skill" | "workflow";
}

function normalizeLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || Number.isNaN(limit)) {
		return 10;
	}
	return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function getPathLabel(filePath: string): string {
	const parts = filePath.split("/");
	return parts[parts.length - 1] ?? filePath;
}

function normalizeMentionQuery(query: string): string {
	const trimmed = query.trim().replace(/^["']/, "");
	if (trimmed.startsWith("./")) {
		return trimmed.slice(2);
	}
	if (trimmed.startsWith("/")) {
		return trimmed.slice(1);
	}
	return trimmed;
}

function compactSearchText(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface MentionPathItem {
	path: string;
	label: string;
	searchText: string;
}

function countGaps(positions: Iterable<number>): number {
	let gaps = 0;
	let previous = Number.NEGATIVE_INFINITY;
	for (const position of positions) {
		if (previous !== Number.NEGATIVE_INFINITY && position - previous > 1) {
			gaps++;
		}
		previous = position;
	}
	return gaps;
}

function orderByMatchScore(
	left: FzfResultItem<MentionPathItem>,
	right: FzfResultItem<MentionPathItem>,
): number {
	return countGaps(left.positions) - countGaps(right.positions);
}

export function rankMentionPaths(
	paths: Iterable<string>,
	query: string,
	limit: number,
): string[] {
	const items = Array.from(paths, (path): MentionPathItem => {
		const label = getPathLabel(path);
		return {
			path,
			label,
			searchText: [
				label,
				label,
				path,
				compactSearchText(label),
				compactSearchText(path),
			].join(" "),
		};
	});

	const normalizedQuery = normalizeMentionQuery(query);
	if (!normalizedQuery) {
		return items
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, limit)
			.map((item) => item.path);
	}

	const fzf = new Fzf(items, {
		selector: (item) => item.searchText,
		tiebreakers: [orderByMatchScore, byLengthAsc],
		limit,
	});

	const rawResults = fzf.find(normalizedQuery);
	const results =
		rawResults.length > 0
			? rawResults
			: fzf.find(compactSearchText(normalizedQuery));
	return results.map((result) => result.item.path);
}

export function listInteractiveSlashCommands(
	userInstructionService?: UserInstructionConfigService,
): InteractiveSlashCommand[] {
	const builtins = [
		{
			name: "config",
			instructions: "",
			description: "Open interactive config browser",
		},
		{
			name: "settings",
			instructions: "",
			description: "Modify agent configuration",
		},
		{
			name: "mcp",
			instructions: "",
			description: "Manage MCP servers",
		},
		{
			name: "fork",
			instructions: "/fork",
			description: "Create a named fork of the current session",
		},
		{
			name: "team",
			instructions: "/team [prompt]",
			description: "Start the task with agent team",
		},
	];
	if (!userInstructionService) {
		return builtins;
	}
	return [
		...builtins,
		...userInstructionService.listRuntimeCommands().map((command) => ({
			name: command.name,
			instructions: command.instructions,
			description: command.description,
			kind: command.kind,
		})),
	];
}

export async function searchWorkspaceFilesForMention(input: {
	workspaceRoot: string;
	query: string;
	limit?: number;
}): Promise<string[]> {
	const workspaceRoot = input.workspaceRoot.trim();
	if (!workspaceRoot) {
		return [];
	}
	const limit = normalizeLimit(input.limit);
	const index = await getFileIndex(workspaceRoot);
	return rankMentionPaths(index, input.query, limit);
}

export async function resolveClineWelcomeLine(input: {
	config: Config;
	clineApiBaseUrl?: string;
	clineProviderSettings?: ProviderSettings;
}): Promise<string | undefined> {
	if (input.config.providerId !== "cline") {
		return undefined;
	}
	try {
		const snapshot = await loadClineAccountSnapshot(input);
		const parts = [
			snapshot.user.email,
			`Credits: ${formatClineCredits(snapshot.displayedBalance)}`,
		];
		if (snapshot.activeOrganization?.name.trim()) {
			parts.push(snapshot.activeOrganization.name);
		}
		return parts.join(" | ");
	} catch {
		return undefined;
	}
}
