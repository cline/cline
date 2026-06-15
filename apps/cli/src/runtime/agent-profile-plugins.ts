import {
	discoverPluginModulePaths,
	resolveAlwaysEnabledPluginPaths,
	resolvePluginConfigSearchPaths,
} from "@cline/core";
import { getPluginDisplayName } from "@cline/shared/storage";
import type { ActiveAgentProfile } from "../utils/types";

/**
 * Computes the session-scoped plugin disable list for an agent profile's
 * plugins restriction: every installed plugin whose display name is not in
 * the profile's list and is not marked always-enabled in global settings.
 * Returns undefined when the profile has no plugins field (no restriction).
 * Names listed in the profile that match no installed plugin are silently
 * ignored. Recomputed on every session (re)start so plugin installs and
 * always-enabled toggles apply on the next restart.
 */
export function resolveAgentProfileDisabledPluginPaths(
	profile: Pick<ActiveAgentProfile, "plugins"> | undefined,
	workspaceRoot: string | undefined,
): string[] | undefined {
	const pluginNames = profile?.plugins;
	if (!pluginNames) {
		return undefined;
	}
	const allowedNames = new Set(
		pluginNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
	);
	const alwaysEnabled = resolveAlwaysEnabledPluginPaths();
	const disabled = new Set<string>();
	for (const directory of resolvePluginConfigSearchPaths(workspaceRoot)) {
		let pluginPaths: string[];
		try {
			pluginPaths = discoverPluginModulePaths(directory);
		} catch {
			continue;
		}
		for (const pluginPath of pluginPaths) {
			if (alwaysEnabled.has(pluginPath)) {
				continue;
			}
			let displayName: string;
			try {
				displayName = getPluginDisplayName(pluginPath);
			} catch {
				// Unresolvable name cannot match the allowlist; disable it.
				disabled.add(pluginPath);
				continue;
			}
			if (allowedNames.has(displayName.toLowerCase())) {
				continue;
			}
			disabled.add(pluginPath);
		}
	}
	return [...disabled];
}
