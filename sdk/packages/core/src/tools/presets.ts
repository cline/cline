/**
 * Tool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */

import type { Tool, ToolPolicy } from "@clinebot/shared";
import { ALL_DEFAULT_TOOL_NAMES } from "./constants";
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
	 * Browser-based tools (no shell access, no web fetch)
	 */
	browser: {
		enableReadFiles: false,
		enableSearch: false,
		enableBash: false,
		enableWebFetch: false,
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
	 * Full development tools (all tools enabled) - Act mode
	 * Good for coding assistants and task automation
	 */
	development: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: true,
		enableSubmitAndExit: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Read-only tools (no shell access) - Plan mode
	 * Good for analysis and documentation agents
	 */
	readonly: {
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
	 * Minimal tools (file reading only)
	 * Good for focused single-file tasks
	 */
	minimal: {
		enableReadFiles: false,
		enableSearch: false,
		enableBash: false,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: true,
		enableSubmitAndExit: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	},

	/**
	 * YOLO mode (automation-focused tools + no approval required)
	 * Good for trusted local automation workflows.
	 */
	yolo: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: false,
		enableSubmitAndExit: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	},
} as const satisfies Record<string, ToolPresetConfig>;

/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;

export function resolveToolPresetName(options: {
	mode?: "act" | "plan" | "yolo";
}): ToolPresetName {
	if (options.mode === "plan") {
		return "readonly";
	}
	return options.mode === "yolo" ? "yolo" : "development";
}

/**
 * Tool policy preset names
 */
export type ToolPolicyPresetName = "default" | "yolo";

/**
 * Build tool policies for a preset.
 * `yolo` guarantees tool policies are enabled and auto-approved.
 */
export function createToolPoliciesWithPreset(
	presetName: ToolPolicyPresetName,
): Record<string, ToolPolicy> {
	if (presetName !== "yolo") {
		return {};
	}

	const yoloPolicy: ToolPolicy = {
		enabled: true,
		autoApprove: true,
	};

	const policies: Record<string, ToolPolicy> = {
		"*": yoloPolicy,
	};

	for (const toolName of ALL_DEFAULT_TOOL_NAMES) {
		policies[toolName] = yoloPolicy;
	}

	return policies;
}

/**
 * Create default tools using a preset configuration
 *
 * @example
 * ```typescript
 * const tools = createDefaultToolsWithPreset("readonly", {
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
): Tool[] {
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
