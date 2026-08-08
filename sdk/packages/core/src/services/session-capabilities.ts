import {
	resolveToolPresetName,
	ToolPresets,
} from "../extensions/tools/presets";
import type { CoreSessionConfig } from "../types/config";
import { resolveEnabledToolNames } from "./global-settings";

/**
 * Effective availability of the generic spawn_agent tool for a session.
 * spawn_agent is opt-in: with no explicit session value it stays off unless
 * the user enabled it via the `enabledTools` global setting (and the mode
 * preset allows it). An explicit session value always wins.
 */
export function resolveSpawnAgentEnabled(
	config: Pick<CoreSessionConfig, "mode" | "enableSpawnAgent">,
): boolean {
	if (typeof config.enableSpawnAgent === "boolean") {
		return config.enableSpawnAgent;
	}
	const preset = ToolPresets[resolveToolPresetName({ mode: config.mode })];
	return (
		(preset.enableSpawnAgent ?? true) &&
		resolveEnabledToolNames().has("spawn_agent")
	);
}

/**
 * Effective availability of the agent teams runtime for a session. Teams are
 * opt-in: with no explicit session value they stay off unless the user
 * enabled the `teams` tool via the `enabledTools` global setting (and the
 * mode preset allows it). An explicit session value always wins, e.g. the
 * CLI /team command enables teams for its session.
 */
export function resolveAgentTeamsEnabled(
	config: Pick<CoreSessionConfig, "mode" | "enableAgentTeams">,
): boolean {
	if (typeof config.enableAgentTeams === "boolean") {
		return config.enableAgentTeams;
	}
	const preset = ToolPresets[resolveToolPresetName({ mode: config.mode })];
	return (
		(preset.enableAgentTeams ?? true) && resolveEnabledToolNames().has("teams")
	);
}
