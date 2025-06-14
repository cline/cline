import { render, screen } from "@testing-library/react"
import TaskItemFooter from "../TaskItemFooter"

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

describe("TaskItemFooter", () => {
	it("renders token information", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		// Check for token counts using testids since the text is split across elements
		expect(screen.getByTestId("tokens-in-footer-compact")).toBeInTheDocument()
		expect(screen.getByTestId("tokens-out-footer-compact")).toBeInTheDocument()
	})

	it("renders cost information", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		// The component shows $0.00 for small amounts, not the exact value
		expect(screen.getByText("$0.00")).toBeInTheDocument()
	})

	it("shows action buttons", () => {
		render(<TaskItemFooter item={mockItem} variant="full" />)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("renders cache information when present", () => {
		const mockItemWithCache = {
			...mockItem,
			cacheReads: 5,
			cacheWrites: 3,
		}

		render(<TaskItemFooter item={mockItemWithCache} variant="full" />)

		// Check for cache display using testid
		expect(screen.getByTestId("cache-compact")).toBeInTheDocument()
		expect(screen.getByText("3")).toBeInTheDocument() // cache writes
		expect(screen.getByText("5")).toBeInTheDocument() // cache reads
	})

	it("does not render cache information when not present", () => {
		const mockItemWithoutCache = {
			...mockItem,
			cacheReads: 0,
			cacheWrites: 0,
		}

		render(<TaskItemFooter item={mockItemWithoutCache} variant="full" />)

		// Cache section should not be present
		expect(screen.queryByTestId("cache-compact")).not.toBeInTheDocument()
	})
})
