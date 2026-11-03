import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { type ActivityGroup, getActivityGroupKey, groupAgentActivities } from "../../utils/activityFolding"
import { ActivityGroupRenderer } from "./ActivityGroupRenderer"

const reasoning = (ts: number, partial = false): ClineMessage => ({
	ts,
	type: "say",
	say: "reasoning",
	text: "planning the next step",
	partial,
})

const command = (ts: number, partial = false): ClineMessage => ({ ts, type: "say", say: "command", text: "ls -la", partial })

const tool = (ts: number, toolName: string, path: string): ClineMessage => ({
	ts,
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool: toolName, path }),
})

const buildGroup = (messages: ClineMessage[]): ActivityGroup => groupAgentActivities(messages)[0] as unknown as ActivityGroup

const renderItem: (item: ClineMessage) => React.ReactNode = (item) => (
	<div data-testid="nested-row">{item.say === "tool" ? JSON.parse(item.text ?? "{}").path : item.say}</div>
)

const renderFold = ({
	group,
	isLastGroup = false,
	turnPhase = "idle",
	expandedRows = {},
	onToggleExpand = vi.fn(),
}: {
	group: ActivityGroup
	isLastGroup?: boolean
	turnPhase?: "idle" | "streaming" | "awaiting_approval" | "completed"
	expandedRows?: Record<number, boolean>
	onToggleExpand?: (ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => void
}) => {
	const element = (next: ActivityGroup) => (
		<ActivityGroupRenderer
			expandedRows={expandedRows}
			group={next}
			isLastGroup={isLastGroup}
			onToggleExpand={onToggleExpand}
			renderItem={(item) => renderItem(item as ClineMessage)}
			turnPhase={turnPhase}
		/>
	)
	const result = render(element(group))
	/** Re-renders the same fold with new content, as a streaming update does. */
	return { ...result, update: (next: ActivityGroup) => result.rerender(element(next)) }
}

describe("ActivityGroupRenderer", () => {
	it("folds completed activity into a single summary line", () => {
		const group = buildGroup([reasoning(1), tool(2, "readFile", "a.ts"), command(3)])

		renderFold({ group })

		expect(screen.getByRole("button", { name: /Expand agent activities/ })).toHaveTextContent(
			"1 command · 1 file read · 1× thinking",
		)
		expect(screen.queryAllByTestId("nested-row")).toHaveLength(0)
	})

	it("reveals every action of the fold when the header is clicked", () => {
		const group = buildGroup([reasoning(1), tool(2, "readFile", "a.ts"), command(3)])
		const onToggleExpand = vi.fn()
		const key = getActivityGroupKey(group as unknown as ClineMessage[])

		renderFold({ group, onToggleExpand })
		fireEvent.click(screen.getByRole("button", { name: /Expand agent activities/ }))

		expect(onToggleExpand).toHaveBeenCalledWith(key, { preserveAutoScroll: true, next: true })
	})

	it("applies a user override and collapses an open fold", () => {
		const group = buildGroup([tool(1, "readFile", "a.ts"), command(2)])
		const key = getActivityGroupKey(group as unknown as ClineMessage[])
		const onToggleExpand = vi.fn()

		renderFold({ expandedRows: { [key]: true }, group, onToggleExpand })
		expect(screen.queryAllByTestId("nested-row")).toHaveLength(2)

		fireEvent.click(screen.getByRole("button", { name: /Collapse agent activities/ }))
		expect(onToggleExpand).toHaveBeenCalledWith(key, { preserveAutoScroll: true, next: false })
	})

	it("shows only the running action and counts the finished ones away", () => {
		const group = buildGroup([reasoning(1), tool(2, "readFile", "a.ts"), command(3, true)])

		renderFold({ group, isLastGroup: true, turnPhase: "streaming" })

		// The finished thinking block and read folded themselves away; the command is still running.
		const rows = screen.queryAllByTestId("nested-row")
		expect(rows).toHaveLength(1)
		expect(rows[0].textContent).toBe("command")

		// The header keeps the running total of the whole group, plus how much is hidden.
		const button = screen.getByRole("button", { name: /Show all agent activities/ })
		expect(button).toHaveTextContent("1 command · 1 file read · 1× thinking")
		expect(button.textContent).toContain("+2")
	})

	it("keeps a pending approval visible although it is not streaming", () => {
		const group = buildGroup([command(1), tool(2, "readFile", "a.ts")])

		renderFold({ group, isLastGroup: true, turnPhase: "awaiting_approval" })

		// An approval row is finished as content; hiding it would hide the buttons that unblock
		// the agent, so the tail stays on screen while the turn waits.
		const rows = screen.queryAllByTestId("nested-row")
		expect(rows).toHaveLength(1)
		expect(rows[0].textContent).toBe("a.ts")
	})

	it("keeps a finished action on screen while the summary line is visible", () => {
		const fold = renderFold({ group: buildGroup([command(1, true)]), isLastGroup: true, turnPhase: "streaming" })
		expect(screen.queryAllByTestId("nested-row")).toHaveLength(1)

		// The command completes. Nothing is running any more, but the reader is looking at the
		// result with the summary line on screen — taking it away would delete the text under their
		// eyes and drag the summary line back down into view.
		fold.update(buildGroup([command(1)]))

		expect(screen.queryAllByTestId("nested-row")).toHaveLength(1)
		expect(screen.getByRole("button", { name: /Show all agent activities/ })).toBeInTheDocument()
	})

	it("reveals everything from the live view", () => {
		const group = buildGroup([command(1), tool(2, "readFile", "a.ts")])
		const key = getActivityGroupKey(group as unknown as ClineMessage[])
		const onToggleExpand = vi.fn()

		// Nothing in flight: the fold is the summary line alone, even mid-turn.
		renderFold({ group, isLastGroup: true, onToggleExpand, turnPhase: "streaming" })
		expect(screen.queryAllByTestId("nested-row")).toHaveLength(0)

		fireEvent.click(screen.getByRole("button", { name: /Show all agent activities/ }))
		expect(onToggleExpand).toHaveBeenCalledWith(key, { preserveAutoScroll: true, next: true })
	})

	it("folds the tail group away once the turn is over", () => {
		const group = buildGroup([command(1), tool(2, "readFile", "a.ts")])

		renderFold({ group, isLastGroup: true, turnPhase: "completed" })

		expect(screen.queryAllByTestId("nested-row")).toHaveLength(0)
	})
})
