/**
 * AgentTool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */

import type { AgentMode, AgentTool } from "@cline/shared";
import { createDefaultTools } from "./definitions";
import type { CreateDefaultToolsOptions, DefaultToolsConfig } from "./types";

export interface ToolPresetConfig extends DefaultToolsConfig {
	enableSpawnAgent?: boolean;
	enableAgentTeams?: boolean;
}

/**
 * Preset configurations for common use cases
 */
export const ToolPresets = {
	/**
	 * Act mode (full development tools)
	 * Good for coding assistants and task automation
	 */
	act: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: true,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Plan mode (read-only, no shell access)
	 * Good for analysis and documentation agents
	 */
	plan: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: true,
		enableAskQuestion: true,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Search-focused tools (read_files + search_codebase)
	 * Good for code exploration and analysis agents
	 */
	search: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: false,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: false,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Minimal tools for focused tasks
	 */
	minimal: {
		enableReadFiles: false,
		enableSearch: false,
		enableBash: true,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: false,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: false,
	},

} as const satisfies Record<string, ToolPresetConfig>;

/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;

export function resolveToolPresetName(options: {
	mode?: AgentMode;
}): ToolPresetName {
	if (options.mode === "plan") {
		return "plan";
	}
	return "act";
}

/**
 * Create default tools using a preset configuration
 *
 * @example
 * ```typescript
 * const tools = createDefaultToolsWithPreset("plan", {
 *   executors: {
 *     readFile: async ({ path }) => fs.readFile(path, "utf-8"),
 *     search: async (query, cwd) => searchFiles(query, cwd),
 *     webFetch: async (url, prompt) => fetchAndAnalyze(url, prompt),
 *   },
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export function createDefaultToolsWithPreset(
	presetName: ToolPresetName,
	options: Omit<CreateDefaultToolsOptions, keyof DefaultToolsConfig> &
		Partial<DefaultToolsConfig>,
): AgentTool[] {
	const preset = ToolPresets[presetName];
	const {
		enableSpawnAgent: _enableSpawnAgent,
		enableAgentTeams: _enableAgentTeams,
		...toolConfig
	} = preset;
	return createDefaultTools({
		...toolConfig,
		...options,
	});
}
