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

	describe("unwrapNestedPowerShellCommand", () => {
		it("unwraps a nested invocation with flags and a quoted tail, keeping $_ intact", () => {
			const pipeline =
				"Get-ChildItem 'C:\\repo' -Recurse -File | Where-Object { $_.Name -match 'Form|Context' } | ForEach-Object { $_.FullName }";
			expect(
				unwrapNestedPowerShellCommand(
					`powershell -NoProfile -Command "${pipeline}"`,
				),
			).toBe(pipeline);
			expect(
				unwrapNestedPowerShellCommand(
					`pwsh -NoProfile -NonInteractive -Command "${pipeline}"`,
				),
			).toBe(pipeline);
		});

		it("unwraps single-flag and no-flag variants", () => {
			expect(
				unwrapNestedPowerShellCommand('powershell -Command "Get-Date"'),
			).toBe("Get-Date");
			expect(
				unwrapNestedPowerShellCommand(
					'pwsh.exe -NonInteractive -Command "Get-Date"',
				),
			).toBe("Get-Date");
			expect(
				unwrapNestedPowerShellCommand(
					'powershell.exe -ExecutionPolicy Bypass -Command "Get-Date"',
				),
			).toBe("Get-Date");
		});

		it("unwraps an unquoted tail and matches flags case-insensitively", () => {
			expect(
				unwrapNestedPowerShellCommand(
					"POWERSHELL -noprofile -command Get-Process | Select-Object -First 5",
				),
			).toBe("Get-Process | Select-Object -First 5");
		});

		it("leaves non-nested commands untouched", () => {
			for (const command of [
				"Get-ChildItem -Recurse | Where-Object { $_.Name -match 'x' }",
				"Write-Output 'powershell -Command is mentioned here'",
				"powershell -File script.ps1",
				"powershell -EncodedCommand SQBuAHYAbwBrAGUA",
				// Unknown flag before -Command: not clearly redundant.
				'powershell -WindowStyle Hidden -Command "Get-Date"',
				// Full paths are not rewritten.
				'C:\\Program Files\\PowerShell\\7\\pwsh.exe -Command "Get-Date"',
				// The nested invocation is not the whole command line.
				'powershell -Command "Get-Date"; Write-Output done',
			]) {
				expect(unwrapNestedPowerShellCommand(command)).toBe(command);
			}
		});

		it("leaves recursive double-nesting untouched", () => {
			const doubleNested =
				'powershell -NoProfile -Command "pwsh -Command Get-Date"';
			expect(unwrapNestedPowerShellCommand(doubleNested)).toBe(doubleNested);
		});

		it("leaves tails with interior quotes or degenerate tails untouched", () => {
			for (const command of [
				// Interior quotes imply escaping the helper does not interpret.
				'powershell -Command "Write-Output ""hi"""',
				'powershell -Command "echo \\"hi\\""',
				// `-Command -` means read from stdin; not a script tail.
				"powershell -Command -",
				'powershell -Command ""',
			]) {
				expect(unwrapNestedPowerShellCommand(command)).toBe(command);
			}
		});

		it("feeds the unwrapped script through the PowerShell stdin wrapper", () => {
			const nested =
				"powershell -NoProfile -Command \"Get-ChildItem | Where-Object { $_.Name -match 'x' }\"";
			const direct = getShellInvocation(
				"powershell",
				"Get-ChildItem | Where-Object { $_.Name -match 'x' }",
			);
			const unwrapped = getShellInvocation("pwsh.exe", nested);
			expect(unwrapped.input).toBe(
				"Get-ChildItem | Where-Object { $_.Name -match 'x' }",
			);
			// The bootstrap args (including fail-fast semantics) are unchanged.
			expect(unwrapped.args).toEqual(direct.args);
			expect(unwrapped.args[3]).toContain("$ErrorActionPreference='Stop';");
		});

		it("does not rewrite nested-looking commands for cmd or posix shells", () => {
			const nested = 'powershell -NoProfile -Command "Get-Date"';
			expect(getShellInvocation("cmd.exe", nested)).toEqual({
				args: ["/d", "/s", "/c", nested],
			});
			expect(getShellInvocation("/bin/bash", nested)).toEqual({
				args: ["-c", nested],
			});
			expect(getShellInvocation("wsl.exe", nested)).toEqual({
				args: ["bash", "-c", nested],
			});
		});
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
