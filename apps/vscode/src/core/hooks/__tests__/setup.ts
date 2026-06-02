import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import sinon from "sinon"
import { StateManager } from "../../storage/StateManager"
import { createHooksDirectory } from "./test-utils"

/**
 * Test environment containing temp directories and cleanup functions.
 */
export interface HookTestEnvironment {
	/** Temporary directory for this test */
	tempDir: string
	/** Array of hooks directories (.clinerules/hooks paths) */
	hooksDirs: string[]
	/** Cleanup function to remove temp directories */
	cleanup: () => Promise<void>
}

/**
 * Creates a fresh test environment with temp directories.
 * Automatically creates .clinerules/hooks structure.
 *
 * @returns Test environment with cleanup function
 *
 * @example
 * const env = await createHookTestEnvironment()
 * // Use env.tempDir, env.hooksDirs in tests
 * await env.cleanup() // Clean up after tests
 */
export async function createHookTestEnvironment(): Promise<HookTestEnvironment> {
	const tempDir = path.join(os.tmpdir(), `hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

	await fs.mkdir(tempDir, { recursive: true })

	const hooksDir = await createHooksDirectory(tempDir)

	return {
		tempDir,
		hooksDirs: [hooksDir],
		cleanup: async () => {
			try {
				await fs.rm(tempDir, { recursive: true, force: true })
			} catch (error: any) {
				// Only ignore ENOENT (already deleted), log other errors
				if (error.code !== "ENOENT") {
					console.warn(`Cleanup warning for ${tempDir}:`, error.message)
				}
			}
		},
	}
}

/**
 * Standard setup for hook tests. Returns accessor to environment.
 * Use in describe() blocks for automatic setup/teardown.
 *
 * @returns Object with getEnv() method to access test environment
 *
 * @example
 * describe("My Hook Tests", () => {
 *   const { getEnv } = setupHookTests()
 *
 *   it("should do something", async () => {
 *     const env = getEnv()
 *     // env.tempDir is ready to use
 *   })
 * })
 */
export function setupHookTests(): {
	getEnv: () => HookTestEnvironment
} {
	let env: HookTestEnvironment
	let sandbox: sinon.SinonSandbox

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		env = await createHookTestEnvironment()

		// Mock StateManager to return test workspace
		mockStateManager(sandbox, [env.tempDir])
	})

	afterEach(async () => {
		sandbox.restore()
		await env.cleanup()
	})

	return {
		getEnv: () => {
			if (!env) {
				throw new Error("Test environment not initialized. Called getEnv() outside of test?")
			}
			return env
		},
	}
}

/**
 * Mocks StateManager to return test workspace roots.
 * Useful for testing hook discovery across multiple workspace roots.
 *
 * @param sandbox Sinon sandbox for cleanup
 * @param workspaceRoots Array of workspace root paths
 *
 * @example
 * const sandbox = sinon.createSandbox()
 * mockStateManager(sandbox, ["/path/to/workspace1", "/path/to/workspace2"])
 * // StateManager.get().getGlobalStateKey("workspaceRoots") now returns mocked roots
 * sandbox.restore() // Clean up after tests
 */
export function mockStateManager(sandbox: sinon.SinonSandbox, workspaceRoots: string[]): void {
	sandbox.stub(StateManager, "get").returns({
		getGlobalStateKey: () => workspaceRoots.map((rootPath) => ({ path: rootPath })),
	} as any)
}
