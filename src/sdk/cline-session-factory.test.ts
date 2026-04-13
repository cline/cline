import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { CoreSessionConfig } from "@clinebot/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	buildResumeSessionInput,
	buildStartSessionInput,
	createHistoryItemFromSession,
	getHistoryItemById,
	updateHistoryItem,
} from "./cline-session-factory"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-session-factory-"))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function makeBaseConfig(overrides: Partial<CoreSessionConfig> = {}): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "test-key",
		cwd: "/tmp/workspace",
		workspaceRoot: "/tmp/workspace",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// buildStartSessionInput
// ---------------------------------------------------------------------------

describe("buildStartSessionInput", () => {
	it("builds input with prompt", () => {
		const config = makeBaseConfig()
		const input = {
			prompt: "Hello, world!",
			cwd: "/tmp/workspace",
		}

		const result = buildStartSessionInput(config, input)

		expect(result.config).toBe(config)
		expect(result.prompt).toBe("Hello, world!")
		expect(result.interactive).toBe(true)
		expect(result.userImages).toBeUndefined()
		expect(result.userFiles).toBeUndefined()
	})

	it("includes images and files when provided", () => {
		const config = makeBaseConfig()
		const input = {
			prompt: "Look at this",
			images: ["image1.png", "image2.jpg"],
			files: ["file1.ts"],
			cwd: "/tmp/workspace",
		}

		const result = buildStartSessionInput(config, input)

		expect(result.userImages).toEqual(["image1.png", "image2.jpg"])
		expect(result.userFiles).toEqual(["file1.ts"])
	})

	it("always sets interactive to true", () => {
		const config = makeBaseConfig()
		const input = { cwd: "/tmp/workspace" }

		const result = buildStartSessionInput(config, input)

		expect(result.interactive).toBe(true)
	})

	it("handles undefined prompt", () => {
		const config = makeBaseConfig()
		const input = { cwd: "/tmp/workspace" }

		const result = buildStartSessionInput(config, input)

		expect(result.prompt).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// buildResumeSessionInput
// ---------------------------------------------------------------------------

describe("buildResumeSessionInput", () => {
	it("builds resume input with session ID and prompt", () => {
		const result = buildResumeSessionInput("session-123", "Continue the task")

		expect(result.sessionId).toBe("session-123")
		expect(result.prompt).toBe("Continue the task")
		expect(result.userImages).toBeUndefined()
		expect(result.userFiles).toBeUndefined()
	})

	it("includes images and files when provided", () => {
		const result = buildResumeSessionInput("session-123", "Look at this", ["img.png"], ["file.ts"])

		expect(result.userImages).toEqual(["img.png"])
		expect(result.userFiles).toEqual(["file.ts"])
	})
})

// ---------------------------------------------------------------------------
// createHistoryItemFromSession
// ---------------------------------------------------------------------------

describe("createHistoryItemFromSession", () => {
	it("creates a HistoryItem from session data", () => {
		const item = createHistoryItemFromSession(
			"session-abc",
			"Fix the bug in main.ts",
			"claude-sonnet-4-6",
			"/home/user/project",
		)

		expect(item.id).toBe("session-abc")
		expect(item.task).toBe("Fix the bug in main.ts")
		expect(item.modelId).toBe("claude-sonnet-4-6")
		expect(item.cwdOnTaskInitialization).toBe("/home/user/project")
		expect(item.tokensIn).toBe(0)
		expect(item.tokensOut).toBe(0)
		expect(item.totalCost).toBe(0)
		expect(item.ts).toBeGreaterThan(0)
	})

	it("handles missing optional fields", () => {
		const item = createHistoryItemFromSession("session-xyz", "Simple task")

		expect(item.modelId).toBeUndefined()
		expect(item.cwdOnTaskInitialization).toBeUndefined()
	})

	it("creates unique timestamps for different calls", () => {
		const item1 = createHistoryItemFromSession("s1", "Task 1")
		const item2 = createHistoryItemFromSession("s2", "Task 2")

		// Timestamps should be at least as large (may be same if called in same ms)
		expect(item2.ts).toBeGreaterThanOrEqual(item1.ts)
	})
})

// ---------------------------------------------------------------------------
// getHistoryItemById
// ---------------------------------------------------------------------------

describe("getHistoryItemById", () => {
	it("returns undefined when task is not found", () => {
		const result = getHistoryItemById("nonexistent", tempDir)
		expect(result).toBeUndefined()
	})

	it("finds a task by ID", () => {
		const history = [
			{ id: "task-1", ts: Date.now(), task: "First task", tokensIn: 0, tokensOut: 0, totalCost: 0 },
			{ id: "task-2", ts: Date.now(), task: "Second task", tokensIn: 0, tokensOut: 0, totalCost: 0 },
		]
		writeJson(path.join(tempDir, "state", "taskHistory.json"), history)

		const result = getHistoryItemById("task-2", tempDir)
		expect(result).toBeDefined()
		expect(result?.id).toBe("task-2")
		expect(result?.task).toBe("Second task")
	})

	it("returns undefined for empty history", () => {
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [])

		const result = getHistoryItemById("task-1", tempDir)
		expect(result).toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// updateHistoryItem
// ---------------------------------------------------------------------------

describe("updateHistoryItem", () => {
	it("adds a new item to history", () => {
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [])

		const newItem: import("@shared/HistoryItem").HistoryItem = {
			id: "task-new",
			ts: Date.now(),
			task: "New task",
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.01,
		}

		const result = updateHistoryItem(newItem, tempDir)
		expect(result).toHaveLength(1)
		expect(result[0].id).toBe("task-new")
	})

	it("updates an existing item in history", () => {
		const existingItem = {
			id: "task-1",
			ts: Date.now(),
			task: "Original task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [existingItem])

		const updatedItem = {
			...existingItem,
			tokensIn: 500,
			tokensOut: 250,
			totalCost: 0.05,
		}

		const result = updateHistoryItem(updatedItem, tempDir)
		expect(result).toHaveLength(1)
		expect(result[0].tokensIn).toBe(500)
		expect(result[0].totalCost).toBe(0.05)
	})

	it("prepends new items to the beginning of history", () => {
		const existingItem = {
			id: "task-old",
			ts: Date.now() - 1000,
			task: "Old task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [existingItem])

		const newItem = {
			id: "task-new",
			ts: Date.now(),
			task: "New task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}

		const result = updateHistoryItem(newItem, tempDir)
		expect(result).toHaveLength(2)
		expect(result[0].id).toBe("task-new")
		expect(result[1].id).toBe("task-old")
	})
})
