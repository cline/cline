import { render, screen, fireEvent } from "@testing-library/react"
import { ConcurrentFileReadsExperiment } from "../ConcurrentFileReadsExperiment"

// Mock the translation hook
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock ResizeObserver which is used by the Slider component
global.ResizeObserver = jest.fn().mockImplementation(() => ({
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
}))

describe("ConcurrentFileReadsExperiment", () => {
	const mockOnEnabledChange = jest.fn()
	const mockOnMaxConcurrentFileReadsChange = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should render with disabled state", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={false}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={1}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		expect(checkbox).not.toBeChecked()

		// Slider should not be visible when disabled
		expect(screen.queryByTestId("max-concurrent-file-reads-slider")).not.toBeInTheDocument()
	})

	it("should render with enabled state", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={true}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={20}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		expect(checkbox).toBeChecked()

		// Slider should be visible when enabled
		expect(screen.getByTestId("max-concurrent-file-reads-slider")).toBeInTheDocument()
		expect(screen.getByText("20")).toBeInTheDocument()
	})

	it("should set maxConcurrentFileReads to 15 when enabling from disabled state", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={false}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={1}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		fireEvent.click(checkbox)

		expect(mockOnEnabledChange).toHaveBeenCalledWith(true)
		expect(mockOnMaxConcurrentFileReadsChange).toHaveBeenCalledWith(15)
	})

	it("should set maxConcurrentFileReads to 1 when disabling", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={true}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={25}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		fireEvent.click(checkbox)

		expect(mockOnEnabledChange).toHaveBeenCalledWith(false)
		expect(mockOnMaxConcurrentFileReadsChange).toHaveBeenCalledWith(1)
	})

	it("should not change maxConcurrentFileReads when enabling if already > 1", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={false}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={30}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		fireEvent.click(checkbox)

		expect(mockOnEnabledChange).toHaveBeenCalledWith(true)
		// Should not call onMaxConcurrentFileReadsChange since value is already > 1
		expect(mockOnMaxConcurrentFileReadsChange).not.toHaveBeenCalled()
	})

	it("should update value when slider changes", () => {
		// Since the Slider component doesn't render a standard input,
		// we'll test the component's interaction through its props
		const { rerender } = render(
			<ConcurrentFileReadsExperiment
				enabled={true}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={15}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		// Verify initial value is displayed
		expect(screen.getByText("15")).toBeInTheDocument()

		// Simulate the slider change by re-rendering with new value
		rerender(
			<ConcurrentFileReadsExperiment
				enabled={true}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={50}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		// Verify new value is displayed
		expect(screen.getByText("50")).toBeInTheDocument()
	})

	it("should display minimum value of 2 when maxConcurrentFileReads is less than 2", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={true}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={1}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		// Should display 2 (minimum value) instead of 1
		expect(screen.getByText("2")).toBeInTheDocument()
	})

	it("should set maxConcurrentFileReads to 15 when enabling with value of 0", () => {
		render(
			<ConcurrentFileReadsExperiment
				enabled={false}
				onEnabledChange={mockOnEnabledChange}
				maxConcurrentFileReads={0}
				onMaxConcurrentFileReadsChange={mockOnMaxConcurrentFileReadsChange}
			/>,
		)

		const checkbox = screen.getByTestId("concurrent-file-reads-checkbox")
		fireEvent.click(checkbox)

		expect(mockOnEnabledChange).toHaveBeenCalledWith(true)
		expect(mockOnMaxConcurrentFileReadsChange).toHaveBeenCalledWith(15)
	})
})
