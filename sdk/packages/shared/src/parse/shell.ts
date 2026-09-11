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

	if (getPowerShellEdition(shell) !== undefined) {
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
	/** Spawn this executable with these args and input as one invocation. */
	executable: string;
	args: string[];
	input?: string;
}

/**
 * PowerShell flags that are safe to drop when unwrapping a nested
 * -Command invocation: the outer bootstrap runs with -NoProfile and
 * -NonInteractive, and -NoLogo is a no-op under -Command.
 */
const NESTED_POWERSHELL_UNWRAPPABLE_FLAGS = new Set([
	"-nologo",
	"-noninteractive",
	"-noprofile",
]);

/**
 * The nested invocation must carry -NoProfile: the outer bootstrap starts
 * without profiles, so a nested shell that would load the user's profile
 * (functions, aliases, modules) must keep its own process to reproduce it.
 */
const NESTED_POWERSHELL_REQUIRED_FLAG = "-noprofile";

/**
 * Decode the body of a PowerShell double-quoted string to the literal text a
 * nested `powershell -Command "…"` would have received: backtick escapes
 * (`` `n ``, `` `t ``, `` `" ``, `` `$ ``, …) resolve to their characters and
 * `""` to a quote. `$`-expressions stay literal — the model wrote them for the
 * inner shell's parser. `` `u{…} `` code-point and `` `e `` ESC escapes
 * exist only in PowerShell 7+, so the OUTER edition that owns this string
 * decides how (or whether) they decode, not the requested inner edition.
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
 * Scan one complete ordinary ASCII-quoted string. Return its delimiter and
 * body together so decoding uses the same quoting rules as boundary detection.
 * Only whitespace may follow the closing quote; here-strings are not supported.
 */
function splitCompleteQuotedString(
	text: string,
): { quote: "'" | '"'; body: string } | undefined {
	const quote = text[0];
	if (quote !== "'" && quote !== '"') return undefined;
	for (let i = 1; i < text.length; i++) {
		const character = text[i];
		if (quote === '"' && character === "`") {
			// Backticks escape characters only in expandable strings.
			i++;
			continue;
		}
		if (character === quote) {
			if (text[i + 1] === quote) {
				i++;
				continue;
			}
			const remainder = text.slice(i + 1);
			if (remainder.trim() !== "") return undefined;
			return { quote, body: text.slice(1, i) };
		}
	}
	return undefined;
}

/**
 * Classify a PowerShell executable path or name by edition:
 * `powershell(.exe)` is Windows PowerShell and `pwsh(.exe)` is Microsoft
 * PowerShell. This identifies the edition, not the installed version.
 * Anything else returns undefined.
 */
export function getPowerShellEdition(
	shell: string,
): "windows" | "core" | undefined {
	const name = normalizeShellName(shell);
	if (name === "powershell" || name === "powershell.exe") return "windows";
	if (name === "pwsh" || name === "pwsh.exe") return "core";
	return undefined;
}

function splitNestedCommandToScript(
	commandTail: string,
	edition: "windows" | "core",
): string | undefined {
	const quoted = splitCompleteQuotedString(commandTail);
	if (!quoted) return undefined;
	const script = (
		quoted.quote === "'"
			? quoted.body.replaceAll("''", "'")
			: decodePowerShellDoubleQuotedString(quoted.body, edition)
	).trim();
	return script.length > 0 ? script : undefined;
}

