import { describe, it } from "mocha"
import "should"
import { getHookLaunchConfig, resetHookLaunchConfigCacheForTesting } from "../HookProcess"
import { withPlatform } from "./test-utils"

describe("HookProcess", () => {
	beforeEach(() => {
		resetHookLaunchConfigCacheForTesting()
	})

	afterEach(() => {
		resetHookLaunchConfigCacheForTesting()
	})

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

	it("uses PowerShell on Windows", async () => {
		await withPlatform("win32", async () => {
			const ps1Path = "C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1"
			const resolvedExecutable = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"

			let resolverCallCount = 0

			const config = await getHookLaunchConfig(ps1Path, async () => {
				resolverCallCount += 1
				return resolvedExecutable
			})

			config.command.should.equal(resolvedExecutable)
			config.args.should.deepEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1Path])
			resolverCallCount.should.equal(1)
		})
	})

	it("clears failed launcher cache so later calls can recover", async () => {
		await withPlatform("win32", async () => {
			let resolverCallCount = 0

			const flakyResolver = async () => {
				resolverCallCount += 1
				if (resolverCallCount === 1) {
					throw new Error("initial resolver failure")
				}
				return "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
			}

			try {
				await getHookLaunchConfig("C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1", flakyResolver)
				throw new Error("Expected first call to fail")
			} catch (error: any) {
				error.message.should.match(/initial resolver failure/)
			}

			const recoveredConfig = await getHookLaunchConfig("C:\\workspace\\.clinerules\\hooks\\PreToolUse.ps1", flakyResolver)

			recoveredConfig.command.should.equal("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
			resolverCallCount.should.equal(2)
		})
	})
})
