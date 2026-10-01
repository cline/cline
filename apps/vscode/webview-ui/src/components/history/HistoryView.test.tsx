import { type GetTaskHistoryRequest, TaskItem } from "@shared/proto/cline/task"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import type { InputHTMLAttributes, ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import HistoryView from "./HistoryView"

const { getTaskHistory, extensionState } = vi.hoisted(() => ({
	getTaskHistory: vi.fn(),
	extensionState: {
		taskHistory: [],
		totalTasksSize: 0,
		onRelinquishControl: vi.fn(() => () => {}),
		environment: "production",
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => extensionState }))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { getTaskHistory } }))
vi.mock("../common/ViewHeader", () => ({ default: () => null }))
vi.mock("./HistoryViewItem", () => ({
	default: ({ item }: { item: TaskItem }) => <div data-testid="history-task">{item.task}</div>,
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children: _children, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		onValueChange,
		value,
	}: {
		children: ReactNode
		onValueChange: (value: string) => void
		value: string
	}) => (
		<select aria-label="History sort" onChange={(event) => onValueChange(event.target.value)} value={value}>
			{children}
		</select>
	),
	SelectContent: ({ children }: { children: ReactNode }) => children,
	SelectTrigger: () => null,
	SelectItem: ({ value, disabled }: { value: string; disabled: boolean }) => (
		<option disabled={disabled} value={value}>
			{value}
		</option>
	),
}))

// Render the same group and item callbacks as Virtuoso without depending on
// viewport measurements in jsdom. This also checks that group counts align
// with their headers and the flattened task order.
vi.mock("react-virtuoso", () => ({
	GroupedVirtuoso: ({
		groupCounts,
		groupContent,
		itemContent,
		endReached,
	}: {
		groupCounts: number[]
		groupContent: (index: number) => ReactNode
		itemContent: (index: number) => ReactNode
		endReached: () => void
	}) => {
		let itemIndex = 0
		return (
			<>
				{groupCounts.map((count, groupIndex) => (
					<section data-testid="history-group" key={groupIndex}>
						<div data-testid="history-group-label">{groupContent(groupIndex)}</div>
						{Array.from({ length: count }, () => {
							const index = itemIndex++
							return <div key={index}>{itemContent(index)}</div>
						})}
					</section>
				))}
				<button onClick={endReached} type="button">
					Load more history
				</button>
			</>
		)
	},
}))

const history = [
	TaskItem.create({ id: "today-late", task: "Today late", ts: new Date(2026, 9, 2, 10).getTime(), totalCost: 1, tokensIn: 40 }),
	TaskItem.create({ id: "older-late", task: "Older late", ts: new Date(2026, 9, 1, 18).getTime(), totalCost: 2, tokensIn: 80 }),
	TaskItem.create({
		id: "today-early",
		task: "Today early",
		ts: new Date(2026, 9, 2, 8).getTime(),
		totalCost: 3,
		tokensIn: 10,
	}),
	TaskItem.create({
		id: "older-early",
		task: "Older early",
		ts: new Date(2026, 8, 30, 8).getTime(),
		totalCost: 4,
		tokensIn: 20,
	}),
]

const renderedTasks = () => screen.queryAllByTestId("history-task").map((item) => item.textContent)
const renderedGroups = () =>
	screen.queryAllByTestId("history-group").map((group) => ({
		label: within(group).getByTestId("history-group-label").textContent,
		tasks: within(group)
			.queryAllByTestId("history-task")
			.map((item) => item.textContent),
	}))

async function selectSort(sort: string) {
	await act(async () => {
		fireEvent.change(screen.getByRole("combobox", { name: "History sort" }), { target: { value: sort } })
	})
}

async function renderHistory(tasks = history) {
	getTaskHistory.mockImplementation(async () => ({ tasks: [...tasks], hasMore: false }))
	await act(async () => {
		render(<HistoryView onDone={() => {}} />)
	})
}

describe("HistoryView ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date(2026, 9, 2, 12))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("places Older before Today for Oldest, preserving ascending order within both groups", async () => {
		await renderHistory()
		await selectSort("oldest")

		expect(renderedGroups()).toEqual([
			{ label: "Older", tasks: ["Older early", "Older late"] },
			{ label: "Today", tasks: ["Today early", "Today late"] },
		])
	})

	it("places Today before Older when switching back to Newest, preserving descending order", async () => {
		await renderHistory()
		await selectSort("oldest")
		await selectSort("newest")

		expect(renderedGroups()).toEqual([
			{ label: "Today", tasks: ["Today late", "Today early"] },
			{ label: "Older", tasks: ["Older late", "Older early"] },
		])
	})

	it.each([
		{ sort: "mostExpensive", expected: ["Older early", "Today early", "Older late", "Today late"] },
		{ sort: "mostTokens", expected: ["Older late", "Today late", "Older early", "Today early"] },
	])("keeps $sort ranking ungrouped", async ({ sort, expected }) => {
		await renderHistory()
		await selectSort(sort)

		expect(renderedGroups()).toEqual([{ label: "", tasks: expected }])
	})

	it("keeps search relevance ranking ungrouped", async () => {
		const tasks = history.map((item, index) => ({
			...item,
			task: ["match detail notes extra", "match detail notes", "match detail", "match"][index],
		}))
		await renderHistory(tasks)
		await act(async () => {
			fireEvent.input(screen.getByPlaceholderText("Fuzzy search history..."), { target: { value: "match" } })
		})

		expect(screen.getByRole("combobox", { name: "History sort" })).toHaveValue("mostRelevant")
		expect(renderedGroups()).toEqual([
			{ label: "", tasks: ["match", "match detail", "match detail notes", "match detail notes extra"] },
		])
	})

	it.each([
		{ sort: "oldest", task: history[0], label: "Today" },
		{ sort: "newest", task: history[0], label: "Today" },
		{ sort: "oldest", task: history[1], label: "Older" },
		{ sort: "newest", task: history[1], label: "Older" },
	])("renders only the populated $label group with $sort", async ({ sort, task, label }) => {
		await renderHistory([task])
		await selectSort(sort)
		expect(renderedGroups()).toEqual([{ label, tasks: [task.task] }])
	})

	it.each(["oldest", "newest"])("does not render groups for empty %s history", async (sort) => {
		await renderHistory([])
		await selectSort(sort)
		expect(renderedGroups()).toEqual([])
		expect(renderedTasks()).toEqual([])
	})

	it("keeps Oldest headers and counts aligned when another page introduces Today tasks", async () => {
		getTaskHistory.mockImplementation(async ({ offset }: GetTaskHistoryRequest) => ({
			tasks: offset === 0 ? [history[1], history[3]] : [history[0]],
			hasMore: offset === 0,
		}))
		await act(async () => {
			render(<HistoryView onDone={() => {}} />)
		})
		await selectSort("oldest")
		expect(renderedGroups()).toEqual([{ label: "Older", tasks: ["Older early", "Older late"] }])
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Load more history" }))
		})

		expect(getTaskHistory).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "oldest", offset: 50 }))
		expect(renderedGroups()).toEqual([
			{ label: "Older", tasks: ["Older early", "Older late"] },
			{ label: "Today", tasks: ["Today late"] },
		])
	})
})