/**
 * Detect a standalone nested `powershell|pwsh [-flags] -Command <quoted script>`
 * invocation and return the requested executable together with the decoded
 * script, so getShellInvocation can run the script in that executable through
 * the bootstrap instead of spawning an extra shell layer. Returns undefined
 * when the command does not match; the caller then runs it unchanged.
 *
 * The stdin bootstrap executes the submitted command as *outer* PowerShell
 * source, so a nested `-Command "…"` argument is parsed by the outer parser:
 * `$_` inside the double quotes is interpolated away before the nested shell
 * ever sees it. A pipeline like `… | Where-Object { $_.Name … }` then errors
 * once per enumerated item — a flood that looks like a hang (GitHub #13284).
 * Feeding the decoded script directly preserves its variables and embedded
 * quotes for the intended script, bypassing outer interpolation and native
 * argument quoting. Single-quoted arguments avoid interpolation but can still
 * lose embedded double quotes through Windows PowerShell's native argv handling.
 * Recognised wrappers carry script text, not legacy native-argument escapes:
 * backslashes remain literal rather than compensating for native quote loss.
 * This normalization is deliberately not equivalent to outer-shell execution.
 *
 * Unwrapping is limited to redundant invocations:
 *
 * - quoted executable names and paths require the call operator `&`;
 *   bare executable names and paths may omit it
 * - the nested executable is `powershell` or `pwsh` (either edition; the
 *   requested one is returned so cross-edition wrappers such as `powershell`
 *   inside `pwsh` run in the edition the command asked for)
 * - the nested invocation carries `-NoProfile` (written in full), and every
 *   other flag before `-Command` is bootstrap-equivalent (-NonInteractive)
 *   or a no-op under -Command (-NoLogo) — without -NoProfile the shell would
 *   load the user's profile (functions, aliases, modules), which the
 *   profile-less outer process cannot reproduce, and other flags
 *   (`-ExecutionPolicy`, `-File`, `-WorkingDirectory`, abbreviations such as
 *   `-c`) can change semantics, so the command is left untouched
 * - the entire `-Command` tail is one complete ASCII single- or double-quoted
 *   string; anything else (`"…"; more`, unquoted tails, stray inner quotes) is
 *   left byte-identical
 * - executable, flags and quoted tail are separated by spaces or tabs, not
 *   statement-ending newlines; newlines within the quoted body remain valid
 *
 * A double-quoted body is decoded with the rules of the OUTER shell's edition,
 * because that is the parser that owns the string.
 *
 * One deliberate difference: the unwrapped script runs under the bootstrap's
 * `$ErrorActionPreference='Stop'` like every other command through this
 * wrapper. Previously the nested child process ran with its own default
 * 'Continue', so a nested script with non-terminating errors (Write-Error)
 * could keep going and exit 0 where the same script run directly fails fast.
 * The unwrap makes nested commands consistent with the fail-fast semantics
 * documented on the bootstrap, which is the same tradeoff GitHub Actions
 * makes for its powershell steps.
 */
function parseNestedPowerShellCommand(
	command: string,
	shell: string,
): { executable: string; script: string } | undefined {
	// Only horizontal separators belong to this invocation. A bare newline
	// ends the outer statement; do not consume it before the quoted body either.
	// A quoted executable is a string expression unless & invokes it.
	const head =
		/^[ \t]*(?:&[ \t]+(?:"([^"$`]*)"|'((?:[^']|'')*)')|(?:&[ \t]+)?([^\s$`"';&|<>(){}#@,]+))[ \t]+([\S\s]*)$/.exec(
			command,
		);
	if (!head) return undefined;
	const executable = head[1] ?? head[2]?.replaceAll("''", "'") ?? head[3];
	const outerEdition = getPowerShellEdition(shell);
	if (!outerEdition || !getPowerShellEdition(executable)) {
		return undefined;
	}

	// Walk the flags up to -Command, allowing only bootstrap-equivalent flags.
	// -NoProfile is required: the outer bootstrap runs
	// without profiles, so a nested invocation that would load the user's
	// profile must keep its own process to reproduce that initialization.
	let rest = head[4];
	let sawNoProfile = false;
	for (;;) {
		const flag = /^(-[^\s=]+)[ \t]*([\S\s]*)$/.exec(rest);
		if (!flag) return undefined;
		const name = flag[1].toLowerCase();
		if (name === "-command") {
			const script = sawNoProfile
				? splitNestedCommandToScript(flag[2], outerEdition)
				: undefined;
			return script === undefined ? undefined : { executable, script };
		}
		if (!NESTED_POWERSHELL_UNWRAPPABLE_FLAGS.has(name)) return undefined;
		if (name === NESTED_POWERSHELL_REQUIRED_FLAG) sawNoProfile = true;
		rest = flag[2];
	}
}

export function getShellInvocation(
	shell: string,
	command: string,
): ShellInvocation {
	switch (getShellKind(shell)) {
		case "powershell": {
			// At tool invocation construction, select executable and script together,
			// before any await. A standalone NoProfile wrapper needs no outer process:
			// run its requested executable (not an edition-equivalent substitute) with
			// the existing bootstrap. This avoids both outer $ interpolation and native
			// argv quote loss, including pwsh -> powershell.exe and the reverse (#13284).
			// Each pass strips one wrapper layer, decoding it with the edition of the
			// shell that would have parsed it, until no wrapper remains.
			let selected = { executable: shell, script: command };
			for (;;) {
				const nested = parseNestedPowerShellCommand(
					selected.script,
					selected.executable,
				);
				if (!nested) break;
				selected = nested;
			}
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
				executable: selected.executable,
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
				input: selected.script,
			};
		}
		case "cmd":
			return { executable: shell, args: ["/d", "/s", "/c", command] };
		// wsl.exe is the Windows launcher for the default WSL distro, not a shell
		// itself. Run the command through the guest's bash so operators like `|`
		// and `;` are handled by bash rather than treated as wsl.exe arguments.
		// wsl.exe translates the Windows cwd to its /mnt mount automatically.
		case "wsl":
			return { executable: shell, args: ["bash", "-c", command] };
		case "posix":
			return { executable: shell, args: ["-c", command] };
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
