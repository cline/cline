/**
 * Heuristics for detecting a shell prompt at the end of terminal output.
 *
 * Used to decide that a command has probably finished when shell integration
 * markers are unavailable — e.g. the user ssh'd from the terminal, so commands
 * execute in a remote shell that emits no OSC 633 sequences. Ported from
 * VS Code's `detectsCommonPromptPattern` (src/vs/workbench/contrib/
 * terminalContrib/chatAgentTools/browser/executeStrategy/executeStrategy.ts),
 * which backs the basic/none execute strategies of its own run-in-terminal
 * tool.
 */

/**
 * Returns the last line of output. Trailing newlines are ignored (the prompt
 * is the cursor line), and carriage returns within the line are treated as
 * overwrites so only the final visible content is returned.
 */
export function getLastLine(output: string): string {
	const trimmed = output.replace(/[\r\n]+$/, "")
	const afterLastLf = trimmed.slice(trimmed.lastIndexOf("\n") + 1)
	return afterLastLf.slice(afterLastLf.lastIndexOf("\r") + 1)
}

/**
 * Whether a line looks like a shell prompt awaiting input.
 *
 * This is intentionally loose: a false positive merely returns the buffered
 * output a little early, which is far better than blocking on a stream that
 * will never end.
 */
export function looksLikeShellPrompt(lastLine: string): boolean {
	const line = lastLine.trimEnd()
	if (!line) {
		return false
	}
	// PowerShell: "PS C:\path>"
	if (/PS\s+[A-Z]:\\.*>$/.test(line)) {
		return true
	}
	// Command Prompt: "C:\path>"
	if (/^[A-Z]:\\.*>$/.test(line)) {
		return true
	}
	// bash "$", root "#", zsh "%", fish/generic ">", Python REPL ">>>", and
	// starship "❯" all end in one of these characters.
	return /[$#%>\u276f]$/.test(line)
}
