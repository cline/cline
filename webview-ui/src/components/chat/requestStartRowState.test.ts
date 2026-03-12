import { FileCode2Icon, SearchIcon } from "lucide-react"
import { describe, expect, it } from "vitest"
import type { ClineMessage } from "../../../../src/shared/ExtensionMessage"
import { getRequestStartRowState } from "./requestStartRowState"

const createMessage = (overrides: Partial<ClineMessage>): ClineMessage =>
	({
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "",
		...overrides,
	}) as ClineMessage

describe("getRequestStartRowState", () => {
	it("shows in-flight exploratory activities for an active api request without completed tools", () => {
		const messages: ClineMessage[] = [
			createMessage({ ts: 1, type: "say", say: "api_req_started", text: JSON.stringify({ request: "hello" }) }),
			createMessage({
				ts: 2,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "readFile", path: "src/index.ts" }),
			}),
			createMessage({
				ts: 3,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "searchFiles", path: "src", regex: "latency|stream", filePattern: "*.ts" }),
			}),
		]

		const state = getRequestStartRowState({
			message: messages[0],
			clineMessages: messages,
			cost: undefined,
			getIconByToolName: (toolName) => (toolName === "searchFiles" ? SearchIcon : FileCode2Icon),
		})

		expect(state.apiReqState).toBe("pre")
		expect(state.shouldShowActivities).toBe(true)
		expect(state.currentActivities.map((activity) => activity.text)).toEqual([
			"Reading src/index.ts...",
			'Searching "latency | stream" in src/ (*.ts)...',
		])
	})

	it("hides transient activities after completed tools exist for a finished request", () => {
		const messages: ClineMessage[] = [
			createMessage({ ts: 1, type: "say", say: "api_req_started", text: JSON.stringify({ request: "hello", cost: 0.42 }) }),
			createMessage({ ts: 2, type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", path: "src/index.ts" }) }),
		]

		const state = getRequestStartRowState({
			message: messages[0],
			clineMessages: messages,
			cost: 0.42,
			getIconByToolName: () => FileCode2Icon,
		})

		expect(state.apiReqState).toBe("final")
		expect(state.currentActivities).toEqual([])
		expect(state.shouldShowActivities).toBe(false)
	})

	it("preserves streaming thinking state until response content starts", () => {
		const message = createMessage({ ts: 1, type: "say", say: "api_req_started", text: JSON.stringify({ request: "hello" }) })

		expect(
			getRequestStartRowState({
				message,
				clineMessages: [message],
				reasoningContent: "thinking",
				responseStarted: false,
				getIconByToolName: () => FileCode2Icon,
			}).showStreamingThinking,
		).toBe(true)

		expect(
			getRequestStartRowState({
				message,
				clineMessages: [message],
				reasoningContent: "thinking",
				responseStarted: true,
				getIconByToolName: () => FileCode2Icon,
			}).showStreamingThinking,
		).toBe(false)
	})
})
