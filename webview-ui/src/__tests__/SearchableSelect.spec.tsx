import React from "react"
import { render, screen, act, cleanup, waitFor, within, fireEvent } from "@/utils/test-utils"
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select"
import userEvent from "@testing-library/user-event"

describe("SearchableSelect", () => {
	const mockOptions: SearchableSelectOption[] = [
		{ value: "option1", label: "Option 1" },
		{ value: "option2", label: "Option 2" },
		{ value: "option3", label: "Option 3", disabled: true },
	]

	const defaultProps = {
		options: mockOptions,
		placeholder: "Select an option",
		searchPlaceholder: "Search options...",
		emptyMessage: "No options found",
		onValueChange: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
		vi.useRealTimers()
	})

	it("renders with placeholder when no value is selected", () => {
		render(<SearchableSelect {...defaultProps} />)
		expect(screen.getByText("Select an option")).toBeInTheDocument()
	})

	it("renders with selected option label when value is provided", () => {
		render(<SearchableSelect {...defaultProps} value="option1" />)
		expect(screen.getByText("Option 1")).toBeInTheDocument()
	})

	it("opens dropdown when clicked", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		expect(screen.getByPlaceholderText("Search options...")).toBeInTheDocument()
		expect(screen.getByText("Option 1")).toBeInTheDocument()
		expect(screen.getByText("Option 2")).toBeInTheDocument()
	})

	it("filters options based on search input", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		// Verify all options are initially visible
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.getByText("Option 2")).toBeInTheDocument()
			expect(screen.getByText("Option 3")).toBeInTheDocument()
		})

		const searchInput = screen.getByPlaceholderText("Search options...")

		// Use fireEvent for cmdk input
		fireEvent.change(searchInput, { target: { value: "1" } })

		// Wait for the filtering to take effect
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.queryByText("Option 2")).not.toBeInTheDocument()
			expect(screen.queryByText("Option 3")).not.toBeInTheDocument()
		})
	})

	it("calls onValueChange when an option is selected", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const option = screen.getByText("Option 2")
		await user.click(option)

		expect(defaultProps.onValueChange).toHaveBeenCalledWith("option2")
	})

	it("does not call onValueChange when a disabled option is clicked", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const disabledOption = screen.getByText("Option 3")
		await user.click(disabledOption)

		expect(defaultProps.onValueChange).not.toHaveBeenCalled()
	})

	it("clears search value when dropdown is closed", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const searchInput = screen.getByPlaceholderText("Search options...")

		// Use fireEvent for cmdk input
		fireEvent.change(searchInput, { target: { value: "test" } })

		// Verify the search filters the options
		await waitFor(() => {
			expect(screen.queryByText("Option 1")).not.toBeInTheDocument()
			expect(screen.queryByText("Option 2")).not.toBeInTheDocument()
		})

		// Close the dropdown by clicking outside
		await user.click(document.body)

		// Wait for dropdown to close
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		})

		// Wait a bit for the timeout to clear search
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Open again to check if search was cleared
		await user.click(trigger)

		// All options should be visible again
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.getByText("Option 2")).toBeInTheDocument()
			expect(screen.getByText("Option 3")).toBeInTheDocument()
		})
	})

	it("handles component unmounting without memory leaks", async () => {
		vi.useFakeTimers()
		const { unmount, rerender } = render(<SearchableSelect {...defaultProps} value="option1" />)

		// Change the value prop to trigger the effect with timeout
		rerender(<SearchableSelect {...defaultProps} value="option2" />)

		// Immediately unmount the component before the timeout completes
		act(() => {
			unmount()
		})

		// This test ensures that no setState calls happen after unmount
		// If there was a memory leak, this would throw an error
		expect(() => {
			// Wait for any pending timeouts
			act(() => {
				vi.runAllTimers()
			})
		}).not.toThrow()
	})

	it("cleans up timeouts on unmount", () => {
		vi.useFakeTimers()
		const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
		const { unmount } = render(<SearchableSelect {...defaultProps} />)

		act(() => {
			unmount()
		})

		// Verify that clearTimeout was called during cleanup
		expect(clearTimeoutSpy).toHaveBeenCalled()
		clearTimeoutSpy.mockRestore()
	})

	it("resets search value when value prop changes", async () => {
		const user = userEvent.setup()
		const { rerender } = render(<SearchableSelect {...defaultProps} value="option1" />)

		// Open dropdown and type something
		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const searchInput = screen.getByPlaceholderText("Search options...")
		fireEvent.change(searchInput, { target: { value: "2" } })

		// Verify search is working - use within to scope to dropdown
		const dropdown = screen.getByRole("dialog")
		await waitFor(() => {
			expect(within(dropdown).queryByText("Option 1")).not.toBeInTheDocument()
			expect(within(dropdown).getByText("Option 2")).toBeInTheDocument()
		})

		// Close dropdown
		await user.click(document.body)

		// Change the value prop
		rerender(<SearchableSelect {...defaultProps} value="option2" />)

		// Wait for the component to update
		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("Option 2")
		})

		// Wait for the effect to run (100ms timeout in component)
		await new Promise((resolve) => setTimeout(resolve, 150))

		// Open dropdown again
		await user.click(trigger)

		// All options should be visible (search cleared) - use within to scope
		const newDropdown = screen.getByRole("dialog")
		await waitFor(() => {
			expect(within(newDropdown).getByText("Option 1")).toBeInTheDocument()
			expect(within(newDropdown).getByText("Option 2")).toBeInTheDocument()
			expect(within(newDropdown).getByText("Option 3")).toBeInTheDocument()
		})
	})

	it("handles rapid value changes without issues", async () => {
		const { rerender } = render(<SearchableSelect {...defaultProps} value="option1" />)

		// Rapidly change values
		rerender(<SearchableSelect {...defaultProps} value="option2" />)
		rerender(<SearchableSelect {...defaultProps} value="option3" />)
		rerender(<SearchableSelect {...defaultProps} value="option1" />)

		// Wait for the final value to be reflected
		await waitFor(() => {
			const trigger = screen.getByRole("combobox")
			expect(trigger).toHaveTextContent("Option 1")
		})

		// Component should still be functional - open dropdown
		const user = userEvent.setup()
		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		// Should be able to search
		const searchInput = screen.getByPlaceholderText("Search options...")
		fireEvent.change(searchInput, { target: { value: "2" } })

		// Check filtering works - use within to scope to dropdown
		const dropdown = screen.getByRole("dialog")
		await waitFor(() => {
			expect(within(dropdown).getByText("Option 2")).toBeInTheDocument()
			expect(within(dropdown).queryByText("Option 1")).not.toBeInTheDocument()
			expect(within(dropdown).queryByText("Option 3")).not.toBeInTheDocument()
		})
	})
})
