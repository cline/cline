// npx vitest src/components/settings/__tests__/ModelPicker.spec.tsx

import { screen, fireEvent, render } from "@/utils/test-utils"
import { act } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { vi } from "vitest"

import { ModelInfo } from "@roo-code/types"

import { ModelPicker } from "../ModelPicker"

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

Element.prototype.scrollIntoView = vi.fn()

describe("ModelPicker", () => {
	const mockSetApiConfigurationField = vi.fn()

	const modelInfo: ModelInfo = {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
	}

	const mockModels = {
		model1: { name: "Model 1", description: "Test model 1", ...modelInfo },
		model2: { name: "Model 2", description: "Test model 2", ...modelInfo },
	}

	const defaultProps = {
		apiConfiguration: {},
		defaultModelId: "model1",
		modelIdKey: "glamaModelId" as const,
		serviceName: "Test Service",
		serviceUrl: "https://test.service",
		recommendedModel: "recommended-model",
		models: mockModels,
		setApiConfigurationField: mockSetApiConfigurationField,
		organizationAllowList: { allowAll: true, providers: {} },
	}

	const queryClient = new QueryClient()

	const renderModelPicker = () => {
		return render(
			<QueryClientProvider client={queryClient}>
				<ModelPicker {...defaultProps} />
			</QueryClientProvider>,
		)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		// Clear any pending timers to prevent test flakiness
		vi.clearAllTimers()
		vi.useRealTimers()
	})

	it("calls setApiConfigurationField when a model is selected", async () => {
		await act(async () => renderModelPicker())

		await act(async () => {
			// Open the popover by clicking the button.
			const button = screen.getByTestId("model-picker-button")
			fireEvent.click(button)
		})

		// Wait for popover to open and animations to complete.
		await act(async () => {
			vi.advanceTimersByTime(100)
		})

		await act(async () => {
			// Find and set the input value
			const modelInput = screen.getByTestId("model-input")
			fireEvent.input(modelInput, { target: { value: "model2" } })
		})

		// Need to find and click the CommandItem to trigger onSelect
		await act(async () => {
			// Find the CommandItem for model2 and click it
			const modelItem = screen.getByTestId("model-option-model2")
			fireEvent.click(modelItem)
		})

		// Advance timers to trigger the setTimeout in onSelect
		await act(async () => {
			vi.advanceTimersByTime(100)
		})

		// Verify the API config was updated.
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith(defaultProps.modelIdKey, "model2")
	})

	it("allows setting a custom model ID that's not in the predefined list", async () => {
		await act(async () => renderModelPicker())

		await act(async () => {
			// Open the popover by clicking the button.
			const button = screen.getByTestId("model-picker-button")
			fireEvent.click(button)
		})

		// Wait for popover to open and animations to complete.
		await act(async () => {
			vi.advanceTimersByTime(100)
		})

		const customModelId = "custom-model-id"

		await act(async () => {
			// Find and set the input value to a custom model ID
			const modelInput = screen.getByTestId("model-input")
			fireEvent.input(modelInput, { target: { value: customModelId } })
		})

		// Wait for the UI to update
		await act(async () => {
			vi.advanceTimersByTime(100)
		})

		// Find and click the "Use custom" option
		await act(async () => {
			// Look for text containing our custom model ID
			const customOption = screen.getByTestId("use-custom-model")
			fireEvent.click(customOption)
		})

		// Advance timers to trigger the setTimeout in onSelect
		await act(async () => {
			vi.advanceTimersByTime(100)
		})

		// Verify the API config was updated with the custom model ID
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith(defaultProps.modelIdKey, customModelId)
	})

	describe("Error Message Display", () => {
		it("displays error message when errorMessage prop is provided", async () => {
			const errorMessage = "Model not available for your organization"
			const propsWithError = {
				...defaultProps,
				errorMessage,
			}

			await act(async () => {
				render(
					<QueryClientProvider client={queryClient}>
						<ModelPicker {...propsWithError} />
					</QueryClientProvider>,
				)
			})

			// Check that the error message is displayed
			expect(screen.getByTestId("api-error-message")).toBeInTheDocument()
			expect(screen.getByText(errorMessage)).toBeInTheDocument()
		})

		it("does not display error message when errorMessage prop is undefined", async () => {
			await act(async () => renderModelPicker())

			// Check that no error message is displayed
			expect(screen.queryByTestId("api-error-message")).not.toBeInTheDocument()
		})

		it("displays error message below the model selector", async () => {
			const errorMessage = "Invalid model selected"
			const propsWithError = {
				...defaultProps,
				errorMessage,
			}

			await act(async () => {
				render(
					<QueryClientProvider client={queryClient}>
						<ModelPicker {...propsWithError} />
					</QueryClientProvider>,
				)
			})

			// Check that both the model selector and error message are present
			const modelSelector = screen.getByTestId("model-picker-button")
			const errorContainer = screen.getByTestId("api-error-message")
			const errorElement = screen.getByText(errorMessage)

			expect(modelSelector).toBeInTheDocument()
			expect(errorContainer).toBeInTheDocument()
			expect(errorElement).toBeInTheDocument()
			expect(errorElement).toBeVisible()
		})

		it("updates error message when errorMessage prop changes", async () => {
			const initialError = "Initial error"
			const updatedError = "Updated error"

			const { rerender } = render(
				<QueryClientProvider client={queryClient}>
					<ModelPicker {...defaultProps} errorMessage={initialError} />
				</QueryClientProvider>,
			)

			// Check initial error is displayed
			expect(screen.getByTestId("api-error-message")).toBeInTheDocument()
			expect(screen.getByText(initialError)).toBeInTheDocument()

			// Update the error message
			rerender(
				<QueryClientProvider client={queryClient}>
					<ModelPicker {...defaultProps} errorMessage={updatedError} />
				</QueryClientProvider>,
			)

			// Check that the error message has been updated
			expect(screen.getByTestId("api-error-message")).toBeInTheDocument()
			expect(screen.queryByText(initialError)).not.toBeInTheDocument()
			expect(screen.getByText(updatedError)).toBeInTheDocument()
		})

		it("removes error message when errorMessage prop becomes undefined", async () => {
			const errorMessage = "Temporary error"

			const { rerender } = render(
				<QueryClientProvider client={queryClient}>
					<ModelPicker {...defaultProps} errorMessage={errorMessage} />
				</QueryClientProvider>,
			)

			// Check error is initially displayed
			expect(screen.getByTestId("api-error-message")).toBeInTheDocument()
			expect(screen.getByText(errorMessage)).toBeInTheDocument()

			// Remove the error message
			rerender(
				<QueryClientProvider client={queryClient}>
					<ModelPicker {...defaultProps} errorMessage={undefined} />
				</QueryClientProvider>,
			)

			// Check that the error message has been removed
			expect(screen.queryByTestId("api-error-message")).not.toBeInTheDocument()
			expect(screen.queryByText(errorMessage)).not.toBeInTheDocument()
		})
	})
})
