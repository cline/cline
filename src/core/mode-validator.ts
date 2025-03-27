import { Mode, isToolAllowedForMode, ModeConfig } from "../shared/modes"
import { ToolName } from "../shared/tool-groups"

export { isToolAllowedForMode }
export type { ToolName }

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
