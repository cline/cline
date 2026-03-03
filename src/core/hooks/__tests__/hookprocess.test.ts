import { describe, it } from "mocha"
import "should"
import { getHookLaunchConfig } from "../HookProcess"
import { withPlatform } from "./test-utils"

describe("HookProcess", () => {
	it("uses resolved PowerShell executable and expected Windows launch args", async () => {
		const resolvedExecutable = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"

		await withPlatform("win32", async () => {
			const config = await getHookLaunchConfig(
				"C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1",
				async () => resolvedExecutable,
			)

			config.command.should.equal(resolvedExecutable)
			config.args.should.deepEqual([
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				"C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1",
			])
			config.shell.should.equal(false)
			config.detached.should.equal(false)
		})
	})

	it("keeps Unix launch behavior unchanged", async () => {
		await withPlatform("linux", async () => {
			const config = await getHookLaunchConfig("/tmp/.clinerules/hooks/PreToolUse")
			config.args.should.deepEqual([])
			config.shell.should.equal(true)
			config.detached.should.equal(true)
		})
	})

	it("surfaces resolver failures", async () => {
		await withPlatform("win32", async () => {
			try {
				await getHookLaunchConfig("C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1", async () => {
					throw new Error("resolver failed")
				})
				throw new Error("Expected getHookLaunchConfig to throw")
			} catch (error: any) {
				error.message.should.match(/resolver failed/)
			}
		})
	})
})