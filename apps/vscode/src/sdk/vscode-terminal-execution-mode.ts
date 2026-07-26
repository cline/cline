/**
 * VS Code terminal execution mode stored in extension global state.
 */
export type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

export function getEffectiveTerminalExecutionMode(requested: VscodeTerminalExecutionMode): VscodeTerminalExecutionMode {
	return requested
}
