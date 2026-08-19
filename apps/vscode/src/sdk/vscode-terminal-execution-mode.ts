/**
 * Shared type and host-capability guard for the VS Code terminal execution mode
 * setting (`vscodeTerminalExecutionMode` global state).
 *
 * `vscodeTerminal` mode requires a real VS Code terminal (`vscode.window.createTerminal`
 * with shell integration). It is meaningless — and silently a no-op — on the
 * standalone (JetBrains/CLI) build, where `vscode.window.createTerminal` is a stub
 * (see standalone/runtime-files/vscode/vscode-impls.js).
 *
 * The setting lives in shared file-backed global state (see storage.md), which is
 * readable by any client pointed at the same `~/.cline` data directory. A value of
 * `vscodeTerminal` saved while running in the real VS Code extension therefore can
 * leak into a standalone session reading that same store. Clamp to `backgroundExec`
 * whenever this is not the real VS Code extension host, rather than trusting the
 * saved value.
 */
export type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

/**
 * True when running as the standalone (JetBrains/CLI) build. Statically rewritten
 * by esbuild to the literal string "true"/"false" (see esbuild.mjs); compare with
 * strict string equality since the string "false" is truthy in JS.
 */
function isStandaloneHost(): boolean {
	return process.env.IS_STANDALONE === "true"
}

/**
 * Clamps a requested terminal execution mode to `backgroundExec` when the current
 * host cannot support real VS Code terminals (i.e. the standalone build).
 */
export function getEffectiveTerminalExecutionMode(requested: VscodeTerminalExecutionMode): VscodeTerminalExecutionMode {
	if (requested === "vscodeTerminal" && isStandaloneHost()) {
		return "backgroundExec"
	}
	return requested
}
