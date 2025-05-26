import type { ToolName, ModeConfig } from "@roo-code/types"

import { Mode, isToolAllowedForMode } from "../../shared/modes"

export function validateToolUse(
	toolName: ToolName,
	mode: Mode,
	customModes?: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>,
): void {
	if (!isToolAllowedForMode(toolName, mode, customModes ?? [], toolRequirements, toolParams)) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`)
	}
}
