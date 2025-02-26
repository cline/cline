// cd webview-ui && npx jest src/components/settings/__tests__/ModelPicker.test.ts

import { screen, fireEvent, render } from "@testing-library/react"
import { act } from "react"
import { ModelPicker } from "../ModelPicker"

jest.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: jest.fn(),
}))

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

Element.prototype.scrollIntoView = jest.fn()

describe("ModelPicker", () => {
	const mockSetApiConfigurationField = jest.fn()
	const modelInfo = {
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
		defaultModelInfo: modelInfo,
		modelIdKey: "glamaModelId" as const,
		modelInfoKey: "glamaModelInfo" as const,
		serviceName: "Test Service",
		serviceUrl: "https://test.service",
		recommendedModel: "recommended-model",
		models: mockModels,
		setApiConfigurationField: mockSetApiConfigurationField,
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("calls setApiConfigurationField when a model is selected", async () => {
		await act(async () => {
			render(<ModelPicker {...defaultProps} />)
		})

		await act(async () => {
			// Open the popover by clicking the button.
			const button = screen.getByRole("combobox")
			fireEvent.click(button)
		})

		// Wait for popover to open and animations to complete.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100))
		})

		await act(async () => {
			// Find and click the model item by its value.
			const modelItem = screen.getByTestId("model-input")
			fireEvent.input(modelItem, { target: { value: "model2" } })
		})

		// Verify the API config was updated.
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith(defaultProps.modelIdKey, "model2")
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith(defaultProps.modelInfoKey, mockModels.model2)
	})
})
