import { render, screen } from "@testing-library/react"
import TaskItemHeader from "../TaskItemHeader"

jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockItem = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

describe("TaskItemHeader", () => {
	it("renders date information", () => {
		render(<TaskItemHeader item={mockItem} isSelectionMode={false} onDelete={jest.fn()} />)

		// TaskItemHeader shows the formatted date, not the task text
		expect(screen.getByText(/\w+ \d{1,2}, \d{1,2}:\d{2} \w{2}/)).toBeInTheDocument() // Date format like "JUNE 14, 10:15 AM"
	})

	it("shows delete button when not in selection mode", () => {
		render(<TaskItemHeader item={mockItem} isSelectionMode={false} onDelete={jest.fn()} />)

		expect(screen.getByRole("button")).toBeInTheDocument()
	})
})
