import type { ClineMessage } from "@shared/ExtensionMessage"
import { convertClineMessageToProto, convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import { describe, expect, it } from "vitest"
import type { PendingResponse } from "../types/chatTypes"
import { isPendingResponseUnconfirmed, withPendingUserMessage } from "./pendingResponse"

const pending: PendingResponse = { id: 1, turnStateSeq: 7, messageCount: 2 }

describe("isPendingResponseUnconfirmed", () => {
	it("stays pending while the backend TurnState is unchanged", () => {
		expect(isPendingResponseUnconfirmed(pending, { phase: "completed", seq: 7 }, 2)).toBe(true)
	})

	it("retires on any fresher TurnState so terminal failures cannot leave a forced loader", () => {
		expect(isPendingResponseUnconfirmed(pending, { phase: "streaming", seq: 8 }, 2)).toBe(false)
		expect(isPendingResponseUnconfirmed(pending, { phase: "error", seq: 8 }, 2)).toBe(false)
	})

	it("retires when TurnState first appears after a legacy submission", () => {
		expect(isPendingResponseUnconfirmed({ ...pending, turnStateSeq: undefined }, { phase: "streaming", seq: 1 }, 2)).toBe(
			false,
		)
	})

	it("uses backend message growth as the fallback when TurnState is unavailable", () => {
		expect(isPendingResponseUnconfirmed(pending, undefined, 2)).toBe(true)
		expect(isPendingResponseUnconfirmed(pending, undefined, 3)).toBe(false)
	})
})

describe("withPendingUserMessage", () => {
	it("provides an immediate task row before the backend transcript exists", () => {
		const task: ClineMessage = { ts: 10, type: "say", say: "task", text: "new task", partial: false }

		expect(withPendingUserMessage([], { afterTs: 0, message: task })).toEqual([task])
	})

	it("replaces the optimistic task with its backend confirmation without duplication", () => {
		const optimistic: ClineMessage = { ts: 10, type: "say", say: "task", text: "new task", partial: false }
		const confirmed: ClineMessage = { ...optimistic, ts: 11 }

		expect(withPendingUserMessage([confirmed], { afterTs: 0, message: optimistic })).toEqual([confirmed])
	})

	it("replaces an attachment-only follow-up when its echo arrives over the partial-message stream", () => {
		const message: ClineMessage = {
			ts: 2,
			type: "say",
			say: "user_feedback",
			text: "",
			images: ["data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="],
		}
		const pending = { afterTs: 1, message }
		const confirmed = convertProtoToClineMessage(convertClineMessageToProto({ ...message, ts: 3 }))

		expect(withPendingUserMessage([confirmed], pending)).toEqual([confirmed])
	})

	it("keeps a pending attachment when a different or older message arrives", () => {
		const message: ClineMessage = { ts: 2, type: "say", say: "user_feedback", text: "", images: ["first.png"] }
		const pending = { afterTs: 1, message }
		for (const other of [
			{ ts: 1 },
			{ images: [] },
			{ images: ["second.png"] },
			{ files: ["notes.md"] },
			{ text: "a caption" },
			{ say: "text" as const },
		]) {
			const row = convertProtoToClineMessage(convertClineMessageToProto({ ...message, ts: 3, ...other }))
			expect(withPendingUserMessage([row], pending)).toEqual([row, message])
		}
	})

	it("keeps a follow-up bubble until the matching backend message arrives", () => {
		const task: ClineMessage = { ts: 1, type: "say", say: "task", text: "task" }
		const followup: ClineMessage = { ts: 3, type: "say", say: "user_feedback", text: "more" }

		expect(withPendingUserMessage([task], { afterTs: 1, message: followup })).toEqual([task, followup])
	})

	it("treats a task row as confirmation of a follow-up bubble that restarted the task", () => {
		const followup: ClineMessage = { ts: 3, type: "say", say: "user_feedback", text: "revised prompt" }
		const restarted: ClineMessage = { ts: 4, type: "say", say: "task", text: "revised prompt" }

		expect(withPendingUserMessage([restarted], { afterTs: 2, message: followup })).toEqual([restarted])
	})
})
