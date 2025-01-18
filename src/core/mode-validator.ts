import { Mode, isToolAllowedForMode, getModeConfig, ModeConfig } from "../shared/modes"
import { ToolName } from "../shared/tool-groups"

export { isToolAllowedForMode }
export type { ToolName }

export function validateToolUse(toolName: ToolName, mode: Mode, customModes?: ModeConfig[]): void {
	if (!isToolAllowedForMode(toolName, mode, customModes ?? [])) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`)
	}
}
