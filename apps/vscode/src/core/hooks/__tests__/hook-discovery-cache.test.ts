import { afterEach, beforeEach, describe, it } from "bun:test"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HookDiscoveryCache } from "../HookDiscoveryCache"
import { createHookTestEnv, createTestHook, HookTestEnv, resetHookCache } from "./test-utils"

describe("HookDiscoveryCache", () => {
	let env: HookTestEnv

	beforeEach(async () => {
		env = await createHookTestEnv()
	})

	afterEach(async () => {
		await env.cleanup()
	})

	it("scans the caller-provided hooks-dir snapshot on a cache miss", async () => {
		// A hooks dir outside what the stubbed getAllHooksDirs returns; finding
		// its script proves the provided snapshot was used instead.
		const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-cache-test-"))
		try {
			const scriptPath = await createTestHook(otherDir, "PreToolUse", { cancel: false })
			const otherHooksDir = path.dirname(scriptPath)

			resetHookCache()
			const scripts = await HookDiscoveryCache.getInstance().get("PreToolUse", [otherHooksDir])
			scripts.should.eql([scriptPath])
		} finally {
			await fs.rm(otherDir, { recursive: true, force: true })
		}
	})

	it("falls back to getAllHooksDirs when no snapshot is provided", async () => {
		const scriptPath = await createTestHook(env.tempDir, "PreToolUse", { cancel: false })

		resetHookCache()
		const scripts = await HookDiscoveryCache.getInstance().get("PreToolUse")
		scripts.should.eql([scriptPath])
	})
})
