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

/**
 * PowerShell flags that are safe to drop when unwrapping a nested
 * -Command invocation: the outer bootstrap already runs with all three.
 */
const NESTED_POWERSHELL_UNWRAPPABLE_FLAGS = new Set([
	"-nologo",
	"-noninteractive",
	"-noprofile",
]);

/**
 * The one flag the nested invocation must carry for unwrapping to be
 * semantics-preserving: the outer bootstrap starts without profiles, so a
 * nested shell that would load the user's profile (functions, aliases,
 * modules) must keep its own process to reproduce that initialization.
 */
const NESTED_POWERSHELL_REQUIRED_FLAG = "-noprofile";

/**
 * Decode the body of a PowerShell double-quoted string to the literal text a
 * nested `powershell -Command "…"` would have received: backtick escapes
 * (`` `n ``, `` `t ``, `` `" ``, `` `$ ``, …) resolve to their characters and
 * `""` to a quote. `$`-expressions stay literal — the model wrote them for the
 * inner shell's parser, and the outer parser binds them identically once the
 * text runs as a script. `` `u{…} `` code-point and `` `e `` ESC escapes
 * exist only in PowerShell 7+, so the edition of the shell that will run the
 * decoded script decides how (or whether) they decode.
 */
function decodePowerShellDoubleQuotedString(
	body: string,
	edition: "windows" | "core",
): string {
	let decoded = "";
	for (let i = 0; i < body.length; i++) {
		const character = body[i];
		if (character === "`" && i + 1 < body.length) {
			const escaped = body[i + 1];
			if (escaped === "u" && edition === "core" && body[i + 2] === "{") {
				const closing = body.indexOf("}", i + 3);
				const hex = closing > i + 3 ? body.slice(i + 3, closing) : "";
				const codePoint = Number.parseInt(hex, 16);
				if (
					hex.length <= 6 &&
					/^[0-9a-fA-F]+$/.test(hex) &&
					codePoint <= 0x10ffff
				) {
					decoded += String.fromCodePoint(codePoint);
					i = closing;
					continue;
				}
				// A malformed escape stays literal rather than guessing.
			}
			switch (escaped) {
				case "n":
					decoded += "\n";
					break;
				case "r":
					decoded += "\r";
					break;
				case "t":
					decoded += "\t";
					break;
				case "b":
					decoded += "\b";
					break;
				case "f":
					decoded += "\f";
					break;
				case "v":
					decoded += "\v";
					break;
				case "0":
					decoded += "\0";
					break;
				case "a":
					decoded += "\x07";
					break;
				case "e":
					// The ESC escape exists only in PowerShell 7+; Windows
					// PowerShell 5.1 leaves it as a literal 'e'.
					decoded += edition === "core" ? "\x1b" : "e";
					break;
				default:
					// `"`, `$, `` ` `` and any other escape resolve to the escaped
					// character itself.
					decoded += escaped;
			}
			i++;
			continue;
		}
		if (character === '"' && body[i + 1] === '"') {
			decoded += '"';
			i++;
			continue;
		}
		decoded += character;
	}
	return decoded;
}

/**
 * Scan a string that begins with `"` and report the body of the complete
 * double-quoted string plus what follows it. Returns undefined when the
 * string is not one complete double-quoted string (unterminated, or a bare
 * closing quote followed by more than trailing whitespace).
 */
function splitCompleteDoubleQuotedString(
	text: string,
): { body: string; remainder: string } | undefined {
	if (!text.startsWith('"')) return undefined;
	for (let i = 1; i < text.length; i++) {
		const character = text[i];
		if (character === "`") {
			// Any backtick-escaped character is part of the body.
			i++;
			continue;
		}
		if (character === '"') {
			if (text[i + 1] === '"') {
				i++;
				continue;
			}
			const remainder = text.slice(i + 1);
			if (remainder.trim() !== "") return undefined;
			return { body: text.slice(1, i), remainder };
		}
	}
	return undefined;
}

/**
 * Classify a PowerShell executable path or name by edition, matching the
 * registry names: `powershell(.exe)` is Windows PowerShell 5.1 and
 * `pwsh(.exe)` is PowerShell 7+. Anything else is not a PowerShell
 * executable and returns undefined.
 */
function getPowerShellEdition(shell: string): "windows" | "core" | undefined {
	const name = normalizeShellName(shell);
	if (name === "powershell" || name === "powershell.exe") return "windows";
	if (name === "pwsh" || name === "pwsh.exe") return "core";
	return undefined;
}

function splitNestedCommandToScript(
	commandTail: string,
	edition: "windows" | "core",
): string | undefined {
	const tail = commandTail.trimStart();
	const quoted = splitCompleteDoubleQuotedString(tail);
	if (!quoted) return undefined;
	const script = decodePowerShellDoubleQuotedString(
		quoted.body,
		edition,
	).trim();
	return script.length > 0 ? script : undefined;
}

