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

export interface ShellInvocation {
	args: string[];
	input?: string;
}

export function getShellInvocation(
	shell: string,
	command: string,
): ShellInvocation {
	switch (getShellKind(shell)) {
		case "powershell":
			// PowerShell's command-line parser decodes -Command through the active
			// Windows code page. Keep the command line ASCII-only, send the command
			// through UTF-8 stdin, and make redirected output UTF-8. Stdin also avoids
			// reducing Windows' process command-line limit with base64 expansion.
			//
			// The script runs with $ErrorActionPreference='Stop' so pipelines fail
			// fast on the first error. Under the default 'Continue', a pipeline that
			// errors per item (e.g. a bad Where-Object over Get-ChildItem -Recurse)
			// emits one error record per file — flooding stderr for minutes on large
			// trees — and can still exit 0. The preference is set in the bootstrap
			// scope, not prepended to the script text: preference variables are
			// dynamically scoped, so the scriptblock invoked below inherits it, while
			// the user's script stays byte-identical — error line/column positions
			// are untouched and a script that begins with param(...) keeps param in
			// the mandatory first-statement position.
			//
			// Fail-fast is a deliberate tradeoff: Stop promotes every
			// non-terminating error, so a command that used to succeed with partial
			// results (e.g. Get-ChildItem -Recurse crossing an access-denied
			// junction) now stops at its first error, and on Windows PowerShell 5.1
			// a native command that redirects stderr inside the script (2>&1,
			// 2>file) terminates on its first stderr line even when it would exit 0
			// — 5.1 wraps redirected native stderr in error records that Stop makes
			// fatal, while PowerShell 7.2+ exempts native stderr from the
			// preference. GitHub Actions prepends the same preamble to its
			// powershell/pwsh steps, so model-authored commands tend to already
			// tolerate these semantics. A command can still opt out per-cmdlet with
			// -ErrorAction or by reassigning $ErrorActionPreference.
			return {
				args: [
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"[Console]::InputEncoding=[Text.UTF8Encoding]::new();" +
						"[Console]::OutputEncoding=[Text.UTF8Encoding]::new();" +
						"$ErrorActionPreference='Stop';" +
						"$c=[Console]::In.ReadToEnd();" +
						"$c+=[Environment]::NewLine+'if(-not $?){exit 1}';" +
						"& ([ScriptBlock]::Create($c))",
				],
				input: command,
			};
		case "cmd":
			return { args: ["/d", "/s", "/c", command] };
		// wsl.exe is the Windows launcher for the default WSL distro, not a shell
		// itself. Run the command through the guest's bash so operators like `|`
		// and `;` are handled by bash rather than treated as wsl.exe arguments.
		// wsl.exe translates the Windows cwd to its /mnt mount automatically.
		case "wsl":
			return { args: ["bash", "-c", command] };
		case "posix":
			return { args: ["-c", command] };
	}
}

/**
 * @deprecated Use getShellInvocation() when executing commands so PowerShell
 * source can travel through Unicode-safe stdin.
 */
export function getShellArgs(shell: string, command: string): string[] {
	if (getShellKind(shell) === "powershell") {
		// Preserve the public helper's self-contained argument contract. Callers
		// that can write stdin should use getShellInvocation() for Unicode and
		// commands beyond Windows' process command-line limit.
		return ["-NoProfile", "-NonInteractive", "-Command", command];
	}
	return getShellInvocation(shell, command).args;
}
