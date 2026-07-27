import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { MessageWithMetadata } from "@cline/llms"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	readApiConversationHistory,
	readRawUiMessages,
	readTaskHistory,
	updateLegacyTaskHistoryItem,
} from "./legacy-state-reader"
import { LEGACY_RESUME_MODEL_WARNING } from "./legacy-task-handling"
import {
	LEGACY_WRITEBACK_STATE_FILE,
	sdkSuffixToLegacyApiMessages,
	sdkSuffixToLegacyUiMessages,
	writeBackResumedLegacyTask,
} from "./legacy-task-writeback"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-legacy-writeback-"))
})

afterEach(() => {
	fs.rmSync(tempDir, { recursive: true, force: true })
})

const TASK_ID = "1784929680190"

function taskDir(): string {
	return path.join(tempDir, "tasks", TASK_ID)
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

const legacyApiHistory = [
	{ role: "user", content: [{ type: "text", text: "legacy prompt" }], ts: 1_000 },
	{ role: "assistant", content: [{ type: "text", text: "legacy answer" }], ts: 2_000 },
]

const legacyUiMessages = [
	{ ts: 1_000, type: "say", say: "task", text: "legacy prompt" },
	{ ts: 2_000, type: "say", say: "text", text: "legacy answer" },
]

function seedLegacyTask(): void {
	writeJson(path.join(taskDir(), "api_conversation_history.json"), legacyApiHistory)
	writeJson(path.join(taskDir(), "ui_messages.json"), legacyUiMessages)
	writeJson(path.join(tempDir, "state", "taskHistory.json"), [
		{ id: TASK_ID, ts: 2_000, task: "legacy prompt", tokensIn: 5, tokensOut: 7, totalCost: 0.01 },
	])
}

function sdkConversation(suffix: MessageWithMetadata[]): MessageWithMetadata[] {
	return [
		{ role: "user", content: "legacy prompt" },
		{ role: "assistant", content: "legacy answer" },
		{ role: "user", content: LEGACY_RESUME_MODEL_WARNING },
		...suffix,
	]
}

const followupSuffix: MessageWithMetadata[] = [
	{ role: "user", content: "follow-up question", ts: 10_000 },
	{ role: "assistant", content: [{ type: "text", text: "follow-up answer" }], ts: 11_000 },
]

// ---------------------------------------------------------------------------
// sdkSuffixToLegacyApiMessages
// ---------------------------------------------------------------------------

describe("sdkSuffixToLegacyApiMessages", () => {
	it("converts text messages and stamps timestamps", () => {
		const result = sdkSuffixToLegacyApiMessages(followupSuffix)

		expect(result).toEqual([
			{ role: "user", content: [{ type: "text", text: "follow-up question" }], ts: 10_000 },
			{ role: "assistant", content: [{ type: "text", text: "follow-up answer" }], ts: 11_000 },
		])
	})

	it("flattens tool_use and tool_result blocks to text so legacy XML-mode providers accept the history", () => {
		const result = sdkSuffixToLegacyApiMessages([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me check." },
					{ type: "tool_use", id: "call-1", name: "read_files", input: { files: ["src/app.ts"] } },
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "call-1", name: "read_files", content: "file body" }],
			},
		])

		expect(result).toEqual([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me check." },
					{ type: "text", text: `[Tool Use: read_files]\n${JSON.stringify({ files: ["src/app.ts"] }, null, 2)}` },
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "[Tool Result for read_files]\nfile body" }],
			},
		])
	})

	it("marks tool errors and flattens structured tool_result content", () => {
		const result = sdkSuffixToLegacyApiMessages([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						name: "run_commands",
						content: [{ type: "text", text: "command failed" }],
						is_error: true,
					},
				],
			},
		])

		expect(result).toEqual([
			{ role: "user", content: [{ type: "text", text: "[Tool Result (Error) for run_commands]\ncommand failed" }] },
		])
	})

	it("drops thinking blocks and empty messages, and merges consecutive same-role messages", () => {
		const result = sdkSuffixToLegacyApiMessages([
			{ role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }] },
			{ role: "user", content: "first" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "first" },
					{ type: "text", text: "second" },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		])
	})

	it("preserves image blocks in Anthropic base64 format", () => {
		const result = sdkSuffixToLegacyApiMessages([
			{ role: "user", content: [{ type: "image", data: "abc123", mediaType: "image/png" }] },
		])

		expect(result).toEqual([
			{
				role: "user",
				content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } }],
			},
		])
	})
})

