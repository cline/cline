import { describe, expect, it } from "vitest";
import {
	getDefaultShell,
	getShellArgs,
	getShellInvocation,
	getShellKind,
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
