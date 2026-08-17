/**
 * Decide whether an empty captured stream should be treated as a shell-integration
 * capture failure (clipboard snapshot fallback) or as a legitimate silent success.
 *
 * Silent commands (e.g. `$null`, `git add -A` on a clean tree) complete with
 * OSC 633 C/D and/or onDidEndTerminalShellExecution exit 0 but produce no
 * output. That is success, not a capture failure.
 */
export function shouldFallbackToTerminalSnapshot(options: {
	capturedOutput: string
	didSeeCommandExecuted: boolean
	executionEndObserved: boolean
	terminalClosed: boolean
}): boolean {
	if (options.capturedOutput.trim()) {
		return false
	}
	if (options.terminalClosed) {
		return false
	}
	// Empty output after an observed completion is a silent success.
	if (options.didSeeCommandExecuted || options.executionEndObserved) {
		return false
	}
	return true
}
