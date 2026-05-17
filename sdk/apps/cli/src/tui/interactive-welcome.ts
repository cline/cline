import {
	getFileIndex,
	type ProviderSettings,
	type UserInstructionConfigService,
} from "@cline/core";
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
	return Math.min(50, Math.max(1, Math.trunc(limit)));
}

function rankPath(path: string, query: string): number {
	if (query.length === 0) {
		return 3;
	}
	const lowerPath = path.toLowerCase();
	if (lowerPath.startsWith(query)) {
		return 0;
	}
	if (lowerPath.includes(`/${query}`)) {
		return 1;
	}
	if (lowerPath.includes(query)) {
		return 2;
	}
	return Number.POSITIVE_INFINITY;
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
	const query = input.query.trim().toLowerCase();
	const limit = normalizeLimit(input.limit);
	const index = await getFileIndex(workspaceRoot);
	const allPaths = Array.from(index).sort((a, b) => a.localeCompare(b));
	return allPaths
		.map((path) => ({ path, rank: rankPath(path, query) }))
		.filter((item) => Number.isFinite(item.rank))
		.sort((left, right) => {
			if (left.rank !== right.rank) {
				return left.rank - right.rank;
			}
			return left.path.localeCompare(right.path);
		})
		.slice(0, limit)
		.map((item) => item.path);
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
