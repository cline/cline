import { describe, expect, it } from "vitest";
import { getDefaultShell, getShellArgs, getShellKind } from "./shell";

describe("shell helpers", () => {
	it("selects PowerShell on Windows and bash elsewhere", () => {
		expect(getDefaultShell("win32")).toBe("powershell");
		expect(getDefaultShell("darwin")).toBe("/bin/bash");
		expect(getDefaultShell("linux")).toBe("/bin/bash");
	});

	it("uses PowerShell flags for PowerShell executables", () => {
		expect(getShellArgs("powershell", "Write-Output 'hi'")).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'hi'",
		]);
		expect(
			getShellArgs(
				"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
				"Write-Output 'hi'",
			),
		).toEqual([
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
		expect(getShellKind("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
			"posix",
		);
	});
});
