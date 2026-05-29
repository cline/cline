import { describe, expect, it } from "vitest";
import { getDefaultShell, getShellArgs, unwrapPowerShell } from "./shell";

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

	it("unwraps a redundant PowerShell wrapper when building args", () => {
		expect(
			getShellArgs("powershell", `powershell -Command "dir"`),
		).toEqual(["-NoProfile", "-NonInteractive", "-Command", "dir"]);
	});
});

describe("unwrapPowerShell", () => {
	it("strips a double-quoted -Command wrapper", () => {
		expect(unwrapPowerShell(`powershell -Command "Write-Output 'hi'"`)).toBe(
			"Write-Output 'hi'",
		);
	});

	it("strips a single-quoted -Command wrapper", () => {
		expect(unwrapPowerShell(`pwsh -Command 'Get-Date'`)).toBe("Get-Date");
	});

	it("strips a powershell.exe -c wrapper", () => {
		expect(unwrapPowerShell(`powershell.exe -c "dir"`)).toBe("dir");
	});

	it("preserves inner quotes in a nested-quote command", () => {
		const inner = `if (Test-Path 'CHANGELOG.md') { Remove-Item 'CHANGELOG.md' -Force }`;
		expect(unwrapPowerShell(`powershell -Command "${inner}"`)).toBe(inner);
	});

	it("returns a non-wrapped command verbatim", () => {
		expect(unwrapPowerShell(`Remove-Item -Path "x" -Force`)).toBe(
			`Remove-Item -Path "x" -Force`,
		);
	});

	it("does not unwrap when content remains past the closing quote", () => {
		const input = `powershell -Command "foo" "bar"`;
		expect(unwrapPowerShell(input)).toBe(input);
	});

	it("does not unwrap a command that merely mentions powershell", () => {
		expect(unwrapPowerShell(`echo powershell -Command "x"`)).toBe(
			`echo powershell -Command "x"`,
		);
	});

	it("does not unwrap when intermediate flags sit between binary and -Command", () => {
		// Wrappers like "powershell -NoProfile -Command ..." are not stripped;
		// they are returned verbatim to avoid incorrect rewrites.
		const input = `powershell -NoProfile -Command "dir"`;
		expect(unwrapPowerShell(input)).toBe(input);
	});
});
