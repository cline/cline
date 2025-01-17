import { Mode, isToolAllowedForMode, TestToolName, getModeConfig } from "../shared/modes"

export { isToolAllowedForMode }
export type { TestToolName }

export function validateToolUse(toolName: TestToolName, mode: Mode): void {
	if (!isToolAllowedForMode(toolName, mode)) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`)
	}
}
