function normalizeShellName(shell: string): string {
	const normalizedPath = shell.replaceAll("\\", "/");
	const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
	const baseName =
		lastSeparatorIndex >= 0
			? normalizedPath.slice(lastSeparatorIndex + 1)
			: normalizedPath;
	return baseName.toLowerCase();
}

export function windowsCodePageToEncoding(codePage: number): string {
	switch (codePage) {
		case 437:
			return "cp437";
		case 850:
			return "cp850";
		case 866:
			return "cp866";
		case 932:
			return "shift_jis";
		case 936:
			return "gbk";
		case 949:
			return "cp949";
		case 950:
			return "big5";
		case 1252:
			return "windows1252";
		case 65001:
			return "utf8";
		default:
			return "utf8";
	}
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

export function getShellOutputEncoding(
	shell: string,
	platform: string,
	resolveCodePage: () => number,
): string {
	if (platform !== "win32") return "utf8";

	const shellName = normalizeShellName(shell);
	if (
		getShellKind(shell) !== "cmd" &&
		shellName !== "powershell" &&
		shellName !== "powershell.exe"
	) {
		return "utf8";
	}
	if (shellName === "pwsh" || shellName === "pwsh.exe") return "utf8";

	try {
		return windowsCodePageToEncoding(resolveCodePage());
	} catch {
		return "utf8";
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
