// npx vitest src/components/settings/__tests__/ContextManagementSettings.spec.tsx

import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { ContextManagementSettings } from "../ContextManagementSettings"

// Mock the translation hook
vi.mock("@/hooks/useAppTranslation", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			// Return specific translations for our test cases
			if (key === "settings:contextManagement.diagnostics.maxMessages.unlimitedLabel") {
				return "Unlimited"
			}
			return key
		},
	}),
}))

// Mock the UI components
vi.mock("@/components/ui", () => ({
	...vi.importActual("@/components/ui"),
	Slider: ({ value, onValueChange, "data-testid": dataTestId, disabled }: any) => (
		<input
			type="range"
			value={value?.[0] ?? 0}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
			onKeyDown={(e) => {
				const currentValue = value?.[0] ?? 0
				if (e.key === "ArrowRight") {
					onValueChange([currentValue + 1])
				} else if (e.key === "ArrowLeft") {
					onValueChange([currentValue - 1])
				}
			}}
			data-testid={dataTestId}
			disabled={disabled}
			role="slider"
		/>
	),
	Input: ({ value, onChange, "data-testid": dataTestId, ...props }: any) => (
		<input value={value} onChange={onChange} data-testid={dataTestId} {...props} />
	),
	Button: ({ children, onClick, ...props }: any) => (
		<button onClick={onClick} {...props}>
			{children}
		</button>
	),
	Select: ({ children, ...props }: any) => (
		<div role="combobox" {...props}>
			{children}
		</div>
	),
	SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	SelectValue: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	SelectContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	SelectItem: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

// Mock vscode utilities - this is necessary since we're not in a VSCode environment

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock VSCode components to behave like standard HTML elements
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children, "data-testid": dataTestId, ...props }: any) => (
		<label data-testid={dataTestId} {...props}>
			<input
				type="checkbox"
				role="checkbox"
				checked={checked || false}
				aria-checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
	VSCodeTextArea: ({ value, onChange, ...props }: any) => <textarea value={value} onChange={onChange} {...props} />,
}))

