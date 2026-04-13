import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DiskStateAdapter } from "../disk-state-adapter"

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, "fixtures")

function readFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8")
}

/** Create an isolated temp directory that mimics ~/.cline/data/ */
function createTempDataDir(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))
	const dataDir = path.join(tmp, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	return dataDir
}

/** Write a JSON file at the given path, creating parent dirs as needed. */
function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiskStateAdapter", () => {
	let dataDir: string
	let reader: DiskStateAdapter

	beforeEach(() => {
		dataDir = createTempDataDir()
		reader = new DiskStateAdapter({ dataDir })
	})

	afterEach(() => {
		// Clean up temp directory
		fs.rmSync(path.dirname(dataDir), { recursive: true, force: true })
	})

	// =====================================================================
	// Global State
	// =====================================================================

	describe("readGlobalState", () => {
		it("reads provider and model from globalState.json", () => {
			const fixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), fixture)

			const state = reader.readGlobalState()

			expect(state.apiProvider).toBe("anthropic")
			expect(state.apiModelId).toBe("claude-sonnet-4-20250514")
		})

		it("reads plan/act mode settings", () => {
			const fixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), fixture)

			const state = reader.readGlobalState()

			expect(state.mode).toBe("act")
			expect(state.planModeApiProvider).toBe("openrouter")
			expect(state.planModeApiModelId).toBe("google/gemini-2.5-pro")
			expect(state.actModeApiProvider).toBe("anthropic")
			expect(state.planActSeparateModelsSetting).toBe(true)
		})

		it("reads custom instructions", () => {
			const fixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), fixture)

			const state = reader.readGlobalState()

			expect(state.customInstructions).toBe("Always use TypeScript strict mode.")
		})

		it("returns empty object when globalState.json is missing", () => {
			const state = reader.readGlobalState()
			expect(state).toEqual({})
		})

		it("returns empty object when globalState.json is corrupt", () => {
			fs.writeFileSync(path.join(dataDir, "globalState.json"), "NOT VALID JSON {{{", "utf-8")

			const state = reader.readGlobalState()
			expect(state).toEqual({})
		})

		it("returns empty object when globalState.json has trailing garbage", () => {
			// This is a known failure mode (see migration.md discussion about trailing }s)
			fs.writeFileSync(path.join(dataDir, "globalState.json"), '{"apiProvider":"anthropic"}}}', "utf-8")

			const state = reader.readGlobalState()
			expect(state).toEqual({})
		})

		it("preserves unknown keys for round-tripping", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				apiProvider: "anthropic",
				someCustomKey: "custom-value",
				nestedObj: { a: 1 },
			})

			const state = reader.readGlobalState()

			expect(state.apiProvider).toBe("anthropic")
			expect(state["someCustomKey"]).toBe("custom-value")
			expect(state["nestedObj"]).toEqual({ a: 1 })
		})
	})

	// =====================================================================
	// Secrets
	// =====================================================================

	describe("readSecrets", () => {
		it("reads API keys from secrets.json", () => {
			const fixture = JSON.parse(readFixture("sample-secrets.json"))
			writeJson(path.join(dataDir, "secrets.json"), fixture)

			const secrets = reader.readSecrets()

			expect(secrets.apiKey).toBe("sk-ant-test-fake-key-000000000000000000000000000000000000000")
			expect(secrets.openRouterApiKey).toBe("sk-or-test-fake-key-000000000000000000000000000000")
			expect(secrets.openAiApiKey).toBe("sk-test-fake-openai-key-0000000000000000000000000000")
		})

		it("returns empty object when secrets.json is missing", () => {
			const secrets = reader.readSecrets()
			expect(secrets).toEqual({})
		})

		it("returns empty object when secrets.json is corrupt", () => {
			fs.writeFileSync(path.join(dataDir, "secrets.json"), "CORRUPT DATA", "utf-8")

			const secrets = reader.readSecrets()
			expect(secrets).toEqual({})
		})
	})

	// =====================================================================
	// Task History
	// =====================================================================

	describe("readTaskHistory", () => {
		it("reads from state/taskHistory.json (canonical location)", () => {
			const fixture = JSON.parse(readFixture("taskHistory.json"))
			writeJson(path.join(dataDir, "state", "taskHistory.json"), fixture)

			const history = reader.readTaskHistory()

			expect(history).toHaveLength(3)
			expect(history[0].id).toBe("task-from-file-001")
			expect(history[0].task).toBe("Refactor the database layer")
			expect(history[0].tokensIn).toBe(25000)
			expect(history[1].isFavorited).toBe(true)
			expect(history[2].id).toBe("task-from-file-003")
		})

		it("falls back to globalState.json when taskHistory.json is missing", () => {
			const fixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), fixture)
			// Don't write state/taskHistory.json

			const history = reader.readTaskHistory()

			expect(history).toHaveLength(2)
			expect(history[0].id).toBe("test-task-001")
			expect(history[1].id).toBe("test-task-002")
		})

		it("prefers state/taskHistory.json over globalState.json", () => {
			// Both locations have data — canonical file should win
			const gsFixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), gsFixture)

			const fileFixture = JSON.parse(readFixture("taskHistory.json"))
			writeJson(path.join(dataDir, "state", "taskHistory.json"), fileFixture)

			const history = reader.readTaskHistory()

			expect(history).toHaveLength(3)
			expect(history[0].id).toBe("task-from-file-001")
		})

		it("returns empty array when no history exists", () => {
			const history = reader.readTaskHistory()
			expect(history).toEqual([])
		})

		it("returns empty array when taskHistory.json is corrupt", () => {
			fs.mkdirSync(path.join(dataDir, "state"), { recursive: true })
			fs.writeFileSync(path.join(dataDir, "state", "taskHistory.json"), "BAD JSON", "utf-8")

			// And no fallback in globalState either
			const history = reader.readTaskHistory()
			expect(history).toEqual([])
		})

		it("falls back to globalState when taskHistory.json is empty array", () => {
			writeJson(path.join(dataDir, "state", "taskHistory.json"), [])

			const gsFixture = JSON.parse(readFixture("globalState.json"))
			writeJson(path.join(dataDir, "globalState.json"), gsFixture)

			const history = reader.readTaskHistory()

			expect(history).toHaveLength(2)
			expect(history[0].id).toBe("test-task-001")
		})
	})

	// =====================================================================
	// Per-Task Data
	// =====================================================================

	describe("per-task data", () => {
		const taskId = "test-task-abc"

		it("reads API conversation history for a task", () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
			]
			writeJson(path.join(dataDir, "tasks", taskId, "api_conversation_history.json"), messages)

			const result = reader.readApiConversationHistory(taskId)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ role: "user", content: "Hello" })
		})

		it("reads UI messages from ui_messages.json", () => {
			const messages = [
				{ ts: 1700000000, type: "say", say: "task", text: "Fix bug" },
				{ ts: 1700000001, type: "say", say: "text", text: "On it!" },
			]
			writeJson(path.join(dataDir, "tasks", taskId, "ui_messages.json"), messages)

			const result = reader.readUiMessages(taskId)

			expect(result).toHaveLength(2)
			expect((result[0] as any).say).toBe("task")
		})

		it("falls back to claude_messages.json for old tasks", () => {
			const messages = [{ ts: 1700000000, type: "say", say: "task", text: "Old task" }]
			writeJson(path.join(dataDir, "tasks", taskId, "claude_messages.json"), messages)

			const result = reader.readUiMessages(taskId)

			expect(result).toHaveLength(1)
			expect((result[0] as any).text).toBe("Old task")
		})

		it("prefers ui_messages.json over claude_messages.json", () => {
			writeJson(path.join(dataDir, "tasks", taskId, "ui_messages.json"), [{ new: true }])
			writeJson(path.join(dataDir, "tasks", taskId, "claude_messages.json"), [{ old: true }])

			const result = reader.readUiMessages(taskId)

			expect(result).toHaveLength(1)
			expect((result[0] as any).new).toBe(true)
		})

		it("returns empty arrays for non-existent tasks", () => {
			expect(reader.readApiConversationHistory("nonexistent")).toEqual([])
			expect(reader.readUiMessages("nonexistent")).toEqual([])
		})

		it("taskExists returns true for existing task directories", () => {
			fs.mkdirSync(path.join(dataDir, "tasks", taskId), { recursive: true })

			expect(reader.taskExists(taskId)).toBe(true)
		})

		it("taskExists returns false for non-existent tasks", () => {
			expect(reader.taskExists("nonexistent")).toBe(false)
		})

		it("listTaskIds returns sorted task directory names", () => {
			fs.mkdirSync(path.join(dataDir, "tasks", "zzz-task"), { recursive: true })
			fs.mkdirSync(path.join(dataDir, "tasks", "aaa-task"), { recursive: true })
			fs.mkdirSync(path.join(dataDir, "tasks", "mmm-task"), { recursive: true })
			// Also create a file (should be excluded)
			fs.writeFileSync(path.join(dataDir, "tasks", "not-a-dir.json"), "{}", "utf-8")

			const ids = reader.listTaskIds()

			expect(ids).toEqual(["aaa-task", "mmm-task", "zzz-task"])
		})

		it("listTaskIds returns empty array when tasks directory is missing", () => {
			expect(reader.listTaskIds()).toEqual([])
		})
	})

	// =====================================================================
	// Auto-Approval Settings
	// =====================================================================

	describe("readAutoApprovalSettings", () => {
		it("reads structured auto-approval settings", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				autoApprovalSettings: {
					version: 3,
					enabled: true,
					favorites: ["fav1"],
					maxRequests: 50,
					actions: {
						readFiles: true,
						editFiles: true,
						executeSafeCommands: true,
						executeAllCommands: true,
						useBrowser: false,
						useMcp: true,
					},
					enableNotifications: true,
				},
			})

			const settings = reader.readAutoApprovalSettings()

			expect(settings.version).toBe(3)
			expect(settings.maxRequests).toBe(50)
			expect(settings.actions.editFiles).toBe(true)
			expect(settings.actions.executeAllCommands).toBe(true)
			expect(settings.enableNotifications).toBe(true)
		})

		it("merges older top-level boolean flags with structured settings", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowBrowser: true,
				alwaysAllowMcp: false,
				autoApprovalSettings: {
					version: 1,
					enabled: true,
					favorites: [],
					maxRequests: 20,
					actions: {
						readFiles: false, // Will be overridden by alwaysAllowReadOnly
						editFiles: false, // Will be overridden by alwaysAllowWrite
						useBrowser: false, // Will be overridden by alwaysAllowBrowser
						useMcp: true, // Will be overridden by alwaysAllowMcp
					},
					enableNotifications: false,
				},
			})

			const settings = reader.readAutoApprovalSettings()

			// Older top-level booleans should override structured settings
			expect(settings.actions.readFiles).toBe(true)
			expect(settings.actions.editFiles).toBe(true)
			expect(settings.actions.useBrowser).toBe(true)
			expect(settings.actions.useMcp).toBe(false)
		})

		it("returns defaults when no settings exist", () => {
			const settings = reader.readAutoApprovalSettings()

			expect(settings.version).toBe(1)
			expect(settings.enabled).toBe(true)
			expect(settings.actions.readFiles).toBe(true)
			expect(settings.actions.editFiles).toBe(false)
			expect(settings.actions.executeSafeCommands).toBe(true)
			expect(settings.actions.executeAllCommands).toBe(false)
			expect(settings.enableNotifications).toBe(false)
		})
	})

	// =====================================================================
	// Convenience Methods
	// =====================================================================

	describe("convenience methods", () => {
		it("getProvider returns provider from globalState", () => {
			writeJson(path.join(dataDir, "globalState.json"), { apiProvider: "openrouter" })

			expect(reader.getProvider()).toBe("openrouter")
		})

		it("getProvider defaults to anthropic when missing", () => {
			expect(reader.getProvider()).toBe("anthropic")
		})

		it("getModelId returns model from globalState", () => {
			writeJson(path.join(dataDir, "globalState.json"), { apiModelId: "gpt-4o" })

			expect(reader.getModelId()).toBe("gpt-4o")
		})

		it("getModelId returns undefined when missing", () => {
			expect(reader.getModelId()).toBeUndefined()
		})

		it("getSecret returns a specific API key", () => {
			writeJson(path.join(dataDir, "secrets.json"), {
				apiKey: "sk-ant-test",
				openRouterApiKey: "sk-or-test",
			})

			expect(reader.getSecret("apiKey")).toBe("sk-ant-test")
			expect(reader.getSecret("openRouterApiKey")).toBe("sk-or-test")
			expect(reader.getSecret("geminiApiKey")).toBeUndefined()
		})

		it("getMode returns mode from globalState", () => {
			writeJson(path.join(dataDir, "globalState.json"), { mode: "plan" })

			expect(reader.getMode()).toBe("plan")
		})

		it("getMode defaults to act", () => {
			expect(reader.getMode()).toBe("act")
		})

		it("getMode defaults to act for invalid values", () => {
			writeJson(path.join(dataDir, "globalState.json"), { mode: "invalid" })

			expect(reader.getMode()).toBe("act")
		})

		it("getCustomInstructions returns instructions", () => {
			writeJson(path.join(dataDir, "globalState.json"), {
				customInstructions: "Use tabs not spaces",
			})

			expect(reader.getCustomInstructions()).toBe("Use tabs not spaces")
		})

		it("getCustomInstructions returns undefined when not set", () => {
			expect(reader.getCustomInstructions()).toBeUndefined()
		})
	})

	// =====================================================================
	// MCP Settings
	// =====================================================================

	describe("readMcpSettings", () => {
		it("reads MCP settings from settings directory", () => {
			const fixture = JSON.parse(readFixture("sample-mcp-settings.json"))
			writeJson(path.join(dataDir, "settings", "cline_mcp_settings.json"), fixture)

			const settings = reader.readMcpSettings()

			expect(settings).not.toBeNull()
			expect(settings!.mcpServers).toBeDefined()
			const servers = settings!.mcpServers as Record<string, unknown>
			expect(Object.keys(servers)).toContain("filesystem")
			expect(Object.keys(servers)).toContain("github")
		})

		it("returns null when MCP settings file is missing", () => {
			expect(reader.readMcpSettings()).toBeNull()
		})
	})

	// =====================================================================
	// Constructor options
	// =====================================================================

	describe("constructor options", () => {
		it("accepts dataDir option directly", () => {
			const customReader = new DiskStateAdapter({ dataDir })
			writeJson(path.join(dataDir, "globalState.json"), { apiProvider: "bedrock" })

			expect(customReader.getProvider()).toBe("bedrock")
		})

		it("derives dataDir from clineDir option", () => {
			const clineDir = path.dirname(dataDir) // parent of data/
			// Ensure that inside clineDir/data the file exists
			writeJson(path.join(clineDir, "data", "globalState.json"), { apiProvider: "gemini" })

			const customReader = new DiskStateAdapter({ clineDir })

			expect(customReader.dataDir).toBe(path.join(clineDir, "data"))
			expect(customReader.getProvider()).toBe("gemini")
		})
	})
})
