/**
 * Tool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */

import type { Tool, ToolPolicy } from "@clinebot/shared";
import { ALL_DEFAULT_TOOL_NAMES } from "./constants.js";
import { createDefaultTools } from "./definitions.js";
import type { CreateDefaultToolsOptions, DefaultToolsConfig } from "./types.js";

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
	},
} as const satisfies Record<string, DefaultToolsConfig>;

/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;

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
	return createDefaultTools({
		...preset,
		...options,
	});
}
