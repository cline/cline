/**
 * Decide whether an empty captured stream should be treated as a shell-integration
 * capture failure (clipboard snapshot fallback) or as a legitimate silent success.
 *
 * Silent commands (e.g. `$null`, `git add -A` on a clean tree) complete with
 * OSC 633 C/D and produce no output. That is success, not a capture failure.
 *
 * A closed terminal is deliberately not special-cased here: the caller's failure
 * branch is where TERMINAL_CLOSED telemetry is recorded, and it already skips the
 * clipboard snapshot in that case, so suppressing the branch would silently drop
 * that signal.
 */
export function shouldFallbackToTerminalSnapshot(options: { capturedOutput: string; didSeeCommandExecuted: boolean }): boolean {
	if (options.capturedOutput.trim()) {
		return false
	}
	// OSC 633 C means the shell integration stream itself is working and reached
	// the command-executed marker, so an empty stream is real silence.
	//
	// onDidEndTerminalShellExecution deliberately does NOT count here. VS Code
	// fires it before its debounced data reaches the stream, so treating it as
	// proof of silence would drop the output of a fast command such as
	// `echo test` whose end event wins the race against the pending read.
	if (options.didSeeCommandExecuted) {
		return false
	}
	return true
}
