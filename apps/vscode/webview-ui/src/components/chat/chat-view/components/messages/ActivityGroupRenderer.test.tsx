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

const command = (ts: number): ClineMessage => ({ ts, type: "say", say: "command", text: "ls -la" })

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
}) =>
	render(
		<ActivityGroupRenderer
			expandedRows={expandedRows}
			group={group}
			isLastGroup={isLastGroup}
			onToggleExpand={onToggleExpand}
			renderItem={(item) => renderItem(item as ClineMessage)}
			turnPhase={turnPhase}
		/>,
	)

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

	it("stays open while the activity is still streaming", () => {
		const group = buildGroup([reasoning(1, true), tool(2, "readFile", "a.ts")])

		renderFold({ group, isLastGroup: true, turnPhase: "streaming" })

		expect(screen.queryAllByTestId("nested-row")).toHaveLength(2)
		expect(screen.getByRole("button", { name: /Collapse agent activities/ })).toBeInTheDocument()
	})

	it("stays open while a command inside the fold waits for approval", () => {
		const group = buildGroup([command(1)])

		renderFold({ group, isLastGroup: true, turnPhase: "awaiting_approval" })

		expect(screen.queryAllByTestId("nested-row")).toHaveLength(1)
	})

	it("collapses a fold that is open only because the agent is still working", () => {
		const group = buildGroup([command(1), tool(2, "readFile", "a.ts")])
		const key = getActivityGroupKey(group as unknown as ClineMessage[])
		const onToggleExpand = vi.fn()

		renderFold({ group, isLastGroup: true, onToggleExpand, turnPhase: "streaming" })
		expect(screen.queryAllByTestId("nested-row")).toHaveLength(2)

		fireEvent.click(screen.getByRole("button", { name: /Collapse agent activities/ }))
		expect(onToggleExpand).toHaveBeenCalledWith(key, { preserveAutoScroll: true, next: false })
	})

	it("folds the tail group away once the turn is over", () => {
		const group = buildGroup([command(1), tool(2, "readFile", "a.ts")])

		renderFold({ group, isLastGroup: true, turnPhase: "completed" })

		expect(screen.queryAllByTestId("nested-row")).toHaveLength(0)
	})
})
