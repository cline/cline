import {
	ClineAccountService,
	getFileIndex,
	type LlmsProviders,
	listAvailableSkillsFromWatcher,
	listAvailableWorkflowsFromWatcher,
	type UserInstructionConfigWatcher,
} from "@clinebot/core/node";
import { formatCreditBalance, normalizeCreditBalance } from "../utils/output";
import type { Config } from "../utils/types";

export interface InteractiveSlashCommand {
	name: string;
	instructions: string;
	description?: string;
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
	watcher?: UserInstructionConfigWatcher,
): InteractiveSlashCommand[] {
	const builtins = [
		{
			name: "config",
			instructions: "",
			description: "Open interactive config browser",
		},
	];
	if (!watcher) {
		return builtins;
	}
	return [
		...builtins,
		...listAvailableSkillsFromWatcher(watcher).map((skill) => ({
			name: skill.name,
			instructions: skill.instructions,
		})),
		...listAvailableWorkflowsFromWatcher(watcher).map((workflow) => ({
			name: workflow.name,
			instructions: workflow.instructions,
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
	clineProviderSettings?: LlmsProviders.ProviderSettings;
}): Promise<string | undefined> {
	if (input.config.providerId !== "cline") {
		return undefined;
	}
	const persistedAccessToken =
		input.clineProviderSettings?.auth?.accessToken?.trim() || "";
	const configApiKey = input.config.apiKey.trim();
	let authToken = persistedAccessToken || configApiKey;
	if (authToken.toLowerCase().startsWith("workos:workos:")) {
		authToken = authToken.slice("workos:".length);
	}
	if (!authToken) {
		return undefined;
	}

	const service = new ClineAccountService({
		apiBaseUrl: input.clineApiBaseUrl?.trim() || "https://api.cline.bot",
		getAuthToken: async () => authToken,
	});
	try {
		const me = await service.fetchMe();
		const activeOrgName = me.organizations
			.find((org) => org.active)
			?.name?.trim();
		const activeOrganizationId = me.organizations.find(
			(org) => org.active,
		)?.organizationId;
		let rawBalance: number;
		if (activeOrganizationId?.trim()) {
			const orgBalance =
				await service.fetchOrganizationBalance(activeOrganizationId);
			rawBalance = orgBalance.balance;
		} else {
			const userBalance = await service.fetchBalance(me.id);
			rawBalance = userBalance.balance;
		}
		const normalizedBalance = normalizeCreditBalance(rawBalance);
		const parts = [
			me.email,
			`Credits: ${formatCreditBalance(normalizedBalance)}`,
		];
		if (activeOrgName) {
			parts.push(activeOrgName);
		}
		return parts.join(" | ");
	} catch {
		return undefined;
	}
}
