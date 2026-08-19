/**
 * Session plugin bindings (Gateway RFC, Phase 4).
 *
 * Sessions never see the raw catalog. They receive a policy-filtered view
 * bound to lightweight context — bot, workspace, principal, session,
 * storage, and permission context. Mutable plugin state is session-scoped
 * (it lives in the binding and dies with it) unless the plugin explicitly
 * uses the durable Gateway storage port, which is namespaced per plugin
 * and per scope so no binding can read another's values.
 */

import type { BotId, PrincipalId, SessionId } from "@cline/shared/gateway";
import type { CatalogEntry, CatalogGenerationSnapshot } from "./catalog";
import { pluginScopeKey } from "./catalog";
import type { LoadedMcpServer, LoadedSkill } from "./loader";
import type { AgentPluginManifest } from "./manifest";
import type { PluginStateStore, PluginStateStorePort } from "./state-store";

/** Permission/policy filter applied when a session view is created. */
export interface PluginViewPolicy {
	allowPlugin?(entry: CatalogEntry): boolean;
	allowSkill?(entry: CatalogEntry, skill: LoadedSkill): boolean;
	allowMcpServer?(entry: CatalogEntry, server: LoadedMcpServer): boolean;
}

export interface SessionPluginContext {
	readonly botId: BotId;
	readonly sessionId: SessionId;
	readonly principalId?: PrincipalId;
	/** The session's immutable workspace root (for workspace plugins). */
	readonly workspaceRoot?: string;
	readonly policy?: PluginViewPolicy;
	/** Durable storage authority; omitted views get no durable storage. */
	readonly stateStore?: PluginStateStore;
	readonly clock?: () => number;
}

export interface BoundPlugin {
	readonly name: string;
	readonly scopeKey: string;
	readonly manifest: AgentPluginManifest;
	readonly skills: readonly LoadedSkill[];
	readonly mcpServers: readonly LoadedMcpServer[];
	/**
	 * Session-scoped mutable state: private to this binding, never shared
	 * with other sessions and dropped when the binding is dropped.
	 */
	readonly sessionState: Map<string, unknown>;
	/** Durable state through the Gateway storage port (namespaced). */
	readonly storage?: PluginStateStorePort;
}

export interface SessionPluginView {
	readonly generation: number;
	readonly botId: BotId;
	readonly sessionId: SessionId;
	readonly principalId?: PrincipalId;
	readonly plugins: readonly BoundPlugin[];
}

function visibleTo(
	entry: CatalogEntry,
	context: SessionPluginContext,
): boolean {
	switch (entry.scope.kind) {
		case "global":
			return true;
		case "bot":
			return entry.scope.botId === context.botId;
		case "workspace":
			return (
				context.workspaceRoot !== undefined &&
				entry.scope.workspaceRoot === context.workspaceRoot
			);
	}
}

/**
 * Create one session's policy-filtered plugin view over a pinned catalog
 * generation. Cheap: it references the frozen catalog entries and adds
 * only the per-session state containers.
 */
export function createSessionPluginView(
	snapshot: CatalogGenerationSnapshot,
	context: SessionPluginContext,
): SessionPluginView {
	const policy = context.policy ?? {};
	const plugins: BoundPlugin[] = [];
	for (const entry of snapshot.entries) {
		if (!visibleTo(entry, context)) {
			continue;
		}
		if (policy.allowPlugin && !policy.allowPlugin(entry)) {
			continue;
		}
		const skills = policy.allowSkill
			? entry.plugin.skills.filter((skill) => policy.allowSkill?.(entry, skill))
			: entry.plugin.skills;
		const mcpServers = policy.allowMcpServer
			? entry.plugin.mcpServers.filter((server) =>
					policy.allowMcpServer?.(entry, server),
				)
			: entry.plugin.mcpServers;
		const scopeKey = pluginScopeKey(entry.scope);
		plugins.push({
			name: entry.plugin.manifest.name,
			scopeKey,
			manifest: entry.plugin.manifest,
			skills,
			mcpServers,
			sessionState: new Map(),
			...(context.stateStore
				? {
						storage: context.stateStore.portFor(
							entry.plugin.manifest.name,
							scopeKey,
							context.clock,
						),
					}
				: {}),
		});
	}
	return {
		generation: snapshot.generation,
		botId: context.botId,
		sessionId: context.sessionId,
		...(context.principalId ? { principalId: context.principalId } : {}),
		plugins,
	};
}
