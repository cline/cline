import { describe, it } from "bun:test"
import assert from "node:assert/strict"
import { getShellArgs, unwrapPowerShell } from "../shellArgs"

describe("unwrapPowerShell", () => {
	it("strips a double-quoted powershell -Command wrapper", () => {
		assert.equal(unwrapPowerShell(`powershell -Command "Write-Output 'hi'"`), "Write-Output 'hi'")
	})

	it("strips a single-quoted pwsh -Command wrapper", () => {
		assert.equal(unwrapPowerShell(`pwsh -Command 'Get-Date'`), "Get-Date")
	})

	it("strips a powershell.exe -c wrapper", () => {
		assert.equal(unwrapPowerShell(`powershell.exe -c "dir"`), "dir")
	})

	it("handles a nested-quote command without shredding inner quotes", () => {
		const inner = `if (Test-Path 'CHANGELOG.md') { Remove-Item 'CHANGELOG.md' -Force }`
		assert.equal(unwrapPowerShell(`powershell -Command "${inner}"`), inner)
	})

	it("returns a non-wrapped command verbatim", () => {
		assert.equal(unwrapPowerShell(`Remove-Item -Path "x" -Force`), `Remove-Item -Path "x" -Force`)
		assert.equal(unwrapPowerShell(`dir C:\\Users\\me\\file.log`), `dir C:\\Users\\me\\file.log`)
	})

	it("does not unwrap when content past the closing quote remains (avoids mis-rewrite)", () => {
		// The body cannot contain the delimiter, so a second quoted token fails to match.
		const input = `powershell -Command "foo" "bar"`
		assert.equal(unwrapPowerShell(input), input)
	})

	it("does not unwrap a bare command that merely mentions powershell", () => {
		assert.equal(unwrapPowerShell(`echo powershell -Command "x"`), `echo powershell -Command "x"`)
	})
})

describe("getShellArgs", () => {
	it("uses -NoProfile -NonInteractive -Command and unwraps for PowerShell on win32", () => {
		assert.deepEqual(getShellArgs("powershell.exe", `Write-Output 'hi'`, "win32"), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'hi'",
		])
		assert.deepEqual(getShellArgs("pwsh", `powershell -Command "dir"`, "win32"), [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"dir",
		])
	})

	it("uses /d /s /c for cmd on win32", () => {
		assert.deepEqual(getShellArgs("cmd.exe", "echo hi", "win32"), ["/d", "/s", "/c", "echo hi"])
	})

	it("uses -c for POSIX shells off win32", () => {
		assert.deepEqual(getShellArgs("/bin/bash", "echo hi", "linux"), ["-c", "echo hi"])
		assert.deepEqual(getShellArgs("/bin/zsh", "echo hi", "darwin"), ["-c", "echo hi"])
	})
})
