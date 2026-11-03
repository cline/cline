import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getActivityGroupKey, groupAgentActivities } from "../../utils/activityFolding"
import { createMessageRenderer } from "./MessageRenderer"

const { state } = vi.hoisted(() => ({ state: { turnPhase: "idle" as TurnPhase | undefined } }))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mode: "act", turnState: state.turnPhase ? { phase: state.turnPhase, seq: 1 } : undefined }),
}))

vi.mock("@/components/chat/ChatRow", () => ({
	default: ({ message }: { message: ClineMessage }) => (
		<div data-testid={`chat-row-${message.ts}`}>{message.say ?? message.ask}</div>
	),
}))

vi.mock("./ToolGroupRenderer", () => ({
	ToolGroupRenderer: ({ isLastGroup }: { isLastGroup: boolean }) => (
		<div data-testid="tool-group">{isLastGroup ? "live" : "history"}</div>
	),
}))

const reasoning = (ts: number, partial = false): ClineMessage => ({
	ts,
	type: "say",
	say: "reasoning",
	text: "planning",
	partial,
})

const command = (ts: number): ClineMessage => ({ ts, type: "say", say: "command", text: "ls -la" })

const tool = (ts: number, toolName = "readFile", path = "a.ts"): ClineMessage => ({
	ts,
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool: toolName, path }),
})

const answer = (ts: number): ClineMessage => ({ ts, type: "say", say: "text", text: "here you go" })

const toolGroup = (messages: ClineMessage[]): ClineMessage[] => {
	const group = messages as ClineMessage[] & { _isToolGroup?: boolean }
	group._isToolGroup = true
	return group
}

/** Renders the list exactly like `MessagesArea` does (virtuoso `itemContent`). */
const renderList = ({
	messages,
	turnPhase,
	enabled = true,
	expandedRows = {},
	onToggleExpand = vi.fn(),
}: {
	messages: (ClineMessage | ClineMessage[])[]
	turnPhase?: TurnPhase
	enabled?: boolean
	expandedRows?: Record<number, boolean>
	onToggleExpand?: (ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => void
}) => {
	state.turnPhase = turnPhase
	const groupedMessages = groupAgentActivities(messages, { enabled })
	const itemContent = createMessageRenderer(
		groupedMessages,
		messages.filter((m) => !Array.isArray(m)) as ClineMessage[],
		expandedRows,
		onToggleExpand,
		vi.fn(),
		vi.fn(),
		vi.fn(),
		"",
		{} as never,
		false,
	)
	const rendered = groupedMessages.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)
	render(<div>{rendered}</div>)
	return { groupedMessages, onToggleExpand }
}

describe("createMessageRenderer with activity folding", () => {
	beforeEach(() => {
		state.turnPhase = "idle"
	})

	it("folds consecutive activities and renders assistant text as its own row", () => {
		const { groupedMessages } = renderList({
			messages: [reasoning(1), command(2), answer(3)],
			turnPhase: "idle",
		})

		expect(groupedMessages).toHaveLength(2)
		expect(screen.getByTestId("chat-row-3")).toBeInTheDocument()
		expect(screen.queryByTestId("chat-row-1")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Expand agent activities/ })).toBeInTheDocument()
	})

	it("reveals every folded row (incl. nested tool groups) when the user opens the fold", () => {
		const messages = [toolGroup([tool(1), tool(2, "searchFiles", "b.ts")]), command(3), answer(4)]
		const group = groupAgentActivities(messages)[0] as ClineMessage[]

		renderList({ expandedRows: { [getActivityGroupKey(group)]: true }, messages, turnPhase: "idle" })

		expect(screen.getByTestId("tool-group")).toBeInTheDocument()
		expect(screen.getByTestId("chat-row-3")).toBeInTheDocument()
		expect(screen.getByTestId("chat-row-4")).toBeInTheDocument()
	})

	it("marks a nested tool group as live so its running items keep rendering", () => {
		renderList({ messages: [toolGroup([tool(1)]), answer(2)], turnPhase: "streaming" })

		expect(screen.getByTestId("tool-group")).toHaveTextContent("live")
	})

	it("keeps the tail fold open while the agent is working", () => {
		renderList({ messages: [answer(1), reasoning(2), command(3)], turnPhase: "streaming" })

		expect(screen.getByTestId("chat-row-3")).toBeInTheDocument()
	})

	it("folds the tail group away once the turn is over", () => {
		renderList({ messages: [answer(1), reasoning(2), command(3)], turnPhase: "completed" })

		expect(screen.queryByTestId("chat-row-3")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Expand agent activities/ })).toBeInTheDocument()
	})

	it("toggles the fold through the shared row-expansion handler", () => {
		const messages = [reasoning(1), command(2), answer(3)]
		const group = groupAgentActivities(messages)[0] as ClineMessage[]
		const { onToggleExpand } = renderList({ messages, turnPhase: "idle" })

		fireEvent.click(screen.getByRole("button", { name: /Expand agent activities/ }))

		expect(onToggleExpand).toHaveBeenCalledWith(getActivityGroupKey(group), { preserveAutoScroll: true, next: true })
	})

	it("renders every activity as its own row when folding is switched off", () => {
		const messages = [reasoning(1), command(2), answer(3)]
		const { groupedMessages } = renderList({ enabled: false, messages, turnPhase: "idle" })

		expect(groupedMessages).toHaveLength(3)
		expect(screen.getByTestId("chat-row-1")).toBeInTheDocument()
		expect(screen.getByTestId("chat-row-2")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /agent activities/i })).not.toBeInTheDocument()
	})
})
