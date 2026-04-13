import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	listTaskIds,
	type McpSettingsFile,
	readAllLegacyState,
	readApiConversationHistory,
	readContextHistory,
	readGlobalState,
	readGlobalStateKey,
	readMcpSettings,
	readSecretKey,
	readSecrets,
	readTaskHistory,
	readTaskMetadata,
	readUiMessages,
	resolveDataDir,
} from "./legacy-state-reader"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-legacy-state-"))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// resolveDataDir
// ---------------------------------------------------------------------------

describe("resolveDataDir", () => {
	it("uses override when provided", () => {
		expect(resolveDataDir("/custom/path")).toBe("/custom/path")
	})

	it("falls back to CLINE_DATA_DIR env", () => {
		const original = process.env.CLINE_DATA_DIR
		process.env.CLINE_DATA_DIR = "/env/data"
		try {
			expect(resolveDataDir()).toBe("/env/data")
		} finally {
			process.env.CLINE_DATA_DIR = original
		}
	})

	it("falls back to CLINE_DIR/data", () => {
		const originalData = process.env.CLINE_DATA_DIR
		const originalDir = process.env.CLINE_DIR
		delete process.env.CLINE_DATA_DIR
		process.env.CLINE_DIR = "/cline"
		try {
			expect(resolveDataDir()).toBe("/cline/data")
		} finally {
			process.env.CLINE_DATA_DIR = originalData
			process.env.CLINE_DIR = originalDir
		}
	})

	it("falls back to ~/.cline/data", () => {
		const originalData = process.env.CLINE_DATA_DIR
		const originalDir = process.env.CLINE_DIR
		delete process.env.CLINE_DATA_DIR
		delete process.env.CLINE_DIR
		try {
			expect(resolveDataDir()).toBe(path.join(os.homedir(), ".cline", "data"))
		} finally {
			process.env.CLINE_DATA_DIR = originalData
			process.env.CLINE_DIR = originalDir
		}
	})
})

// ---------------------------------------------------------------------------
// readGlobalState
// ---------------------------------------------------------------------------

describe("readGlobalState", () => {
	it("returns empty object when file is missing", () => {
		expect(readGlobalState(tempDir)).toEqual({})
	})

	it("reads globalState.json contents", () => {
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			telemetrySetting: "enabled",
		})

		const state = readGlobalState(tempDir)
		expect(state.mode).toBe("act")
		expect(state.actModeApiProvider).toBe("anthropic")
		expect(state.actModeApiModelId).toBe("claude-sonnet-4-6")
		expect(state.telemetrySetting).toBe("enabled")
	})

	it("returns empty object for corrupt JSON", () => {
		const filePath = path.join(tempDir, "globalState.json")
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "NOT VALID JSON{{{")

		expect(readGlobalState(tempDir)).toEqual({})
	})

	it("returns empty object for empty file", () => {
		const filePath = path.join(tempDir, "globalState.json")
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "")

		expect(readGlobalState(tempDir)).toEqual({})
	})

	it("returns empty object for {} file", () => {
		writeJson(path.join(tempDir, "globalState.json"), {})

		expect(readGlobalState(tempDir)).toEqual({})
	})
})

// ---------------------------------------------------------------------------
// readGlobalStateKey
// ---------------------------------------------------------------------------

describe("readGlobalStateKey", () => {
	it("returns undefined for missing key", () => {
		writeJson(path.join(tempDir, "globalState.json"), { mode: "act" })
		expect(readGlobalStateKey("telemetrySetting", tempDir)).toBeUndefined()
	})

	it("returns value for present key", () => {
		writeJson(path.join(tempDir, "globalState.json"), { mode: "plan" })
		expect(readGlobalStateKey("mode", tempDir)).toBe("plan")
	})
})

// ---------------------------------------------------------------------------
// readSecrets
// ---------------------------------------------------------------------------

describe("readSecrets", () => {
	it("returns empty object when file is missing", () => {
		expect(readSecrets(tempDir)).toEqual({})
	})

	it("reads secrets.json contents", () => {
		writeJson(path.join(tempDir, "secrets.json"), {
			apiKey: "sk-ant-test123",
			openRouterApiKey: "sk-or-test456",
		})

		const secrets = readSecrets(tempDir)
		expect(secrets.apiKey).toBe("sk-ant-test123")
		expect(secrets.openRouterApiKey).toBe("sk-or-test456")
	})

	it("returns empty object for corrupt JSON", () => {
		const filePath = path.join(tempDir, "secrets.json")
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "BROKEN{")

		expect(readSecrets(tempDir)).toEqual({})
	})
})

// ---------------------------------------------------------------------------
// readSecretKey
// ---------------------------------------------------------------------------

