import { render, screen, fireEvent } from "@testing-library/react"
import HistoryView from "../HistoryView"
import { useExtensionState } from "@src/context/ExtensionStateContext"

jest.mock("@src/context/ExtensionStateContext")
jest.mock("@src/utils/vscode")
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockTaskHistory = [
	{
		id: "1",
		task: "Test task 1",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
		workspace: "/test/workspace",
	},
	{
		id: "2",
		task: "Test task 2",
		ts: Date.now() + 1000,
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.003,
		workspace: "/test/workspace",
	},
]

describe("HistoryView", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		;(useExtensionState as jest.Mock).mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/test/workspace",
		})
	})

	it("renders the history interface", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		// Check for main UI elements
		expect(screen.getByText("history:history")).toBeInTheDocument()
		expect(screen.getByText("history:done")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("history:searchPlaceholder")).toBeInTheDocument()
	})

	it("calls onDone when done button is clicked", () => {
		const onDone = jest.fn()
		render(<HistoryView onDone={onDone} />)

		const doneButton = screen.getByText("history:done")
		fireEvent.click(doneButton)

		expect(onDone).toHaveBeenCalled()
	})
})
