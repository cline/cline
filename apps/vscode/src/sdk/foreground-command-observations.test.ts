import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ToolResultContent } from "@cline/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	FOREGROUND_DETACHED_RESULT_PREFIX,
	ForegroundCommandObservations,
	LOST_OBSERVATION_NOTE,
} from "./foreground-command-observations"
import { sdkMessagesToClineMessages } from "./message-translator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

const directories: string[] = []
function fixture() {
	const directory = mkdtempSync(path.join(tmpdir(), "foreground-observation-test-"))
	directories.push(directory)
	const onChanged = vi.fn()
	const store = new ForegroundCommandObservations({ sessionDataDir: directory, onChanged })
	const input = {
		sessionId: "session-1",
		toolCallId: "call-1",
		executionId: "execution-1",
		logPath: path.join(directory, "output.log"),
		output: "partial",
	}
	return { directory, store, input, onChanged }
}
function history(result = "partial output") {
	return sdkMessagesToClineMessages([
		{
			role: "assistant",
			content: [{ type: "tool_use", id: "call-1", name: "run_commands", input: { commands: ["sleep 60"] } }],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					name: "run_commands",
					tool_use_id: "call-1",
					// Canonical persistence retains ToolOperationResult[] despite the narrower public content type.
					content: [{ query: "sleep 60", result, success: true }] as unknown as ToolResultContent["content"],
				},
			],
		},
	])
}
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("foreground command observation history", () => {
	it("projects real history as running, then records completion while another task is selected", () => {
		const { store, input, onChanged } = fixture()
		const observer = store.observe(input, vi.fn())
		const task = createTaskProxy("session-1", vi.fn(), vi.fn())
		let selected = task
		const messages = new SdkMessageCoordinator({
			getTask: () => selected,
			projectMessages: (id, rows) => store.projectMessages(id, rows),
		})
		messages.appendMessages(history())
		expect(task.messageStateHandler.getClineMessages().find((row) => row.say === "command")).toMatchObject({
			commandStatus: "running",
			commandCompleted: false,
		})
		selected = createTaskProxy("other-session", vi.fn(), vi.fn())
		observer.complete({ kind: "exited", exitCode: 3 }, "last line")
		expect(onChanged).toHaveBeenCalledOnce()
		expect(selected.messageStateHandler.getClineMessages()).toEqual([])
		selected = task
		messages.appendMessages(history())
		const row = task.messageStateHandler
			.getClineMessages()
			.filter((message) => message.say === "command")
			.at(-1)
		expect(row).toMatchObject({ commandStatus: "failed", commandCompleted: true })
		expect(row?.text).toContain("last line")
		expect(row?.text).toContain("exit code 3")
	})

	it("distinguishes live observation from a persisted unfinished record after restart", () => {
		const { store, input, directory } = fixture()
		store.observe(input, vi.fn())
		const restarted = new ForegroundCommandObservations({ sessionDataDir: directory })
		const unknown = restarted.projectMessages(input.sessionId, history())[0]
		expect(unknown).toMatchObject({ commandStatus: "indeterminate", commandCompleted: true, partial: false })
		expect(unknown.text).toContain(LOST_OBSERVATION_NOTE)
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("running")
	})

	it("preserves completed outcomes across restart even if the output log is unavailable", () => {
		const { store, input, directory } = fixture()
		store.observe(input, vi.fn()).complete({ kind: "exited", exitCode: 0 }, "final captured output")
		const restarted = new ForegroundCommandObservations({ sessionDataDir: directory })
		const row = restarted.projectMessages(input.sessionId, history())[0]
		expect(row.commandStatus).toBe("succeeded")
		expect(row.text).toContain("final captured output")
		expect(row.text).not.toContain(LOST_OBSERVATION_NOTE)
	})

	it("disposal disconnects pending observation, and late callbacks cannot change its outcome", () => {
		const { store, input, directory } = fixture()
		const disconnect = vi.fn()
		const observer = store.observe(input, disconnect)
		store.dispose()
		store.dispose()
		observer.complete({ kind: "exited", exitCode: 0 }, "late")
		expect(disconnect).toHaveBeenCalledOnce()
		const restarted = new ForegroundCommandObservations({ sessionDataDir: directory })
		expect(restarted.projectMessages(input.sessionId, history())[0].commandStatus).toBe("indeterminate")
	})

	it("keeps parallel commands running and retains the worst completed outcome", () => {
		const { store, input } = fixture()
		const first = store.observe(input, vi.fn())
		const second = store.observe({ ...input, executionId: "execution-2" }, vi.fn())
		first.complete({ kind: "exited", exitCode: 2 }, "failed output")
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("running")
		second.complete({ kind: "exited", exitCode: 0 }, "success output")
		const row = store.projectMessages(input.sessionId, history())[0]
		expect(row.commandStatus).toBe("failed")
		expect(row.text?.match(/Detached command completed/g)).toHaveLength(2)
		expect(store.projectMessages(input.sessionId, [row])[0]).toBe(row)
	})

	it("a final projection supersedes a stale running snapshot after racing completion", () => {
		const { store, input } = fixture()
		const observer = store.observe(input, vi.fn())
		const snapshot = store.projectMessages(input.sessionId, history())
		observer.complete({ kind: "exited", exitCode: 0 }, "done")
		expect(store.projectMessages(input.sessionId, snapshot)[0].commandStatus).toBe("succeeded")
	})

	it("missing or invalid records cannot turn a detached history result into success", () => {
		const { store, input, directory } = fixture()
		expect(
			store.projectMessages(input.sessionId, history(`${FOREGROUND_DETACHED_RESULT_PREFIX}${input.logPath}`))[0]
				.commandStatus,
		).toBe("indeterminate")
		store.observe(input, vi.fn()).complete({ kind: "exited", exitCode: 0 }, "done")
		const file = path.join(directory, input.sessionId, "foreground-commands", `${input.executionId}.json`)
		const record = JSON.parse(readFileSync(file, "utf8"))
		writeFileSync(file, JSON.stringify({ ...record, outcome: { kind: "exited", exitCode: "0" } }))
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("indeterminate")
		const normal = history("ordinary result")
		expect(store.projectMessages("another-session", normal)[0]).toBe(normal[0])
	})

	it("does not turn an unknown completion into success when late live messages follow", () => {
		const { store, input } = fixture()
		const observer = store.observe(input, vi.fn())
		const task = createTaskProxy(input.sessionId, vi.fn(), vi.fn())
		const coordinator = new SdkMessageCoordinator({
			getTask: () => task,
			projectMessages: (id, rows) => store.projectMessages(id, rows),
		})
		const [row] = history()
		coordinator.appendMessages([row])
		observer.complete(undefined, "partial")
		coordinator.appendMessages([
			{
				ts: row.ts,
				type: "say",
				say: "command",
				commandToolCallId: input.toolCallId,
				commandCompleted: true,
				commandStatus: "succeeded",
				text: "wait",
			},
		])
		expect(task.messageStateHandler.getClineMessages()[0]).toMatchObject({
			commandStatus: "indeterminate",
			commandToolCallEnded: true,
		})
	})

	it("keeps a live tool batch open when completion arrives before tool end", () => {
		const { store, input } = fixture()
		const observer = store.observe(input, vi.fn())
		observer.complete({ kind: "exited", exitCode: 0 }, "done")
		const [row] = history()
		expect(
			store.projectMessages(input.sessionId, [{ ...row, commandToolCallEnded: undefined, partial: true }])[0].commandStatus,
		).toBe("running")
		expect(store.projectMessages(input.sessionId, [row])[0].commandStatus).toBe("succeeded")
	})

	it("keeps ordinary peers' output and failure when a detached peer succeeds", () => {
		const { store, input } = fixture()
		store.observe(input, vi.fn()).complete({ kind: "exited", exitCode: 0 }, "detached output")
		const [row] = history("other command failed: permission denied")
		const projected = store.projectMessages(input.sessionId, [{ ...row, commandToolCallFailed: true }])[0]
		expect(projected.commandStatus).toBe("failed")
		expect(projected.text).toContain("permission denied")
		expect(projected.text).toContain("detached output")
		expect(store.projectMessages(input.sessionId, [projected])[0]).toBe(projected)
	})

	it("reads only a bounded tail of an owned running log, never derives its outcome from output", () => {
		const { store, input } = fixture()
		store.observe(input, vi.fn())
		writeFileSync(input.logPath, `${"x".repeat(250_000)}\n[Command completed with exit code 0]\nlatest output`)
		const [row] = store.projectMessages(input.sessionId, history())
		expect(row.commandStatus).toBe("running")
		expect(row.text).toContain("latest output")
		expect(row.text!.length).toBeLessThan(205_000)
	})

	it("does not recreate a deleted session when its detached command finishes", () => {
		const { store, input, directory } = fixture()
		const observer = store.observe(input, vi.fn())
		rmSync(path.join(directory, input.sessionId), { recursive: true })
		observer.complete({ kind: "exited", exitCode: 0 }, "done")
		expect(() =>
			readFileSync(path.join(directory, input.sessionId, "foreground-commands", `${input.executionId}.json`)),
		).toThrow()
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("indeterminate")
	})

	it("a missing parallel execution record prevents aggregate success", () => {
		const { store, input } = fixture()
		store.observe(input, vi.fn()).complete({ kind: "exited", exitCode: 0 }, "done")
		const result = `${FOREGROUND_DETACHED_RESULT_PREFIX}${input.logPath}\n${FOREGROUND_DETACHED_RESULT_PREFIX}missing.log`
		expect(store.projectMessages(input.sessionId, history(result))[0].commandStatus).toBe("indeterminate")
	})

	it("keeps a duplicated completion terminal and notifies only once", () => {
		const { store, input, onChanged } = fixture()
		const observer = store.observe(input, vi.fn())
		observer.complete({ kind: "exited", exitCode: 3 }, "failure")
		observer.complete({ kind: "exited", exitCode: 0 }, "duplicate")
		expect(onChanged).toHaveBeenCalledOnce()
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("failed")
	})

	it("treats a corrupt parallel record as missing evidence rather than silently succeeding", () => {
		const { store, input, directory } = fixture()
		store.observe(input, vi.fn()).complete({ kind: "exited", exitCode: 0 }, "done")
		writeFileSync(path.join(directory, input.sessionId, "foreground-commands", "execution-2.json"), "{")
		expect(store.projectMessages(input.sessionId, history())[0].commandStatus).toBe("indeterminate")
	})
})