describe("readSecretKey", () => {
	it("returns undefined for missing key", () => {
		writeJson(path.join(tempDir, "secrets.json"), { apiKey: "test" })
		expect(readSecretKey("openRouterApiKey", tempDir)).toBeUndefined()
	})

	it("returns value for present key", () => {
		writeJson(path.join(tempDir, "secrets.json"), { apiKey: "sk-test" })
		expect(readSecretKey("apiKey", tempDir)).toBe("sk-test")
	})
})

// ---------------------------------------------------------------------------
// readTaskHistory
// ---------------------------------------------------------------------------

describe("readTaskHistory", () => {
	it("returns empty array when file is missing", () => {
		expect(readTaskHistory(tempDir)).toEqual([])
	})

	it("reads taskHistory.json from state/ subdirectory", () => {
		const history = [
			{
				id: "task-1",
				ts: Date.now(),
				task: "Hello world",
				tokensIn: 100,
				tokensOut: 50,
				totalCost: 0.01,
			},
			{
				id: "task-2",
				ts: Date.now() + 1000,
				task: "Second task",
				tokensIn: 200,
				tokensOut: 100,
				totalCost: 0.02,
				isFavorited: true,
			},
		]
		writeJson(path.join(tempDir, "state", "taskHistory.json"), history)

		const result = readTaskHistory(tempDir)
		expect(result).toHaveLength(2)
		expect(result[0].id).toBe("task-1")
		expect(result[1].isFavorited).toBe(true)
	})

	it("returns empty array for corrupt JSON", () => {
		const filePath = path.join(tempDir, "state", "taskHistory.json")
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		fs.writeFileSync(filePath, "INVALID")

		expect(readTaskHistory(tempDir)).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// readApiConversationHistory
// ---------------------------------------------------------------------------

describe("readApiConversationHistory", () => {
	it("returns empty array when file is missing", () => {
		expect(readApiConversationHistory("task-1", tempDir)).toEqual([])
	})

	it("reads api_conversation_history.json", () => {
		const history = [
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hi there" }] },
		]
		writeJson(path.join(tempDir, "tasks", "task-1", "api_conversation_history.json"), history)

		const result = readApiConversationHistory("task-1", tempDir)
		expect(result).toHaveLength(2)
		expect(result[0].role).toBe("user")
		expect(result[1].role).toBe("assistant")
	})
})

// ---------------------------------------------------------------------------
// readUiMessages
// ---------------------------------------------------------------------------

describe("readUiMessages", () => {
	it("returns empty array when file is missing", () => {
		expect(readUiMessages("task-1", tempDir)).toEqual([])
	})

	it("reads ui_messages.json", () => {
		const messages = [
			{ type: "say", say: "text", text: "Hello" },
			{ type: "ask", ask: "tool", text: "Run command?" },
		]
		writeJson(path.join(tempDir, "tasks", "task-1", "ui_messages.json"), messages)

		const result = readUiMessages("task-1", tempDir)
		expect(result).toHaveLength(2)
	})
})

// ---------------------------------------------------------------------------
// readContextHistory
// ---------------------------------------------------------------------------

describe("readContextHistory", () => {
	it("returns empty array when file is missing", () => {
		expect(readContextHistory("task-1", tempDir)).toEqual([])
	})

	it("reads context_history.json", () => {
		const history = [{ context: "test" }]
		writeJson(path.join(tempDir, "tasks", "task-1", "context_history.json"), history)

		const result = readContextHistory("task-1", tempDir)
		expect(result).toHaveLength(1)
	})
})

// ---------------------------------------------------------------------------
// readTaskMetadata
// ---------------------------------------------------------------------------

describe("readTaskMetadata", () => {
	it("returns empty object when file is missing", () => {
		expect(readTaskMetadata("task-1", tempDir)).toEqual({})
	})

	it("reads task_metadata.json", () => {
		const metadata = { files_in_context: ["src/index.ts"], model_usage: [] }
		writeJson(path.join(tempDir, "tasks", "task-1", "task_metadata.json"), metadata)

		const result = readTaskMetadata("task-1", tempDir)
		expect(result.files_in_context).toEqual(["src/index.ts"])
	})
})

// ---------------------------------------------------------------------------
// readMcpSettings
// ---------------------------------------------------------------------------

describe("readMcpSettings", () => {
	it("returns empty mcpServers when file is missing", () => {
		expect(readMcpSettings(tempDir)).toEqual({ mcpServers: {} })
	})

	it("reads cline_mcp_settings.json from settings/ subdirectory", () => {
		const settings: McpSettingsFile = {
			mcpServers: {
				"my-server": {
					command: "node",
					args: ["server.js"],
					env: { API_KEY: "test" },
				},
				"remote-server": {
					url: "https://mcp.example.com/sse",
					transport: "sse",
					disabled: true,
				},
			},
		}
		writeJson(path.join(tempDir, "settings", "cline_mcp_settings.json"), settings)

		const result = readMcpSettings(tempDir)
		expect(Object.keys(result.mcpServers)).toHaveLength(2)
		expect(result.mcpServers["my-server"].command).toBe("node")
		expect(result.mcpServers["remote-server"].url).toBe("https://mcp.example.com/sse")
		expect(result.mcpServers["remote-server"].disabled).toBe(true)
	})

	it("returns empty mcpServers for corrupt JSON", () => {
		const filePath = path.join(tempDir, "settings", "cline_mcp_settings.json")
		fs.mkdirSync(path.dirname(filePath), { recursive: true })
		fs.writeFileSync(filePath, "NOT JSON")

		expect(readMcpSettings(tempDir)).toEqual({ mcpServers: {} })
	})
})

// ---------------------------------------------------------------------------
// listTaskIds
// ---------------------------------------------------------------------------

describe("listTaskIds", () => {
	it("returns empty array when tasks directory is missing", () => {
		expect(listTaskIds(tempDir)).toEqual([])
	})

	it("lists task directories", () => {
		fs.mkdirSync(path.join(tempDir, "tasks", "task-1"), { recursive: true })
		fs.mkdirSync(path.join(tempDir, "tasks", "task-2"), { recursive: true })
		// Create a file — should not be listed
		fs.writeFileSync(path.join(tempDir, "tasks", "not-a-dir.txt"), "test")

		const ids = listTaskIds(tempDir)
		expect(ids).toContain("task-1")
		expect(ids).toContain("task-2")
		expect(ids).not.toContain("not-a-dir.txt")
	})
})

// ---------------------------------------------------------------------------
// readAllLegacyState
// ---------------------------------------------------------------------------

describe("readAllLegacyState", () => {
	it("returns defaults when no files exist", () => {
		const state = readAllLegacyState(tempDir)
		expect(state.globalState).toEqual({})
		expect(state.secrets).toEqual({})
		expect(state.taskHistory).toEqual([])
		expect(state.mcpSettings).toEqual({ mcpServers: {} })
	})

	it("reads all state files at once", () => {
		// Write all the files
		writeJson(path.join(tempDir, "globalState.json"), {
			mode: "act",
			actModeApiProvider: "anthropic",
		})
		writeJson(path.join(tempDir, "secrets.json"), {
			apiKey: "sk-ant-test",
		})
		writeJson(path.join(tempDir, "state", "taskHistory.json"), [
			{ id: "task-1", ts: Date.now(), task: "Test", tokensIn: 0, tokensOut: 0, totalCost: 0 },
		])
		writeJson(path.join(tempDir, "settings", "cline_mcp_settings.json"), {
			mcpServers: {
				"test-server": { command: "node", args: ["mcp.js"] },
			},
		})

		const state = readAllLegacyState(tempDir)
		expect(state.globalState.mode).toBe("act")
		expect(state.globalState.actModeApiProvider).toBe("anthropic")
		expect(state.secrets.apiKey).toBe("sk-ant-test")
		expect(state.taskHistory).toHaveLength(1)
		expect(state.taskHistory[0].id).toBe("task-1")
		expect(state.mcpSettings.mcpServers["test-server"].command).toBe("node")
	})

	it("handles partial state (some files missing)", () => {
		// Only write globalState
		writeJson(path.join(tempDir, "globalState.json"), { mode: "plan" })

		const state = readAllLegacyState(tempDir)
		expect(state.globalState.mode).toBe("plan")
		expect(state.secrets).toEqual({})
		expect(state.taskHistory).toEqual([])
		expect(state.mcpSettings).toEqual({ mcpServers: {} })
	})
})

// ---------------------------------------------------------------------------
// Error handling edge cases
// ---------------------------------------------------------------------------

describe("error handling", () => {
	it("handles unreadable files gracefully", () => {
		const filePath = path.join(tempDir, "globalState.json")
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "valid json initially")
		// Make file unreadable (on POSIX)
		if (process.platform !== "win32") {
			fs.chmodSync(filePath, 0o000)
			// Should not throw, returns fallback
			expect(readGlobalState(tempDir)).toEqual({})
			// Restore permissions for cleanup
			fs.chmodSync(filePath, 0o644)
		}
	})

	it("handles whitespace-only files", () => {
		const filePath = path.join(tempDir, "globalState.json")
		fs.mkdirSync(tempDir, { recursive: true })
		fs.writeFileSync(filePath, "   \n  \t  ")

		expect(readGlobalState(tempDir)).toEqual({})
	})
})
