function normalizeShellName(shell: string): string {
	const normalizedPath = shell.replaceAll("\\", "/");
	const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
	const baseName =
		lastSeparatorIndex >= 0
			? normalizedPath.slice(lastSeparatorIndex + 1)
			: normalizedPath;
	return baseName.toLowerCase();
}

export function getDefaultShell(platform: string): string {
	return platform === "win32" ? "powershell" : "/bin/bash";
}

/**
 * Strip a redundant outer `powershell|pwsh [.exe] -Command|-c "…"` wrapper that
 * callers sometimes emit. Without this we'd spawn powershell with another
 * powershell invocation as its -Command argument, and the inner shell would
 * receive quote-shredded args.
 *
 * Deliberately conservative: only unwraps when the binary is immediately
 * followed by -Command/-c and the rest is exactly one quoted token whose body
 * does not contain the delimiter. Anything else (e.g. an intermediate
 * -NoProfile flag) is returned verbatim, so the worst case is "no change"
 * rather than an incorrect rewrite.
 */
export function unwrapPowerShell(command: string): string {
	const match = command.match(
		/^\s*(?:powershell|pwsh)(?:\.exe)?\s+-(?:Command|c)\s+(["'])((?:(?!\1).)*)\1\s*$/i,
	);
	return match ? match[2] : command;
}

export function getShellArgs(shell: string, command: string): string[] {
	const shellName = normalizeShellName(shell);

	if (
		shellName === "powershell" ||
		shellName === "powershell.exe" ||
		shellName === "pwsh" ||
		shellName === "pwsh.exe"
	) {
		return [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			unwrapPowerShell(command),
		];
	}

	if (shellName === "cmd" || shellName === "cmd.exe") {
		return ["/d", "/s", "/c", command];
	}

	return ["-c", command];
}
