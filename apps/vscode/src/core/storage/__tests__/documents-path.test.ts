import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import "should"

// bun loads real ESM, so the SUT's `import { execa } from "@packages/execa"`
// binding is read-only and cannot be reassigned directly. Route it through a
// mutable module-level delegate installed via mock.module, then swap the
// delegate per-test (same pattern as src/test/shell.test.ts).
type ExecaResult = { stdout: string }
let execaImpl: (...args: unknown[]) => Promise<ExecaResult> = () => {
	throw new Error("execaImpl not set for this test")
}
const execaDelegate = (...args: unknown[]) => execaImpl(...args)
mock.module("@packages/execa", () => ({ execa: execaDelegate }))

import { getDocumentsPath } from "../documents-path"

describe("getDocumentsPath", () => {
	let originalPlatform: string

	beforeEach(() => {
		originalPlatform = process.platform
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
	})

	describe("on win32", () => {
		beforeEach(() => {
			Object.defineProperty(process, "platform", { value: "win32" })
		})

		it("returns the real Documents path from PowerShell", async () => {
			execaImpl = async () => ({ stdout: "C:\\Users\\alice\\Documents\r\n" })

			const result = await getDocumentsPath()
			result.should.equal("C:\\Users\\alice\\Documents")
		})

		it("falls back to homedir/Documents when the decoded path is corrupted (mojibake)", async () => {
			// Reproduces the reported bug: PowerShell 5.1 writes the OEM/ANSI code
			// page to redirected stdout; a non-ASCII folder name (e.g. a Japanese
			// "Documents" OneDrive redirect) decoded as UTF-8 comes back with
			// U+FFFD replacement characters instead of the real text.
			execaImpl = async () => ({
				stdout: "C:\\Users\\alice\\OneDrive\\\uFFFDh\uFFFDL\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFDg\r\n",
			})

			const result = await getDocumentsPath()
			result.should.equal(require("path").join(require("os").homedir(), "Documents"))
		})

		it("asks PowerShell to emit UTF-8 before reading the folder path", async () => {
			let receivedArgs: unknown[] = []
			execaImpl = async (..._args: unknown[]) => {
				receivedArgs = _args
				return { stdout: "C:\\Users\\alice\\Documents" }
			}

			await getDocumentsPath()

			const [_command, psArgs] = receivedArgs as [string, string[]]
			const psCommand = psArgs[psArgs.length - 1]
			psCommand.should.containEql("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8")
			psCommand.should.containEql("GetFolderPath")
		})

		it("falls back to homedir/Documents when PowerShell throws", async () => {
			execaImpl = async () => {
				throw new Error("powershell not found")
			}

			const result = await getDocumentsPath()
			result.should.equal(require("path").join(require("os").homedir(), "Documents"))
		})
	})
})
