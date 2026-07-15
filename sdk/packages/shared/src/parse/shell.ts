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

export function getShellArgs(shell: string, command: string): string[] {
	const shellName = normalizeShellName(shell);

	if (
		shellName === "powershell" ||
		shellName === "powershell.exe" ||
		shellName === "pwsh" ||
		shellName === "pwsh.exe"
	) {
		return ["-NoProfile", "-NonInteractive", "-Command", command];
	}

	if (shellName === "cmd" || shellName === "cmd.exe") {
		return ["/d", "/s", "/c", command];
	}

	// wsl.exe is the Windows launcher for the default WSL distro, not a shell
	// itself. Run the command through the guest's bash so operators like `|`
	// and `;` are handled by bash rather than treated as wsl.exe arguments.
	// wsl.exe translates the Windows cwd to its /mnt mount automatically.
	if (shellName === "wsl" || shellName === "wsl.exe") {
		return ["bash", "-c", command];
	}

	return ["-c", command];
}