// ---------------------------------------------------------------------------
// sdkSuffixToLegacyUiMessages
// ---------------------------------------------------------------------------

describe("sdkSuffixToLegacyUiMessages", () => {
	it("renders the first suffix user message as user_feedback, not task", () => {
		const result = sdkSuffixToLegacyUiMessages(followupSuffix, 2_000)

		expect(result[0]).toMatchObject({ type: "say", say: "user_feedback", text: "follow-up question" })
		expect(result.some((message) => message.say === "task")).toBe(false)
	})

	it("drops the synthetic trailing completion ask when the suffix did not complete", () => {
		const result = sdkSuffixToLegacyUiMessages(followupSuffix, 2_000)

		expect(result[result.length - 1]).toMatchObject({ type: "say", say: "text", text: "follow-up answer" })
		expect(result.some((message) => message.type === "ask" && message.ask === "completion_result")).toBe(false)
	})

	it("keeps the trailing completion ask when the suffix contains a completion result", () => {
		const result = sdkSuffixToLegacyUiMessages(
			[
				{ role: "user", content: "finish up", ts: 10_000 },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-1", name: "attempt_completion", input: { result: "All done" } }],
					ts: 11_000,
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call-1", name: "attempt_completion", content: "" }],
					ts: 12_000,
				},
			],
			2_000,
		)

		expect(result.some((message) => message.type === "say" && message.say === "completion_result")).toBe(true)
		expect(result[result.length - 1]).toMatchObject({ type: "ask", ask: "completion_result" })
	})

	it("stamps strictly-ascending epoch timestamps that sort after the legacy prefix", () => {
		const lastLegacyTs = 50_000
		const result = sdkSuffixToLegacyUiMessages(followupSuffix, lastLegacyTs)

		expect(result.length).toBeGreaterThan(0)
		let previous = lastLegacyTs
		for (const message of result) {
			expect(message.ts).toBeGreaterThan(previous)
			previous = message.ts
		}
	})
})

// ---------------------------------------------------------------------------
// writeBackResumedLegacyTask
// ---------------------------------------------------------------------------

