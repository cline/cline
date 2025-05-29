// npx jest src/components/settings/__tests__/ContextManagementSettings.test.ts

import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"

import { ContextManagementSettings } from "@src/components/settings/ContextManagementSettings"

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

// Mock translation hook to return the key as the translation
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock vscode utilities - this is necessary since we're not in a VSCode environment
import { vscode } from "@/utils/vscode"

jest.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

describe("ContextManagementSettings", () => {
	const defaultProps = {
		autoCondenseContext: true,
		autoCondenseContextPercent: 100,
		listApiConfigMeta: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		showRooIgnoredFiles: false,
		setCachedStateField: jest.fn(),
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders all controls", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		// Open tabs context limit
		const openTabsSlider = screen.getByTestId("open-tabs-limit-slider")
		expect(openTabsSlider).toBeInTheDocument()

		// Workspace files limit
		const workspaceFilesSlider = screen.getByTestId("workspace-files-limit-slider")
		expect(workspaceFilesSlider).toBeInTheDocument()

		// Show .rooignore'd files
		const showRooIgnoredFilesCheckbox = screen.getByTestId("show-rooignored-files-checkbox")
		expect(showRooIgnoredFilesCheckbox).toBeInTheDocument()
		expect(screen.getByTestId("show-rooignored-files-checkbox")).not.toBeChecked()
	})

	it("updates open tabs context limit", () => {
		const mockSetCachedStateField = jest.fn()
		const props = { ...defaultProps, setCachedStateField: mockSetCachedStateField }
		render(<ContextManagementSettings {...props} />)

		const slider = screen.getByTestId("open-tabs-limit-slider")
		expect(slider).toBeInTheDocument()

		// Check that the current value is displayed
		expect(screen.getByText("20")).toBeInTheDocument()

		// Test slider interaction using keyboard events (ArrowRight increases value)
		slider.focus()
		fireEvent.keyDown(slider, { key: "ArrowRight" })

		// The callback should have been called with the new value (20 + 1 = 21)
		expect(mockSetCachedStateField).toHaveBeenCalledWith("maxOpenTabsContext", 21)
	})

	it("updates workspace files limit", () => {
		const mockSetCachedStateField = jest.fn()
		const props = { ...defaultProps, setCachedStateField: mockSetCachedStateField }
		render(<ContextManagementSettings {...props} />)

		const slider = screen.getByTestId("workspace-files-limit-slider")
		expect(slider).toBeInTheDocument()

		// Check that the current value is displayed
		expect(screen.getByText("200")).toBeInTheDocument()

		// Test slider interaction using keyboard events (ArrowRight increases value)
		slider.focus()
		fireEvent.keyDown(slider, { key: "ArrowRight" })

		// The callback should have been called with the new value (200 + 1 = 201)
		expect(mockSetCachedStateField).toHaveBeenCalledWith("maxWorkspaceFiles", 201)
	})

	it("updates show rooignored files setting", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const checkbox = screen.getByTestId("show-rooignored-files-checkbox")
		fireEvent.click(checkbox)

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("showRooIgnoredFiles", true)
	})

	it("renders max read file line controls", () => {
		const propsWithMaxReadFileLine = {
			...defaultProps,
			maxReadFileLine: 500,
		}
		render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

		// Max read file line input
		const maxReadFileInput = screen.getByTestId("max-read-file-line-input")
		expect(maxReadFileInput).toBeInTheDocument()
		expect(maxReadFileInput).toHaveValue(500)

		// Always full read checkbox
		const alwaysFullReadCheckbox = screen.getByTestId("max-read-file-always-full-checkbox")
		expect(alwaysFullReadCheckbox).toBeInTheDocument()
		expect(alwaysFullReadCheckbox).not.toBeChecked()
	})

	it("updates max read file line setting", () => {
		const propsWithMaxReadFileLine = {
			...defaultProps,
			maxReadFileLine: 500,
		}
		render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

		const input = screen.getByTestId("max-read-file-line-input")
		fireEvent.change(input, { target: { value: "1000" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("maxReadFileLine", 1000)
	})

	it("toggles always full read setting", () => {
		const propsWithMaxReadFileLine = {
			...defaultProps,
			maxReadFileLine: 500,
		}
		render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

		const checkbox = screen.getByTestId("max-read-file-always-full-checkbox")
		fireEvent.click(checkbox)

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("maxReadFileLine", -1)
	})

	it("renders with autoCondenseContext enabled", () => {
		const propsWithAutoCondense = {
			...defaultProps,
			autoCondenseContext: true,
			autoCondenseContextPercent: 75,
			condensingApiConfigId: "test-config",
			customCondensingPrompt: "Test prompt",
		}
		render(<ContextManagementSettings {...propsWithAutoCondense} />)

		// Should render the auto condense section
		// Should render the auto condense section
		const autoCondenseCheckbox = screen.getByTestId("auto-condense-context-checkbox")
		expect(autoCondenseCheckbox).toBeInTheDocument()

		// Should render the slider with correct value
		const slider = screen.getByTestId("auto-condense-percent-slider")
		expect(slider).toBeInTheDocument()

		// Should render the API config select
		const apiSelect = screen.getByRole("combobox")
		expect(apiSelect).toBeInTheDocument()

		// Should render the custom prompt textarea
		const textarea = screen.getByRole("textbox")
		expect(textarea).toBeInTheDocument()
	})

	describe("Auto Condense Context functionality", () => {
		const autoCondenseProps = {
			...defaultProps,
			autoCondenseContext: true,
			autoCondenseContextPercent: 75,
			condensingApiConfigId: "test-config",
			customCondensingPrompt: "Custom test prompt",
			listApiConfigMeta: [
				{ id: "config-1", name: "Config 1" },
				{ id: "config-2", name: "Config 2" },
			],
		}

		it("toggles auto condense context setting", () => {
			const mockSetCachedStateField = jest.fn()
			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			const { rerender } = render(<ContextManagementSettings {...props} />)

			const checkbox = screen.getByTestId("auto-condense-context-checkbox")
			expect(checkbox).toBeChecked()

			// Toggle off
			fireEvent.click(checkbox)
			expect(mockSetCachedStateField).toHaveBeenCalledWith("autoCondenseContext", false)

			// Re-render with updated props to simulate the state change
			rerender(<ContextManagementSettings {...props} autoCondenseContext={false} />)

			// Additional settings should not be visible when disabled
			expect(screen.queryByTestId("auto-condense-percent-slider")).not.toBeInTheDocument()
			expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
			expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
		})

		it("shows additional settings when auto condense is enabled", () => {
			render(<ContextManagementSettings {...autoCondenseProps} />)

			// Additional settings should be visible
			expect(screen.getByTestId("auto-condense-percent-slider")).toBeInTheDocument()
			expect(screen.getByRole("combobox")).toBeInTheDocument()
			expect(screen.getByRole("textbox")).toBeInTheDocument()
		})

		it("hides additional settings when auto condense is disabled", () => {
			const props = { ...autoCondenseProps, autoCondenseContext: false }
			render(<ContextManagementSettings {...props} />)

			// Additional settings should not be visible
			expect(screen.queryByTestId("auto-condense-percent-slider")).not.toBeInTheDocument()
			expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
			expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
		})

		it("updates auto condense context percent", () => {
			const mockSetCachedStateField = jest.fn()
			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			// Find the auto condense percent slider
			const slider = screen.getByTestId("auto-condense-percent-slider")

			// Test slider interaction
			slider.focus()
			fireEvent.keyDown(slider, { key: "ArrowRight" })

			expect(mockSetCachedStateField).toHaveBeenCalledWith("autoCondenseContextPercent", 76)
		})

		it("displays correct auto condense context percent value", () => {
			render(<ContextManagementSettings {...autoCondenseProps} />)
			expect(screen.getByText("75%")).toBeInTheDocument()
		})

		it("updates condensing API configuration", () => {
			const mockSetCachedStateField = jest.fn()
			const mockPostMessage = jest.fn()
			const postMessageSpy = jest.spyOn(vscode, "postMessage")
			postMessageSpy.mockImplementation(mockPostMessage)

			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			const apiSelect = screen.getByRole("combobox")
			fireEvent.click(apiSelect)

			const configOption = screen.getByText("Config 1")
			fireEvent.click(configOption)

			expect(mockSetCachedStateField).toHaveBeenCalledWith("condensingApiConfigId", "config-1")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "condensingApiConfigId",
				text: "config-1",
			})
		})

		it("handles selecting default config option", () => {
			const mockSetCachedStateField = jest.fn()
			const mockPostMessage = jest.fn()
			const postMessageSpy = jest.spyOn(vscode, "postMessage")
			postMessageSpy.mockImplementation(mockPostMessage)

			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			// Test selecting default config
			const apiSelect = screen.getByRole("combobox")
			fireEvent.click(apiSelect)
			const defaultOption = screen.getByText(
				"settings:contextManagement.condensingApiConfiguration.useCurrentConfig",
			)
			fireEvent.click(defaultOption)

			expect(mockSetCachedStateField).toHaveBeenCalledWith("condensingApiConfigId", "")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "condensingApiConfigId",
				text: "",
			})
		})

		it("updates custom condensing prompt", () => {
			const mockSetCachedStateField = jest.fn()
			const mockPostMessage = jest.fn()
			const postMessageSpy = jest.spyOn(vscode, "postMessage")
			postMessageSpy.mockImplementation(mockPostMessage)

			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			const textarea = screen.getByRole("textbox")
			const newPrompt = "Updated custom prompt"
			fireEvent.change(textarea, { target: { value: newPrompt } })

			expect(mockSetCachedStateField).toHaveBeenCalledWith("customCondensingPrompt", newPrompt)
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "updateCondensingPrompt",
				text: newPrompt,
			})
		})

		it("resets custom condensing prompt to default", () => {
			const mockSetCachedStateField = jest.fn()
			const mockPostMessage = jest.fn()
			const postMessageSpy = jest.spyOn(vscode, "postMessage")
			postMessageSpy.mockImplementation(mockPostMessage)

			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			const resetButton = screen.getByRole("button", {
				name: "settings:contextManagement.customCondensingPrompt.reset",
			})
			fireEvent.click(resetButton)

			// Should reset to the default SUMMARY_PROMPT
			expect(mockSetCachedStateField).toHaveBeenCalledWith(
				"customCondensingPrompt",
				expect.stringContaining("Your task is to create a detailed summary"),
			)
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "updateCondensingPrompt",
				text: expect.stringContaining("Your task is to create a detailed summary"),
			})
		})

		it("uses default prompt when customCondensingPrompt is undefined", () => {
			const propsWithoutCustomPrompt = {
				...autoCondenseProps,
				customCondensingPrompt: undefined,
			}
			render(<ContextManagementSettings {...propsWithoutCustomPrompt} />)

			const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
			// The textarea should contain the full default SUMMARY_PROMPT
			expect(textarea.value).toContain("Your task is to create a detailed summary")
		})
	})

	describe("Edge cases and validation", () => {
		it("handles invalid max read file line input", () => {
			const mockSetCachedStateField = jest.fn()
			const propsWithMaxReadFileLine = {
				...defaultProps,
				maxReadFileLine: 500,
				setCachedStateField: mockSetCachedStateField,
			}
			render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

			const input = screen.getByTestId("max-read-file-line-input")

			// Test invalid input (non-numeric)
			fireEvent.change(input, { target: { value: "abc" } })
			expect(mockSetCachedStateField).not.toHaveBeenCalled()

			// Test negative value below -1
			fireEvent.change(input, { target: { value: "-5" } })
			expect(mockSetCachedStateField).not.toHaveBeenCalled()

			// Test valid input
			fireEvent.change(input, { target: { value: "1000" } })
			expect(mockSetCachedStateField).toHaveBeenCalledWith("maxReadFileLine", 1000)
		})

		it("selects input text on click", () => {
			const propsWithMaxReadFileLine = {
				...defaultProps,
				maxReadFileLine: 500,
			}
			render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

			const input = screen.getByTestId("max-read-file-line-input") as HTMLInputElement
			const selectSpy = jest.spyOn(input, "select")

			fireEvent.click(input)
			expect(selectSpy).toHaveBeenCalled()
		})

		it("disables max read file input when always full read is checked", () => {
			const propsWithAlwaysFullRead = {
				...defaultProps,
				maxReadFileLine: -1,
			}
			render(<ContextManagementSettings {...propsWithAlwaysFullRead} />)

			const input = screen.getByTestId("max-read-file-line-input")
			expect(input).toBeDisabled()

			const checkbox = screen.getByTestId("max-read-file-always-full-checkbox")
			expect(checkbox).toBeChecked()
		})

		it("handles boundary values for sliders", () => {
			const mockSetCachedStateField = jest.fn()
			const props = {
				...defaultProps,
				maxOpenTabsContext: 0,
				maxWorkspaceFiles: 500,
				setCachedStateField: mockSetCachedStateField,
			}
			render(<ContextManagementSettings {...props} />)

			// Check boundary values are displayed
			expect(screen.getByText("0")).toBeInTheDocument() // min open tabs
			expect(screen.getByText("500")).toBeInTheDocument() // max workspace files
		})

		it("handles undefined optional props gracefully", () => {
			const propsWithUndefined = {
				...defaultProps,
				showRooIgnoredFiles: undefined,
				maxReadFileLine: undefined,
				condensingApiConfigId: undefined,
				customCondensingPrompt: undefined,
			}

			expect(() => {
				render(<ContextManagementSettings {...propsWithUndefined} />)
			}).not.toThrow()

			// Should use default values
			expect(screen.getByText("20")).toBeInTheDocument() // default maxOpenTabsContext
			expect(screen.getByText("200")).toBeInTheDocument() // default maxWorkspaceFiles
		})
	})

	describe("Conditional rendering", () => {
		it("does not render auto condense section when autoCondenseContext is false", () => {
			const propsWithoutAutoCondense = {
				...defaultProps,
				autoCondenseContext: false,
			}
			render(<ContextManagementSettings {...propsWithoutAutoCondense} />)

			expect(screen.queryByText("settings:experimental.autoCondenseContextPercent.label")).not.toBeInTheDocument()
			expect(screen.queryByText("settings:experimental.condensingApiConfiguration.label")).not.toBeInTheDocument()
			expect(screen.queryByText("settings:experimental.customCondensingPrompt.label")).not.toBeInTheDocument()
		})

		it("renders max read file controls with default value when maxReadFileLine is undefined", () => {
			const propsWithoutMaxReadFile = {
				...defaultProps,
				maxReadFileLine: undefined,
			}
			render(<ContextManagementSettings {...propsWithoutMaxReadFile} />)

			// Controls should still be rendered with default value of -1
			const input = screen.getByTestId("max-read-file-line-input")
			const checkbox = screen.getByTestId("max-read-file-always-full-checkbox")

			expect(input).toBeInTheDocument()
			expect(input).toHaveValue(-1)
			expect(input).not.toBeDisabled() // Input is not disabled when maxReadFileLine is undefined (only when explicitly set to -1)
			expect(checkbox).toBeInTheDocument()
			expect(checkbox).not.toBeChecked() // Checkbox is not checked when maxReadFileLine is undefined (only when explicitly set to -1)
		})
	})

	describe("Accessibility", () => {
		it("has proper labels and descriptions", () => {
			render(<ContextManagementSettings {...defaultProps} />)

			// Check that labels are present
			expect(screen.getByText("settings:contextManagement.openTabs.label")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.workspaceFiles.label")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.rooignore.label")).toBeInTheDocument()

			// Check that descriptions are present
			expect(screen.getByText("settings:contextManagement.openTabs.description")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.workspaceFiles.description")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.rooignore.description")).toBeInTheDocument()
		})

		it("has proper test ids for all interactive elements", () => {
			const propsWithMaxReadFile = {
				...defaultProps,
				maxReadFileLine: 500,
			}
			render(<ContextManagementSettings {...propsWithMaxReadFile} />)

			expect(screen.getByTestId("open-tabs-limit-slider")).toBeInTheDocument()
			expect(screen.getByTestId("workspace-files-limit-slider")).toBeInTheDocument()
			expect(screen.getByTestId("show-rooignored-files-checkbox")).toBeInTheDocument()
			expect(screen.getByTestId("max-read-file-line-input")).toBeInTheDocument()
			expect(screen.getByTestId("max-read-file-always-full-checkbox")).toBeInTheDocument()
		})
	})

	describe("Integration with translation system", () => {
		it("uses translation keys for all text content", () => {
			render(<ContextManagementSettings {...defaultProps} />)

			// Verify that translation keys are being used (mocked to return the key)
			expect(screen.getByText("settings:sections.contextManagement")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.description")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.openTabs.label")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.workspaceFiles.label")).toBeInTheDocument()
			expect(screen.getByText("settings:contextManagement.rooignore.label")).toBeInTheDocument()
		})
	})
})
