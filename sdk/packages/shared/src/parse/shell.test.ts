import { describe, expect, it } from "vitest";
import {
	getDefaultShell,
	getShellArgs,
	getShellInvocation,
	getShellKind,
	unwrapNestedPowerShellCommand,
} from "./shell";

describe("shell helpers", () => {
	it("selects PowerShell on Windows and bash elsewhere", () => {
		expect(getDefaultShell("win32")).toBe("powershell");
		expect(getDefaultShell("darwin")).toBe("/bin/bash");
		expect(getDefaultShell("linux")).toBe("/bin/bash");
	});

	it("uses an ASCII bootstrap with Unicode-safe PowerShell stdin", () => {
		const command = "Write-Output '中文'";
		for (const shell of [
			"powershell",
			"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
		]) {
			const { args, input } = getShellInvocation(shell, command);
			expect(args.slice(0, 3)).toEqual([
				"-NoProfile",
				"-NonInteractive",
				"-Command",
			]);
			expect(
				[...args[3]].every((character) => character.charCodeAt(0) <= 0x7f),
			).toBe(true);
			expect(input).toBe(command);
		}
	});

	it("runs the PowerShell script under fail-fast error semantics", () => {
		for (const shell of [
			"powershell",
			"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
		]) {
			const { args, input } = getShellInvocation(
				shell,
				"param($x = 5) Write-Output $x",
			);
			// The bootstrap sets $ErrorActionPreference='Stop' before reading the
			// script from stdin, so per-item pipeline errors terminate immediately
			// instead of flooding stderr. It must be set in the bootstrap scope —
			// not prepended to the script text — so the user script stays
			// byte-identical: a leading param(...) keeps its mandatory
			// first-statement position and error positions are unshifted.
			expect(args[3]).toContain(
				"$ErrorActionPreference='Stop';$c=[Console]::In.ReadToEnd();",
			);
			expect(input).toBe("param($x = 5) Write-Output $x");
		}
	});

	it("unwraps a nested powershell -Command so $_ reaches the script literally", () => {
		// GitHub #13284: the stdin bootstrap parses the command as outer
		// PowerShell source, so the nested double-quoted argument had its $_
		// interpolated away before the nested shell ever saw it.
		const nested =
			"powershell -NoProfile -Command \" Get-ChildItem . -Recurse -File | Where-Object { $_.Name -match 'MyEditForm' } | ForEach-Object { $_.FullName } \"";
		const { input } = getShellInvocation("powershell", nested);
		expect(input).toBe(
			"Get-ChildItem . -Recurse -File | Where-Object { $_.Name -match 'MyEditForm' } | ForEach-Object { $_.FullName }",
		);
	});

	it("keeps the text-only helper edition-bound but selects the requested executable for execution", () => {
		const nested = 'pwsh -NoProfile -Command "Write-Output $_"';
		expect(unwrapNestedPowerShellCommand(nested, "pwsh")).toBe(
			"Write-Output $_",
		);
		expect(unwrapNestedPowerShellCommand(nested, "powershell")).toBeUndefined();
		expect(getShellInvocation("powershell", nested)).toMatchObject({
			executable: "pwsh",
			input: "Write-Output $_",
		});
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "Write-Output $_"',
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
			),
		).toBeUndefined();
		const issueCommand =
			"powershell -NoProfile -Command \"Get-ChildItem . -Recurse -File | Where-Object { $_.Name -match 'MyEditForm|EditContext|Validator' } | ForEach-Object { $_.FullName }\"";
		expect(getShellInvocation("pwsh.exe", issueCommand)).toMatchObject({
			executable: "powershell",
			input:
				"Get-ChildItem . -Recurse -File | Where-Object { $_.Name -match 'MyEditForm|EditContext|Validator' } | ForEach-Object { $_.FullName }",
		});
	});

	it("decodes each wrapper in its outer edition and retains literal executable paths", () => {
		const path = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
		expect(
			getShellInvocation(
				"powershell",
				`& '${path}' -NoProfile -Command "Write-Output 'a\`eb'"`,
			),
		).toMatchObject({ executable: path, input: "Write-Output 'aeb'" });
		expect(
			getShellInvocation(
				"pwsh",
				"powershell.exe -NoProfile -Command \"Write-Output 'a`eb'\"",
			),
		).toMatchObject({
			executable: "powershell.exe",
			input: "Write-Output 'a\x1bb'",
		});
		expect(
			getShellInvocation(
				"pwsh",
				'powershell -NoProfile -Command "pwsh -NoProfile -Command `"Write-Output $_`""',
			),
		).toMatchObject({ executable: "pwsh", input: "Write-Output $_" });
	});

	it("unwraps bootstrap-equivalent flags and the non-interactive banner flag", () => {
		for (const flags of [
			"-NoProfile",
			"-NoProfile -NonInteractive",
			"-NoLogo -NoProfile -NonInteractive",
		]) {
			expect(
				unwrapNestedPowerShellCommand(
					`powershell ${flags} -Command "Get-Date"`.replace(/\s+/g, " "),
					"powershell",
				),
			).toBe("Get-Date");
		}
		// Quoted executable paths count as the same shell when the edition matches.
		expect(
			unwrapNestedPowerShellCommand(
				'& "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "Get-Date"',
				"pwsh",
			),
		).toBe("Get-Date");
	});

	it.each(["'", '"'])("requires & before a %s-quoted executable", (quote) => {
		for (const executable of [
			"powershell.exe",
			"pwsh.exe",
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
		]) {
			const command = `${quote}${executable}${quote} -NoProfile -Command 'Write-Output 42'`;
			for (const shell of ["powershell.exe", "pwsh.exe"]) {
				expect(getShellInvocation(shell, command)).toMatchObject({
					executable: shell,
					input: command,
				});
				expect(unwrapNestedPowerShellCommand(command, shell)).toBeUndefined();
				expect(getShellInvocation(shell, ` \t&\t${command}`)).toMatchObject({
					executable,
					input: "Write-Output 42",
				});
			}
		}
	});

	it("accepts bare executable names with or without &", () => {
		for (const executable of ["powershell.exe", "pwsh.exe"]) {
			for (const prefix of ["", "& "]) {
				expect(
					getShellInvocation(
						"powershell.exe",
						`${prefix}${executable} -NoProfile -Command 'Write-Output 42'`,
					),
				).toMatchObject({
					executable,
					input: "Write-Output 42",
				});
			}
		}
	});

	it("unwraps recursive double-shells one layer per pass", () => {
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "powershell -NoProfile -Command `"Write-Output $_`""',
				"powershell",
			),
		).toBe("Write-Output $_");
	});

	it("does not join statements separated by bare newlines", () => {
		for (const shell of ["powershell", "pwsh"]) {
			for (const newline of ["\n", "\r", "\r\n"]) {
				const tokens = [shell, "-NoProfile", "-Command", '"Write-Output 42"'];
				for (let boundary = 1; boundary < tokens.length; boundary++) {
					const command = `${tokens.slice(0, boundary).join(" ")}${newline}\t${tokens.slice(boundary).join(" ")}`;
					expect(unwrapNestedPowerShellCommand(command, shell)).toBeUndefined();
					expect(getShellInvocation(shell, command).input).toBe(command);
				}
			}
		}
	});

	it("preserves quoted multiline scripts and leaves outer line continuations untouched", () => {
		for (const shell of ["powershell", "pwsh"]) {
			for (const newline of ["\n", "\r\n"]) {
				const script = `Write-Output 'first'${newline}Write-Output 'second'`;
				expect(
					unwrapNestedPowerShellCommand(
						`\t${shell}\t-NoProfile \t-Command\t"${script}"`,
						shell,
					),
				).toBe(script);
				const continued = `${shell} -NoProfile -Command \`${newline}"Write-Output 'continued'"`;
				expect(unwrapNestedPowerShellCommand(continued, shell)).toBeUndefined();
				expect(getShellInvocation(shell, continued).input).toBe(continued);
			}
		}
	});

	it("decodes PowerShell escape sequences while unwrapping", () => {
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "Write-Output `"`n`$literal`""',
				"powershell",
			),
		).toBe('Write-Output "\n$literal"');
		// Doubled quotes decode to a single embedded quote.
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "Write-Output \'say ""hi""\'"',
				"powershell",
			),
		).toBe("Write-Output 'say \"hi\"'");
		// `u{…} code-point escapes are PowerShell 7+ only.
		expect(
			unwrapNestedPowerShellCommand(
				'pwsh -NoProfile -Command "Write-Output `u{41} `u{1F600}"',
				"pwsh",
			),
		).toBe("Write-Output A 😀");
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "Write-Output `u{41}"',
				"powershell",
			),
		).toBe("Write-Output u{41}");
		// A malformed escape stays literal.
		expect(
			unwrapNestedPowerShellCommand(
				'pwsh -NoProfile -Command "Write-Output `u{zz}"',
				"pwsh",
			),
		).toBe("Write-Output u{zz}");
		// The `e ESC escape is PowerShell 7+ only as well.
		expect(
			unwrapNestedPowerShellCommand(
				'pwsh -NoProfile -Command "Write-Output `e[31mred`e[0m"',
				"pwsh",
			),
		).toBe("Write-Output \x1b[31mred\x1b[0m");
		expect(
			unwrapNestedPowerShellCommand(
				'powershell -NoProfile -Command "Write-Output `e"',
				"powershell",
			),
		).toBe("Write-Output e");
	});

	it("leaves non-rewritable nested invocations byte-identical", () => {
		const untouched = [
			// Comments and expressions are not literal executable names.
			'#/pwsh -NoProfile -Command "Write-Output 42"',
			'@("pwsh") -NoProfile -Command "Write-Output 42"',
			'& "$env:ProgramFiles/PowerShell/7/pwsh.exe" -NoProfile -Command "Write-Output 42"',
			'&\npwsh -NoProfile -Command "Write-Output 42"',
			"powershell -NoProfile -EncodedCommand VwByAGkAdABlAA==",
			'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date"',
			// Other flags can change semantics in the nested shell.
			'powershell -ExecutionPolicy Bypass -Command "Get-Date"',
			"powershell -File script.ps1",
			// Abbreviated -Command is ambiguous; only the full name is rewritten.
			'powershell -c "Get-Date"',
			// Without -NoProfile the nested shell would load the user's
			// profile, which the profile-less outer process cannot reproduce.
			'powershell -Command "Get-Date"',
			'powershell -NonInteractive -Command "Get-Date"',
			// Extra statements after the quoted script belong to the outer shell.
			'powershell -NoProfile -Command "Get-Date"; Write-Output after',
			// An unquoted tail is already parsed by the outer shell.
			"powershell -Command Get-Date",
			// Single-quoted wrappers also need -NoProfile to be rewritten.
			"powershell -Command 'Get-Date'",
			// Unterminated or stray quotes make the tail ambiguous.
			'powershell -Command "Get-Date',
			'powershell -Command "Get-Date" "other"',
			// Empty script.
			'powershell -Command ""',
			// Plain commands, other executables, and non-PowerShell executables
			// that merely carry a -Command flag.
			"Write-Output hello",
			'cmd /c "echo hello"',
			'Write-Output -Command "Get-Date"',
			'notepad -Command "Get-Date"',
			'"" -Command "Get-Date"',
		];
		for (const command of untouched) {
			expect(
				unwrapNestedPowerShellCommand(command, "powershell"),
			).toBeUndefined();
			expect(getShellInvocation("powershell", command).input).toBe(command);
			expect(getShellInvocation("pwsh", command)).toMatchObject({
				executable: "pwsh",
				input: command,
			});
		}
	});

	it("unwraps the single-quoted message-box script without changing its quotes or variables", () => {
		const script =
			'Add-Type -AssemblyName PresentationFramework; Write-Output ("ready-pid=" + $PID); [void][System.Windows.MessageBox]::Show(("PID: " + $PID), "PowerShell PID"); Start-Sleep -Seconds 30; Write-Output "after"';
		for (const shell of ["powershell.exe", "pwsh.exe"]) {
			expect(
				getShellInvocation(shell, `pwsh.exe -NoProfile -Command '${script}'`),
			).toMatchObject({
				executable: "pwsh.exe",
				input: script,
			});
		}
	});

	it.each([
		[
			"doubled apostrophes",
			"'Write-Output ''it''''s fine'''",
			"Write-Output 'it''s fine'",
		],
		[
			"literal escapes",
			"'Write-Output ''$PID `n `e `u{41} C:\\temp \"text\"'''",
			"Write-Output '$PID `n `e `u{41} C:\\temp \"text\"'",
		],
		[
			"backtick before the closing quote",
			"'Write-Output value`'",
			"Write-Output value`",
		],
		[
			"multiline body",
			"'Write-Output 1\r\nWrite-Output 2' \t\r\n",
			"Write-Output 1\r\nWrite-Output 2",
		],
	])("decodes a single-quoted body with %s", (_name, tail, script) => {
		for (const shell of ["powershell.exe", "pwsh.exe"]) {
			expect(
				getShellInvocation(shell, `powershell.exe -NoProfile -Command ${tail}`),
			).toMatchObject({
				executable: "powershell.exe",
				input: script,
			});
		}
	});

	it.each([
		"'Write-Output 42",
		"'Write-Output 42''",
		"'Write-Output 42' 'extra'",
		"'Write-Output 42'; Write-Output 7",
		"'Write-Output 42'\nWrite-Output 7",
		"'Write-Output 42' | Out-String",
		"'Write-Output 42' > output.txt",
		"'Write-Output value`' trailing'",
		"\n'Write-Output 42'",
		"''",
		"@'\nWrite-Output 42\n'@",
		'@"\nWrite-Output 42\n"@',
	])("leaves an unsupported or incomplete quoted tail unchanged: %s", (tail) => {
		const command = `pwsh.exe -NoProfile -Command ${tail}`;
		for (const shell of ["powershell.exe", "pwsh.exe"]) {
			expect(getShellInvocation(shell, command)).toMatchObject({
				executable: shell,
				input: command,
			});
		}
	});

	it("keeps getShellArgs self-contained for PowerShell callers", () => {
		expect(getShellArgs("powershell", "Write-Output 'hi'")).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'hi'",
		]);
	});

	it("uses cmd flags for cmd.exe", () => {
		expect(getShellArgs("cmd.exe", "echo hello")).toEqual([
			"/d",
			"/s",
			"/c",
			"echo hello",
		]);
	});

	it("uses POSIX flags for bash-like shells", () => {
		expect(getShellArgs("/bin/bash", "echo hi")).toEqual(["-c", "echo hi"]);
		expect(
			getShellArgs("C:\\Program Files\\Git\\bin\\bash.exe", "echo hi"),
		).toEqual(["-c", "echo hi"]);
	});

	it("runs commands through guest bash for the WSL launcher", () => {
		expect(getShellArgs("wsl.exe", "ls | head -5")).toEqual([
			"bash",
			"-c",
			"ls | head -5",
		]);
		expect(getShellArgs("C:\\Windows\\System32\\wsl.exe", "echo hi")).toEqual([
			"bash",
			"-c",
			"echo hi",
		]);
	});

	it("classifies shells into kinds consistent with their spawn args", () => {
		expect(getShellKind("powershell")).toBe("powershell");
		expect(getShellKind("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
			"powershell",
		);
		expect(
			getShellKind(
				"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			),
		).toBe("powershell");
		expect(getShellKind("cmd.exe")).toBe("cmd");
		expect(getShellKind("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
		expect(getShellKind("C:\\Windows\\System32\\wsl.exe")).toBe("wsl");
		expect(getShellKind("/bin/bash")).toBe("posix");
		expect(getShellKind("/bin/zsh")).toBe("posix");
		expect(getShellKind("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("posix");
	});
});
