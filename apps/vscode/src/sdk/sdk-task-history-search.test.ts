import type { SessionHistoryRecord } from "@cline/core"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SdkTaskHistorySearch } from "./sdk-task-history-search"
import type { SdkTaskHistory } from "./sdk-task-history"

function makeSessionRecord(id: string, overrides: Partial<SessionHistoryRecord> = {}): SessionHistoryRecord {
	return {
		sessionId: id,
		source: "vscode",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "completed",
		interactive: true,
		provider: "anthropic",
		model: "claude-test",
		cwd: "/repo",
		workspaceRoot: "/repo",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		isSubagent: false,
		prompt: id,
		metadata: { title: "Fix login bug" },
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	}
}

describe("SdkTaskHistorySearch", () => {
	let dataDir: string

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "cline-search-test-"))
		process.env.CLINE_DB_DATA_DIR = dataDir
	})

	afterEach(() => {
		delete process.env.CLINE_DB_DATA_DIR
		rmSync(dataDir, { recursive: true, force: true })
	})

	it("returns no results for an empty query without starting the index", async () => {
		const listHistory = vi.fn(async () => [])
		const getSearchableMessages = vi.fn(async () => [])
		const search = new SdkTaskHistorySearch({
			listHistory,
			getSearchableMessages,
		} as unknown as SdkTaskHistory)

		const results = await search.search("   ")

		expect(results).toEqual([])
		expect(listHistory).not.toHaveBeenCalled()
	})

	it("finds a task by content that only appears in its messages, not its title", async () => {
		const record = makeSessionRecord("task-1")
		const listHistory = vi.fn(async () => [record])
		const getSearchableMessages = vi.fn(async () => [
			{ role: "user", content: "fix login bug" },
			{ role: "assistant", content: [{ type: "text", text: "The token refresh logic was expiring sessions early." }] },
		])
		const search = new SdkTaskHistorySearch({
			listHistory,
			getSearchableMessages,
		} as unknown as SdkTaskHistory)

		const results = await search.search("token refresh")

		expect(results).toHaveLength(1)
		expect(results[0].sessionId).toBe("task-1")
		expect(getSearchableMessages).toHaveBeenCalledWith("task-1")
	})
})
