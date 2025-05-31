import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { Bedrock } from "../Bedrock"
import { ProviderSettings } from "@roo-code/types"

// Mock the vscrui Checkbox component
jest.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label data-testid={`checkbox-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}>
			<input
				type="checkbox"
				checked={checked}
				onChange={() => onChange(!checked)} // Toggle the checked state
				data-testid={`checkbox-input-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}
			/>
			{children}
		</label>
	),
}))

// Mock the VSCodeTextField component
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		value,
		onInput,
		placeholder,
		className,
		style,
		"data-testid": dataTestId,
		...rest
	}: any) => {
		// For all text fields - apply data-testid directly to input if provided
		return (
			<div
				data-testid={dataTestId ? `${dataTestId}-text-field` : "vscode-text-field"}
				className={className}
				style={style}>
				{children}
				<input
					type="text"
					value={value}
					onChange={(e) => onInput && onInput(e)}
					placeholder={placeholder}
					data-testid={dataTestId}
					{...rest}
				/>
			</div>
		)
	},
	VSCodeRadio: () => <div>Radio</div>,
	VSCodeRadioGroup: ({ children }: any) => <div>{children}</div>,
}))

// Mock the translation hook
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock the UI components
jest.mock("@src/components/ui", () => ({
	Select: ({ children }: any) => <div>{children}</div>,
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: () => <div>Item</div>,
	SelectTrigger: ({ children }: any) => <div>{children}</div>,
	SelectValue: () => <div>Value</div>,
}))

// Mock the constants
jest.mock("../../constants", () => ({
	AWS_REGIONS: [{ value: "us-east-1", label: "US East (N. Virginia)" }],
}))