describe("ContextManagementSettings", () => {
	const defaultProps = {
		autoCondenseContext: false,
		autoCondenseContextPercent: 80,
		condensingApiConfigId: undefined,
		customCondensingPrompt: undefined,
		listApiConfigMeta: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		showRooIgnoredFiles: false,
		maxReadFileLine: -1,
		maxConcurrentFileReads: 5,
		profileThresholds: {},
		includeDiagnosticMessages: true,
		maxDiagnosticMessages: 50,
		writeDelayMs: 1000,
		setCachedStateField: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders diagnostic settings", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		// Check for diagnostic checkbox
		expect(screen.getByTestId("include-diagnostic-messages-checkbox")).toBeInTheDocument()

		// Check for slider
		expect(screen.getByTestId("max-diagnostic-messages-slider")).toBeInTheDocument()
		expect(screen.getByText("50")).toBeInTheDocument()
	})

	it("renders with diagnostic messages enabled", () => {
		render(<ContextManagementSettings {...defaultProps} includeDiagnosticMessages={true} />)

		const checkbox = screen.getByTestId("include-diagnostic-messages-checkbox")
		expect(checkbox.querySelector("input")).toBeChecked()

		const slider = screen.getByTestId("max-diagnostic-messages-slider")
		expect(slider).toBeInTheDocument()
		expect(slider).toHaveValue("50")
	})

	it("renders with diagnostic messages disabled", () => {
		render(<ContextManagementSettings {...defaultProps} includeDiagnosticMessages={false} />)

		const checkbox = screen.getByTestId("include-diagnostic-messages-checkbox")
		expect(checkbox.querySelector("input")).not.toBeChecked()

		// Slider should still be rendered when diagnostics are disabled
		expect(screen.getByTestId("max-diagnostic-messages-slider")).toBeInTheDocument()
		expect(screen.getByText("50")).toBeInTheDocument()
	})

	it("calls setCachedStateField when include diagnostic messages checkbox is toggled", async () => {
		const setCachedStateField = vi.fn()
		render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

		const checkbox = screen.getByTestId("include-diagnostic-messages-checkbox").querySelector("input")!
		fireEvent.click(checkbox)

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("includeDiagnosticMessages", false)
		})
	})

	it("calls setCachedStateField when max diagnostic messages slider is changed", async () => {
		const setCachedStateField = vi.fn()
		render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

		const slider = screen.getByTestId("max-diagnostic-messages-slider")
		fireEvent.change(slider, { target: { value: "100" } })

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", -1)
		})
	})

	it("keeps slider visible when include diagnostic messages is unchecked", () => {
		const { rerender } = render(<ContextManagementSettings {...defaultProps} includeDiagnosticMessages={true} />)

		const slider = screen.getByTestId("max-diagnostic-messages-slider")
		expect(slider).toBeInTheDocument()

		// Update to disabled - slider should still be visible
		rerender(<ContextManagementSettings {...defaultProps} includeDiagnosticMessages={false} />)
		expect(screen.getByTestId("max-diagnostic-messages-slider")).toBeInTheDocument()
	})

	it("displays correct max diagnostic messages value", () => {
		const { rerender } = render(<ContextManagementSettings {...defaultProps} maxDiagnosticMessages={25} />)

		expect(screen.getByText("25")).toBeInTheDocument()

		// Update value - 100 should display as "Unlimited"
		rerender(<ContextManagementSettings {...defaultProps} maxDiagnosticMessages={100} />)
		expect(
			screen.getByText("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel"),
		).toBeInTheDocument()

		// Test unlimited value (-1) displays as "Unlimited"
		rerender(<ContextManagementSettings {...defaultProps} maxDiagnosticMessages={-1} />)
		expect(
			screen.getByText("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel"),
		).toBeInTheDocument()
	})

	it("renders other context management settings", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		// Check for other sliders
		expect(screen.getByTestId("open-tabs-limit-slider")).toBeInTheDocument()
		expect(screen.getByTestId("workspace-files-limit-slider")).toBeInTheDocument()
		expect(screen.getByTestId("max-concurrent-file-reads-slider")).toBeInTheDocument()

		// Check for checkboxes
		expect(screen.getByTestId("show-rooignored-files-checkbox")).toBeInTheDocument()
		expect(screen.getByTestId("auto-condense-context-checkbox")).toBeInTheDocument()
	})

	describe("Edge cases for maxDiagnosticMessages", () => {
		it("handles zero value as unlimited", async () => {
			const setCachedStateField = vi.fn()
			render(
				<ContextManagementSettings
					{...defaultProps}
					maxDiagnosticMessages={0}
					setCachedStateField={setCachedStateField}
				/>,
			)

			// Zero is now treated as unlimited
			expect(
				screen.getByText("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel"),
			).toBeInTheDocument()

			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			// Zero should map to slider position 100 (unlimited)
			expect(slider).toHaveValue("100")
		})

		it("handles negative values as unlimited", async () => {
			const setCachedStateField = vi.fn()
			render(
				<ContextManagementSettings
					{...defaultProps}
					maxDiagnosticMessages={-10}
					setCachedStateField={setCachedStateField}
				/>,
			)

			// Component displays "Unlimited" for any negative value
			expect(
				screen.getByText("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel"),
			).toBeInTheDocument()

			// Slider should be at max position (100) for negative values
			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			expect(slider).toHaveValue("100")
		})

		it("handles very large numbers by capping at maximum", async () => {
			const setCachedStateField = vi.fn()
			const largeNumber = 1000
			render(
				<ContextManagementSettings
					{...defaultProps}
					maxDiagnosticMessages={largeNumber}
					setCachedStateField={setCachedStateField}
				/>,
			)

			// Should display the actual value even if it exceeds slider max
			expect(screen.getByText(largeNumber.toString())).toBeInTheDocument()

			// Slider value would be capped at max (100)
			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			expect(slider).toHaveValue("100")
		})

		it("enforces maximum value constraint", async () => {
			const setCachedStateField = vi.fn()
			render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

			const slider = screen.getByTestId("max-diagnostic-messages-slider")

			// Test that setting value above 100 gets capped
			fireEvent.change(slider, { target: { value: "150" } })

			await waitFor(() => {
				// Should be capped at 100, which maps to -1 (unlimited)
				expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", -1)
			})
		})

		it("handles boundary value at minimum (1)", async () => {
			const setCachedStateField = vi.fn()
			render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			fireEvent.change(slider, { target: { value: "1" } })

			await waitFor(() => {
				expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", 1)
			})
		})

		it("handles boundary value at maximum (100) as unlimited (-1)", async () => {
			const setCachedStateField = vi.fn()
			render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			fireEvent.change(slider, { target: { value: "100" } })

			await waitFor(() => {
				// When slider is at 100, it should set the value to -1 (unlimited)
				expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", -1)
			})
		})

		it("handles decimal values by parsing as float", async () => {
			const setCachedStateField = vi.fn()
			render(<ContextManagementSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

			const slider = screen.getByTestId("max-diagnostic-messages-slider")
			fireEvent.change(slider, { target: { value: "50.7" } })

			await waitFor(() => {
				// The mock slider component parses as float
				expect(setCachedStateField).toHaveBeenCalledWith("maxDiagnosticMessages", 50.7)
			})
		})
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
		}
		render(<ContextManagementSettings {...propsWithAutoCondense} />)

		// Should render the auto condense section
		const autoCondenseCheckbox = screen.getByTestId("auto-condense-context-checkbox")
		expect(autoCondenseCheckbox).toBeInTheDocument()

		// Should render the threshold slider with correct value
		const slider = screen.getByTestId("condense-threshold-slider")
		expect(slider).toBeInTheDocument()

		// Should render the profile select dropdown
		const selects = screen.getAllByRole("combobox")
		expect(selects).toHaveLength(1)
	})

	describe("Auto Condense Context functionality", () => {
		const autoCondenseProps = {
			...defaultProps,
			autoCondenseContext: true,
			autoCondenseContextPercent: 75,
			listApiConfigMeta: [
				{ id: "config-1", name: "Config 1" },
				{ id: "config-2", name: "Config 2" },
			],
		}

		it("toggles auto condense context setting", () => {
			const mockSetCachedStateField = vitest.fn()
			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			const checkbox = screen.getByTestId("auto-condense-context-checkbox")
			const input = checkbox.querySelector('input[type="checkbox"]')
			expect(input).toBeChecked()

			// Toggle off
			fireEvent.click(checkbox)
			expect(mockSetCachedStateField).toHaveBeenCalledWith("autoCondenseContext", false)
		})

		it("shows threshold settings when auto condense is enabled", () => {
			render(<ContextManagementSettings {...autoCondenseProps} />)

			// Threshold settings should be visible
			expect(screen.getByTestId("condense-threshold-slider")).toBeInTheDocument()
			// One combobox for profile selection
			expect(screen.getAllByRole("combobox")).toHaveLength(1)
		})

		it("updates auto condense context percent", () => {
			const mockSetCachedStateField = vitest.fn()
			const props = { ...autoCondenseProps, setCachedStateField: mockSetCachedStateField }
			render(<ContextManagementSettings {...props} />)

			// Find the condense threshold slider
			const slider = screen.getByTestId("condense-threshold-slider")

			// Test slider interaction
			slider.focus()
			fireEvent.keyDown(slider, { key: "ArrowRight" })

			expect(mockSetCachedStateField).toHaveBeenCalledWith("autoCondenseContextPercent", 76)
		})

		it("displays correct auto condense context percent value", () => {
			render(<ContextManagementSettings {...autoCondenseProps} />)
			expect(screen.getByText("75%")).toBeInTheDocument()
		})
	})

	it("renders max read file line controls with -1 value", () => {
		const propsWithMaxReadFileLine = {
			...defaultProps,
			maxReadFileLine: -1,
		}
		render(<ContextManagementSettings {...propsWithMaxReadFileLine} />)

		const checkbox = screen.getByTestId("max-read-file-always-full-checkbox")
		const input = checkbox.querySelector('input[type="checkbox"]')
		expect(input).toBeChecked()
	})

	it("handles boundary values for sliders", () => {
		const mockSetCachedStateField = vitest.fn()
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
		}

		expect(() => {
			render(<ContextManagementSettings {...propsWithUndefined} />)
		}).not.toThrow()

		// Should use default values
		expect(screen.getByText("20")).toBeInTheDocument() // default maxOpenTabsContext
		expect(screen.getByText("200")).toBeInTheDocument() // default maxWorkspaceFiles
	})

	describe("Conditional rendering", () => {
		it("does not render threshold settings when autoCondenseContext is false", () => {
			const propsWithoutAutoCondense = {
				...defaultProps,
				autoCondenseContext: false,
			}
			render(<ContextManagementSettings {...propsWithoutAutoCondense} />)

			// When auto condense is false, threshold slider should not be visible
			expect(screen.queryByTestId("condense-threshold-slider")).not.toBeInTheDocument()
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
