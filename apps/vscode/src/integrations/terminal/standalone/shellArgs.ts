/**
 * Shell argument construction for the standalone terminal.
 *
 * Extracted into a pure module so the quoting/flag logic is unit-testable
 * without spawning a process. Mirrors the shape of the canonical helper in
 * `@cline/shared` (sdk/packages/shared/src/parse/shell.ts); see the follow-up
 * note in the #10948 investigation about consolidating onto it.
 */

/**
 * Strip a redundant outer `powershell|pwsh [.exe] -Command|-c "…"` wrapper that
 * LLMs sometimes emit. Without this we'd spawn powershell.exe with another
 * powershell.exe as its -Command argument and the inner shell would receive
 * quote-shredded args (issue #10948).
 *
 * Only unwraps when the entire string is exactly one quoted token whose body
 * does not itself contain the delimiter; anything else is returned verbatim so
 * the worst case is "no change" rather than an incorrect rewrite.
 */
export function unwrapPowerShell(command: string): string {
	const match = command.match(/^\s*(?:powershell|pwsh)(?:\.exe)?\s+-(?:Command|c)\s+(["'])((?:(?!\1).)*)\1\s*$/i)
	return match ? match[2] : command
}

/**
 * Build the argument vector for invoking `command` through `shell`.
 *
 * The shell family is decided from the shell name. `platform` is injected
 * (defaulting to the host) only so the win32-vs-posix branch is testable; it
 * does not otherwise change behavior.
 */
export function getShellArgs(shell: string, command: string, platform: NodeJS.Platform = process.platform): string[] {
	if (platform === "win32") {
		if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh")) {
			// -NoProfile silences user $PROFILE side effects that otherwise
			// leak into the captured output; -NonInteractive avoids prompts.
			return ["-NoProfile", "-NonInteractive", "-Command", unwrapPowerShell(command)]
		}
		return ["/d", "/s", "/c", command]
	}
	return ["-c", command]
}