function unwrapOneNestedPowerShellLayer(
	command: string,
	shell: string,
): string | undefined {
	const head = /^(\s*)(?:"([^"]*)"|(\S+))\s+([\S\s]*)$/.exec(command);
	if (!head) return undefined;
	const outerEdition = getPowerShellEdition(shell);
	const nestedEdition = getPowerShellEdition(head[2] ?? head[3]);
	// The nested invocation must be the same PowerShell edition as the
	// configured outer shell; cross-edition nesting (`powershell` inside
	// `pwsh` or the reverse) is left untouched so a deliberate edition switch
	// keeps its meaning, and anything that is not a PowerShell executable
	// never matches at all.
	if (!outerEdition || nestedEdition !== outerEdition) {
		return undefined;
	}

	// Walk the flags up to -Command, allowing only flags the bootstrap itself
	// already applies. -NoProfile is required: the outer bootstrap runs
	// without profiles, so a nested invocation that would load the user's
	// profile must keep its own process to reproduce that initialization.
	let rest = head[4];
	let sawNoProfile = false;
	for (;;) {
		const flag = /^(-[^\s=]+)\s*([\S\s]*)$/.exec(rest);
		if (!flag) return undefined;
		const name = flag[1].toLowerCase();
		if (name === "-command") {
			return sawNoProfile
				? splitNestedCommandToScript(flag[2], outerEdition)
				: undefined;
		}
		if (!NESTED_POWERSHELL_UNWRAPPABLE_FLAGS.has(name)) return undefined;
		if (name === NESTED_POWERSHELL_REQUIRED_FLAG) sawNoProfile = true;
		rest = flag[2];
	}
}

/**
 * Detect a redundant nested `powershell|pwsh [-flags] -Command "<script>"`
 * invocation and return the script so the executor runs it directly, without
 * the extra shell layer. Returns undefined when the command does not match.
 *
 * The stdin bootstrap executes the submitted command as *outer* PowerShell
 * source, so a nested `-Command "…"` argument is parsed by the outer parser:
 * `$_` inside the double quotes is interpolated away before the nested shell
 * ever sees it. A pipeline like `… | Where-Object { $_.Name … }` then errors
 * once per enumerated item — a flood that looks like a hang (GitHub #13284).
 * Feeding the decoded script directly preserves the model's intent exactly,
 * because the nested invocation is the same shell edition running the same
 * script with the same wrapper flags.
 *
 * Only rewritings that are semantics-preserving by construction are done:
 *
 * - the nested executable is the same PowerShell edition as the configured
 *   outer shell (`powershell` nested in `powershell`, `pwsh` in `pwsh`);
 *   cross-edition nesting (`powershell` inside `pwsh` or the reverse) is left
 *   untouched so a deliberate edition switch keeps its meaning
 * - the nested invocation carries `-NoProfile` (written in full), and every
 *   other flag before `-Command` is one the bootstrap already applies
 *   (-NonInteractive, -NoLogo) — without `-NoProfile` the nested shell would
 *   load the user's profile (functions, aliases, modules), which the
 *   profile-less outer process cannot reproduce, and other flags
 *   (`-ExecutionPolicy`, `-File`, `-WorkingDirectory`, abbreviations such as
 *   `-c`) can change semantics, so the command is left untouched
 * - the entire `-Command` tail is one complete double-quoted string; anything
 *   else (`"…"; more`, unquoted tails, stray inner quotes) is left byte-identical
 *
 * One deliberate difference: the unwrapped script runs under the bootstrap's
 * `$ErrorActionPreference='Stop'` like every other command through this
 * wrapper. Previously the nested child process ran with its own default
 * 'Continue', so a nested script with non-terminating errors (Write-Error)
 * could keep going and exit 0 where the same script run directly fails fast.
 * The unwrap makes nested commands consistent with the fail-fast semantics
 * documented on the bootstrap, which is the same tradeoff GitHub Actions
 * makes for its powershell steps.
 *
 * Recursive double-shells unwrap one layer per call; the executor loops to a
 * fixpoint.
 */
export function unwrapNestedPowerShellCommand(
	command: string,
	shell: string,
): string | undefined {
	let current = command;
	// One iteration strips one shell layer; stop at the first non-rewrite.
	for (;;) {
		const unwrapped = unwrapOneNestedPowerShellLayer(current, shell);
		if (unwrapped === undefined) {
			return current === command ? undefined : current;
		}
		current = unwrapped;
	}
}

export function getShellInvocation(
	shell: string,
	command: string,
): ShellInvocation {
	switch (getShellKind(shell)) {
		case "powershell": {
			// A nested `powershell -Command "…"` is unwrapped before this wrapper
			// ever parses it: the bootstrap below executes the command as outer
			// PowerShell source, so the nested double-quoted argument would have
			// its $_ interpolated away before the nested shell sees it (#13284).
			const script = unwrapNestedPowerShellCommand(command, shell) ?? command;
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
				input: script,
			};
		}
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