describe("writeBackResumedLegacyTask", () => {
	it("skips conversations without a legacy resume boundary", () => {
		seedLegacyTask()

		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: [
				{ role: "user", content: "not a legacy task" },
				{ role: "assistant", content: "answer" },
			],
		})

		expect(outcome).toEqual({ status: "skipped", reason: "no_resume_boundary" })
		expect(readApiConversationHistory(TASK_ID, tempDir)).toEqual(legacyApiHistory)
	})

	it("skips when nothing was added after the resume boundary", () => {
		seedLegacyTask()

		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: sdkConversation([]),
		})

		expect(outcome).toEqual({ status: "skipped", reason: "no_new_messages" })
		expect(fs.existsSync(path.join(taskDir(), LEGACY_WRITEBACK_STATE_FILE))).toBe(false)
	})

	it("appends the follow-up exchange after the untouched legacy prefix", () => {
		seedLegacyTask()

		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: sdkConversation(followupSuffix),
		})

		expect(outcome).toEqual({ status: "written", apiSuffixCount: 2, uiSuffixCount: 2 })

		const apiHistory = readApiConversationHistory(TASK_ID, tempDir)
		expect(apiHistory.slice(0, 2)).toEqual(legacyApiHistory)
		expect(apiHistory.slice(2)).toEqual([
			{ role: "user", content: [{ type: "text", text: "follow-up question" }], ts: 10_000 },
			{ role: "assistant", content: [{ type: "text", text: "follow-up answer" }], ts: 11_000 },
		])

		const uiMessages = readRawUiMessages(TASK_ID, tempDir)
		expect(uiMessages.slice(0, 2)).toEqual(legacyUiMessages)
		expect(uiMessages.slice(2)).toEqual([
			expect.objectContaining({ type: "say", say: "user_feedback", text: "follow-up question" }),
			expect.objectContaining({ type: "say", say: "text", text: "follow-up answer" }),
		])
	})

	it("replaces the previously written suffix instead of duplicating it", () => {
		seedLegacyTask()

		writeBackResumedLegacyTask({ taskId: TASK_ID, dataDir: tempDir, sdkMessages: sdkConversation(followupSuffix) })

		const longerSuffix: MessageWithMetadata[] = [
			...followupSuffix,
			{ role: "user", content: "second follow-up", ts: 20_000 },
			{ role: "assistant", content: [{ type: "text", text: "second answer" }], ts: 21_000 },
		]
		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: sdkConversation(longerSuffix),
		})

		expect(outcome).toEqual({ status: "written", apiSuffixCount: 4, uiSuffixCount: 4 })
		const apiHistory = readApiConversationHistory(TASK_ID, tempDir)
		expect(apiHistory).toHaveLength(6)
		expect(apiHistory.slice(0, 2)).toEqual(legacyApiHistory)
		expect(apiHistory.filter((message) => JSON.stringify(message.content).includes("follow-up question"))).toHaveLength(1)
	})

	it("shrinks the written suffix when the SDK conversation was truncated", () => {
		seedLegacyTask()

		writeBackResumedLegacyTask({ taskId: TASK_ID, dataDir: tempDir, sdkMessages: sdkConversation(followupSuffix) })
		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: sdkConversation([]),
		})

		expect(outcome).toEqual({ status: "written", apiSuffixCount: 0, uiSuffixCount: 0 })
		expect(readApiConversationHistory(TASK_ID, tempDir)).toEqual(legacyApiHistory)
		expect(readRawUiMessages(TASK_ID, tempDir)).toEqual(legacyUiMessages)
	})

	it("refuses to touch legacy files that were modified outside the write-back", () => {
		seedLegacyTask()
		writeBackResumedLegacyTask({ taskId: TASK_ID, dataDir: tempDir, sdkMessages: sdkConversation(followupSuffix) })

		// Simulate rolling back to the legacy build and continuing the task there.
		const apiPath = path.join(taskDir(), "api_conversation_history.json")
		const modified = [...(JSON.parse(fs.readFileSync(apiPath, "utf-8")) as unknown[])]
		modified.push({ role: "user", content: [{ type: "text", text: "added on legacy build" }] })
		writeJson(apiPath, modified)

		const outcome = writeBackResumedLegacyTask({
			taskId: TASK_ID,
			dataDir: tempDir,
			sdkMessages: sdkConversation([
				...followupSuffix,
				{ role: "user", content: "post-rollback follow-up" },
				{ role: "assistant", content: "post-rollback answer" },
			]),
		})

		expect(outcome).toEqual({ status: "skipped", reason: "diverged_legacy_files" })
		const apiHistory = readApiConversationHistory(TASK_ID, tempDir)
		expect(JSON.stringify(apiHistory)).toContain("added on legacy build")
		expect(JSON.stringify(apiHistory)).not.toContain("post-rollback follow-up")
	})
})

// ---------------------------------------------------------------------------
// updateLegacyTaskHistoryItem
// ---------------------------------------------------------------------------

describe("updateLegacyTaskHistoryItem", () => {
	it("merges updated fields into the existing legacy history entry", () => {
		seedLegacyTask()

		const updated = updateLegacyTaskHistoryItem(
			{ id: TASK_ID, ts: 99_000, tokensIn: 50, tokensOut: 70, totalCost: 0.5 },
			tempDir,
		)

		expect(updated).toBe(true)
		expect(readTaskHistory(tempDir)).toEqual([
			expect.objectContaining({
				id: TASK_ID,
				task: "legacy prompt",
				ts: 99_000,
				tokensIn: 50,
				tokensOut: 70,
				totalCost: 0.5,
			}),
		])
	})

	it("returns false when the task has no legacy entry", () => {
		seedLegacyTask()

		expect(updateLegacyTaskHistoryItem({ id: "unknown-task", ts: 1 }, tempDir)).toBe(false)
	})
})
