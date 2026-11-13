import type { FactoryWorkflowConfig } from "@cline/shared/browser";
import type {
	FactoryConnections,
	FactoryProviderCatalog,
} from "@/lib/factory-settings-client";
import { FS_CONNECTIONS } from "@/lib/factory-settings-copy/connections";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import type { ConnectionsState } from "./use-connections";

const C = FS_CONNECTIONS;

export type GhState =
	| "connected"
	| "not_installed"
	| "not_signed_in"
	| "unknown";

/** gh's state from the probe: a timed-out probe is "unknown", not a failure. */
export function ghState(gh: FactoryConnections["gh"]): GhState {
	if (gh.error) return "unknown";
	if (!gh.installed) return "not_installed";
	return gh.hosts.some((host) => host.signedIn) ? "connected" : "not_signed_in";
}

export type ProviderUse = {
	/** Provider id; `undefined` for roles that use the chat's model, which is unknown. */
	id: string | undefined;
	name: string;
	roles: string[];
	/** `undefined` while the catalog is unread or the provider is unknown. */
	connected: boolean | undefined;
};

/** The provider the chat remembers, which roles without a model use. */
function chatProvider(): string | undefined {
	try {
		return readModelSelectionStorageFromWindow().lastProvider || undefined;
	} catch {
		return undefined;
	}
}

/**
 * The providers the default workflow's roles (and the manager) use, in
 * pipeline order, each with its roles and whether it is connected. A role
 * without its own model runs on the model of the session that made the card,
 * which is the chat's: the same as the manager.
 */
export function providerUses(
	config: FactoryWorkflowConfig,
	catalog: FactoryProviderCatalog | undefined,
	chat = chatProvider(),
): ProviderUse[] {
	const agents = config.agents;
	const numbered = (label: string, count: number, index: number) =>
		count > 1 ? `${label} ${index + 1}` : label;
	const roles: { label: string; provider?: string }[] = [
		{
			label: C.roles.designer,
			provider: agents?.designer?.modelSelection?.providerId,
		},
		...(agents?.planReviewers ?? []).map((agent, index, all) => ({
			label: numbered(C.roles.planReviewer, all.length, index),
			provider: agent.modelSelection?.providerId,
		})),
		...(agents?.implementers ?? []).map((agent, index, all) => ({
			label: numbered(C.roles.builder, all.length, index),
			provider: agent.modelSelection?.providerId,
		})),
		...(agents?.verifier
			? [
					{
						label: C.roles.tester,
						provider: agents.verifier.modelSelection?.providerId,
					},
				]
			: []),
		...(agents?.reviewers ?? []).map((agent, index, all) => ({
			label: numbered(C.roles.reviewer, all.length, index),
			provider: agent.modelSelection?.providerId,
		})),
		{ label: C.roles.manager },
	];
	const uses = new Map<string, ProviderUse>();
	for (const role of roles) {
		const id = role.provider ?? chat;
		const key = id ?? "";
		let use = uses.get(key);
		if (!use) {
			const entry = id
				? catalog?.providers?.find((provider) => provider.id === id)
				: undefined;
			use = {
				id,
				name: id ? (entry?.name ?? id) : C.appModel,
				roles: [],
				connected:
					id && catalog
						? Boolean(entry?.configured ?? entry?.enabled ?? false)
						: undefined,
			};
			uses.set(key, use);
		}
		use.roles.push(role.label);
	}
	return [...uses.values()];
}

/**
 * What will stop work: gh unable to open PRs, and each provider a role needs
 * that is not connected. Linear and MCP are optional, so they never count.
 */
export function blockingCount(
	state: Pick<ConnectionsState, "connections" | "providers">,
	config: FactoryWorkflowConfig,
): number {
	const gh = state.connections.data?.gh;
	const ghBlocks =
		gh && (ghState(gh) === "not_installed" || ghState(gh) === "not_signed_in")
			? 1
			: 0;
	const providers =
		state.providers.status === "ready"
			? providerUses(config, state.providers.data).filter(
					(use) => use.connected === false,
				).length
			: 0;
	return ghBlocks + providers;
}
