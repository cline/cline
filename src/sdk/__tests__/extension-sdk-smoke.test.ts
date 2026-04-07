/**
 * E2E Smoke Test for SDK Extension Entry Point
 *
 * Validates the full lifecycle: activate → interact → deactivate.
 * Uses a temp directory so it doesn't touch real ~/.cline/data/.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { activateSdkExtension, deactivateSdkExtension, type SdkExtensionContext } from "../extension-sdk"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string
let ctx: SdkExtensionContext | undefined

function createTestDataDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-sdk-smoke-"))
	// Create expected file structure
	fs.writeFileSync(
		path.join(dir, "globalState.json"),
		JSON.stringify({
			mode: "act",
			isNewUser: false,
			welcomeViewCompleted: true,
			telemetrySetting: "enabled",
			apiProvider: "anthropic",
			apiModelId: "claude-sonnet-4-20250514",
		}),
	)
	fs.writeFileSync(
		path.join(dir, "secrets.json"),
		JSON.stringify({
			apiKey: "sk-test-key-123",
		}),
	)
	const stateDir = path.join(dir, "state")
	fs.mkdirSync(stateDir, { recursive: true })
	fs.writeFileSync(
		path.join(stateDir, "taskHistory.json"),
		JSON.stringify([
			{
				id: "task_1",
				ts: Date.now() - 1000,
				task: "Previous task",
				tokensIn: 100,
				tokensOut: 50,
				totalCost: 0.001,
			},
		]),
	)
	return dir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SDK Extension Smoke Test", () => {
	beforeEach(() => {
		tmpDir = createTestDataDir()
		ctx = undefined
	})

	afterEach(async () => {
		if (ctx) {
			await deactivateSdkExtension(ctx)
		}
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("activates successfully with legacy data", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
		})

		expect(ctx.controller).toBeDefined()
		expect(ctx.legacyState).toBeDefined()
	})

	it("provides valid initial state after activation", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
		})

		const state = ctx.controller.getState()
		expect(state.version).toBe("3.5.0")
		expect(state.mode).toBe("act")
		expect(state.isNewUser).toBe(false)
		expect(state.welcomeViewCompleted).toBe(true)
		expect(state.clineMessages).toEqual([])
	})

	it("loads task history from legacy state", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
		})

		const history = ctx.controller.getTaskHistory()
		expect(history.length).toBeGreaterThanOrEqual(1)
		expect(history[0].task).toBe("Previous task")
	})

	it("gRPC handler responds to getLatestState", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
		})

		const handler = ctx.controller.getGrpcHandler()
		const response = await handler.handleRequest({ method: "getLatestState" })

		expect(response.error).toBeUndefined()
		const state = response.data as ExtensionState
		expect(state.version).toBe("3.5.0")
		expect(state.mode).toBe("act")
	})

	it("gRPC handler handles state subscription + push", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
		})

		const handler = ctx.controller.getGrpcHandler()
		const states: ExtensionState[] = []

		await handler.handleRequest({
			method: "subscribeToState",
			params: {
				callback: (s: unknown) => states.push(s as ExtensionState),
			},
		})

		// Should receive initial state
		expect(states).toHaveLength(1)
		expect(states[0].version).toBe("3.5.0")
	})

	it("handles full task lifecycle via gRPC", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		const handler = ctx.controller.getGrpcHandler()

		// 1. Start a new task
		const newTaskResponse = await handler.handleRequest({
			method: "newTask",
			params: { text: "Write unit tests", images: [] },
		})
		expect(newTaskResponse.error).toBeUndefined()

		// 2. Check state has task
		const stateResponse = await handler.handleRequest({ method: "getLatestState" })
		const state = stateResponse.data as ExtensionState
		expect(state.currentTaskItem).toBeDefined()
		expect(state.currentTaskItem!.task).toBe("Write unit tests")
		expect(state.clineMessages.length).toBeGreaterThan(0)

		// 3. Clear the task
		const clearResponse = await handler.handleRequest({ method: "clearTask" })
		expect(clearResponse.error).toBeUndefined()

		// 4. Verify cleared
		const clearedState = (await handler.handleRequest({ method: "getLatestState" })).data as ExtensionState
		expect(clearedState.currentTaskItem).toBeUndefined()
		expect(clearedState.clineMessages).toEqual([])
	})

	it("handles configuration updates via gRPC", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		const handler = ctx.controller.getGrpcHandler()

		// Update API config
		await handler.handleRequest({
			method: "updateApiConfigurationProto",
			params: { actModeApiProvider: "openrouter", actModeApiModelId: "gpt-4o" },
		})

		const state = (await handler.handleRequest({ method: "getLatestState" })).data as ExtensionState
		expect(state.apiConfiguration?.actModeApiProvider).toBe("openrouter")
		expect(state.apiConfiguration?.actModeApiModelId).toBe("gpt-4o")
	})

	it("handles mode toggle via gRPC", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		const handler = ctx.controller.getGrpcHandler()

		await handler.handleRequest({
			method: "togglePlanActModeProto",
			params: { mode: "plan" },
		})

		const state = (await handler.handleRequest({ method: "getLatestState" })).data as ExtensionState
		expect(state.mode).toBe("plan")
	})

	it("gracefully handles non-critical gRPC methods", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		const handler = ctx.controller.getGrpcHandler()

		// These should all return empty (not error)
		const methods = [
			"getAvailableTerminalProfiles",
			"refreshOpenRouterModelsRpc",
			"openFile",
			"accountLoginClicked",
			"listWorktrees",
			"initializeWebview",
		]

		for (const method of methods) {
			const response = await handler.handleRequest({ method })
			expect(response.error).toBeUndefined()
		}
	})

	it("activates without legacy data (fresh install)", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-sdk-empty-"))

		try {
			ctx = await activateSdkExtension({
				dataDir: emptyDir,
				version: "3.5.0",
				cwd: emptyDir,
				skipMigration: true,
			})

			const state = ctx.controller.getState()
			expect(state.version).toBe("3.5.0")
			expect(state.isNewUser).toBe(true)
			expect(state.clineMessages).toEqual([])
			expect(state.taskHistory).toEqual([])
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true })
		}
	})

	it("deactivates cleanly", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		// Start a task
		await ctx.controller.newTask("Test task")

		// Deactivate should not throw
		await deactivateSdkExtension(ctx)
		ctx = undefined // Prevent afterEach from double-deactivating
	})

	it("all required ExtensionState fields are present", async () => {
		const { REQUIRED_STATE_FIELDS } = await import("../state-builder")

		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		const state = ctx.controller.getState()

		for (const field of REQUIRED_STATE_FIELDS) {
			expect(state).toHaveProperty(field)
		}
	})

	it("state is JSON-serializable (can pass through postMessage)", async () => {
		ctx = await activateSdkExtension({
			dataDir: tmpDir,
			version: "3.5.0",
			cwd: tmpDir,
			skipMigration: true,
		})

		// Start a task so state has content
		await ctx.controller.newTask("Serialize me")

		const state = ctx.controller.getState()
		const json = JSON.stringify(state)
		const parsed = JSON.parse(json)

		expect(parsed.version).toBe("3.5.0")
		expect(parsed.clineMessages).toHaveLength(1)
		expect(parsed.currentTaskItem.task).toBe("Serialize me")
	})
})