describe("Bedrock Component", () => {
	const mockSetApiConfigurationField = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should show text field when VPC endpoint checkbox is checked", () => {
		// Initial render with checkbox unchecked
		const apiConfiguration: Partial<ProviderSettings> = {
			awsBedrockEndpoint: "",
			awsUseProfile: true, // Use profile to avoid rendering other text fields
		}

		render(
			<Bedrock
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Text field should not be visible initially
		expect(screen.queryByTestId("vpc-endpoint-input")).not.toBeInTheDocument()

		// Click the checkbox
		fireEvent.click(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint"))

		// Text field should now be visible
		expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()
	})

	it("should hide text field when VPC endpoint checkbox is unchecked", () => {
		// Initial render with checkbox checked
		const apiConfiguration: Partial<ProviderSettings> = {
			awsBedrockEndpoint: "https://example.com",
			awsBedrockEndpointEnabled: true, // Need to explicitly set this to true
			awsUseProfile: true, // Use profile to avoid rendering other text fields
		}

		render(
			<Bedrock
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Text field should be visible initially
		expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()

		// Click the checkbox to uncheck it
		fireEvent.click(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint"))

		// Text field should now be hidden
		expect(screen.queryByTestId("vpc-endpoint-input")).not.toBeInTheDocument()

		// Should call setApiConfigurationField to update the enabled flag
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpointEnabled", false)
	})

	// Test Scenario 1: Input Validation Test
	describe("Input Validation", () => {
		it("should accept valid URL formats", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Find the input field
			const inputField = screen.getByTestId("vpc-endpoint-input")
			expect(inputField).toBeInTheDocument()

			// Test with a valid URL
			fireEvent.change(inputField, { target: { value: "https://bedrock.us-east-1.amazonaws.com" } })

			// Verify the configuration field was updated with the valid URL
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"awsBedrockEndpoint",
				"https://bedrock.us-east-1.amazonaws.com",
			)
		})

		it("should handle empty URL input", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://example.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Find the input field
			const inputField = screen.getByTestId("vpc-endpoint-input")

			// Clear the field
			fireEvent.change(inputField, { target: { value: "" } })

			// Verify the configuration field was updated with empty string
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpoint", "")
		})
	})

	// Test Scenario 2: Edge Case Tests
	describe("Edge Cases", () => {
		it("should preserve endpoint URL when toggling checkbox multiple times", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://bedrock-vpc.example.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Initial state: checkbox checked, URL visible
			expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()
			expect(screen.getByTestId("vpc-endpoint-input")).toHaveValue("https://bedrock-vpc.example.com")

			// Uncheck the checkbox
			fireEvent.click(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint"))

			// Verify endpoint enabled was set to false
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpointEnabled", false)

			// Check the checkbox again
			fireEvent.click(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint"))

			// Verify endpoint enabled was set to true
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpointEnabled", true)

			// Verify the URL field is visible again
			expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()
		})

		it("should handle very long endpoint URLs", () => {
			const veryLongUrl =
				"https://bedrock-vpc-endpoint-with-a-very-long-name-that-might-cause-issues-in-some-ui-components.region-1.amazonaws.com/api/v1/endpoint"

			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: veryLongUrl,
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Verify the long URL is displayed correctly
			expect(screen.getByTestId("vpc-endpoint-input")).toHaveValue(veryLongUrl)

			// Change the URL to something else
			fireEvent.change(screen.getByTestId("vpc-endpoint-input"), {
				target: { value: "https://shorter-url.com" },
			})

			// Verify the configuration was updated
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpoint", "https://shorter-url.com")
		})
	})

	// Test Scenario 3: UI Elements Tests
	describe("UI Elements", () => {
		it("should display example URLs when VPC endpoint checkbox is checked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://example.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Check that the VPC endpoint input is visible
			expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()

			// Check for the example URLs section
			// Since we don't have a specific testid for the examples section,
			// we'll check for the text content
			expect(screen.getByText("settings:providers.awsBedrockVpc.examples")).toBeInTheDocument()
			expect(screen.getByText("• https://vpce-xxx.bedrock.region.vpce.amazonaws.com/")).toBeInTheDocument()
			expect(screen.getByText("• https://gateway.my-company.com/route/app/bedrock")).toBeInTheDocument()
		})

		it("should hide example URLs when VPC endpoint checkbox is unchecked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://example.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Initially the examples should be visible
			expect(screen.getByText("settings:providers.awsBedrockVpc.examples")).toBeInTheDocument()

			// Uncheck the VPC endpoint checkbox
			fireEvent.click(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint"))

			// Now the examples should be hidden
			expect(screen.queryByText("settings:providers.awsBedrockVpc.examples")).not.toBeInTheDocument()
			expect(screen.queryByText("• https://vpce-xxx.bedrock.region.vpce.amazonaws.com/")).not.toBeInTheDocument()
			expect(screen.queryByText("• https://gateway.my-company.com/route/app/bedrock")).not.toBeInTheDocument()
		})
	})

	// Test Scenario 4: Error Handling Tests
	describe("Error Handling", () => {
		it("should handle invalid endpoint URLs gracefully", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Find the input field
			const inputField = screen.getByTestId("vpc-endpoint-input")

			// Enter an invalid URL (missing protocol)
			fireEvent.change(inputField, { target: { value: "invalid-url" } })

			// The component should still update the configuration
			// (URL validation would typically happen at a higher level or when used)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("awsBedrockEndpoint", "invalid-url")
		})
	})

	// Test Scenario 5: Persistence Tests
	describe("Persistence", () => {
		it("should initialize with the correct state from apiConfiguration", () => {
			// Test with endpoint enabled
			const apiConfigurationEnabled: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://custom-endpoint.aws.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			const { unmount } = render(
				<Bedrock
					apiConfiguration={apiConfigurationEnabled as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Verify checkbox is checked and endpoint is visible
			expect(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint")).toBeChecked()
			expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()
			expect(screen.getByTestId("vpc-endpoint-input")).toHaveValue("https://custom-endpoint.aws.com")

			unmount()

			// Test with endpoint disabled
			const apiConfigurationDisabled: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://custom-endpoint.aws.com",
				awsBedrockEndpointEnabled: false,
				awsUseProfile: true,
			}

			render(
				<Bedrock
					apiConfiguration={apiConfigurationDisabled as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Verify checkbox is unchecked and endpoint is not visible
			expect(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint")).not.toBeChecked()
			expect(screen.queryByTestId("vpc-endpoint-input")).not.toBeInTheDocument()
		})

		it("should update state when apiConfiguration changes", () => {
			// Initial render with endpoint disabled
			const apiConfigurationInitial: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://initial-endpoint.aws.com",
				awsBedrockEndpointEnabled: false,
				awsUseProfile: true,
			}

			const { rerender } = render(
				<Bedrock
					apiConfiguration={apiConfigurationInitial as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Verify initial state
			expect(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint")).not.toBeChecked()
			expect(screen.queryByTestId("vpc-endpoint-input")).not.toBeInTheDocument()

			// Update with new configuration
			const apiConfigurationUpdated: Partial<ProviderSettings> = {
				awsBedrockEndpoint: "https://updated-endpoint.aws.com",
				awsBedrockEndpointEnabled: true,
				awsUseProfile: true,
			}

			rerender(
				<Bedrock
					apiConfiguration={apiConfigurationUpdated as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			// Verify updated state
			expect(screen.getByTestId("checkbox-input-settings:providers.awsbedrockvpc.usecustomvpcendpoint")).toBeChecked()
			expect(screen.getByTestId("vpc-endpoint-input")).toBeInTheDocument()
			expect(screen.getByTestId("vpc-endpoint-input")).toHaveValue("https://updated-endpoint.aws.com")
		})
	})
})
