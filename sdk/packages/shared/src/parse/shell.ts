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
 * Shell families that differ in invocation flags and command syntax.
 * "wsl" is the wsl.exe launcher (which runs bash in the default distro);
 * "posix" covers bash/zsh/sh and other `-c`-style shells.
 */
export type ShellKind = "powershell" | "cmd" | "wsl" | "posix";

/**
 * Classify a shell executable (name or full path) into its family.
 *
 * This is the single classification used both for building spawn arguments
 * (getShellArgs) and for shell-specific prompting, so the syntax the model is
 * told to use always matches the syntax the executor actually accepts.
 */
export function getShellKind(shell: string): ShellKind {
	const shellName = normalizeShellName(shell);

	if (
		shellName === "powershell" ||
		shellName === "powershell.exe" ||
		shellName === "pwsh" ||
		shellName === "pwsh.exe"
	) {
		return "powershell";
	}

	if (shellName === "cmd" || shellName === "cmd.exe") {
		return "cmd";
	}

	if (shellName === "wsl" || shellName === "wsl.exe") {
		return "wsl";
	}

	return "posix";
}

/**
 * Human/model-facing name for a shell executable, used when prompting about
 * shell changes. PowerShell variants and cmd get their family name (their
 * syntax is what matters, not the install path); POSIX shells keep their
 * base name (bash, zsh, fish, ...) since syntax differs between them.
 */
export function getShellDisplayName(shell: string): string {
	switch (getShellKind(shell)) {
		case "powershell":
			return "PowerShell";
		case "cmd":
			return "cmd.exe";
		case "wsl":
			return "bash (WSL)";
		case "posix": {
			const baseName = normalizeShellName(shell);
			return baseName.endsWith(".exe") ? baseName.slice(0, -4) : baseName;
		}
	}
}

export function getShellArgs(shell: string, command: string): string[] {
	switch (getShellKind(shell)) {
		case "powershell":
			return ["-NoProfile", "-NonInteractive", "-Command", command];
		case "cmd":
			return ["/d", "/s", "/c", command];
		// wsl.exe is the Windows launcher for the default WSL distro, not a shell
		// itself. Run the command through the guest's bash so operators like `|`
		// and `;` are handled by bash rather than treated as wsl.exe arguments.
		// wsl.exe translates the Windows cwd to its /mnt mount automatically.
		case "wsl":
			return ["bash", "-c", command];
		case "posix":
			return ["-c", command];
	}
}
