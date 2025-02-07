// cd webview-ui && npx jest src/components/settings/__tests__/ModelPicker.test.ts

import { screen, fireEvent, render } from "@testing-library/react"
import { act } from "react"
import { ModelPicker } from "../ModelPicker"
import { useExtensionState } from "../../../context/ExtensionStateContext"

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
	const mockOnUpdateApiConfig = jest.fn()
	const mockSetApiConfiguration = jest.fn()

	const defaultProps = {
		defaultModelId: "model1",
		modelsKey: "glamaModels" as const,
		configKey: "glamaModelId" as const,
		infoKey: "glamaModelInfo" as const,
		refreshMessageType: "refreshGlamaModels" as const,
		serviceName: "Test Service",
		serviceUrl: "https://test.service",
		recommendedModel: "recommended-model",
	}

	const mockModels = {
		model1: { name: "Model 1", description: "Test model 1" },
		model2: { name: "Model 2", description: "Test model 2" },
	}

	beforeEach(() => {
		jest.clearAllMocks()
		;(useExtensionState as jest.Mock).mockReturnValue({
			apiConfiguration: {},
			setApiConfiguration: mockSetApiConfiguration,
			glamaModels: mockModels,
			onUpdateApiConfig: mockOnUpdateApiConfig,
		})
	})

	it("calls onUpdateApiConfig when a model is selected", async () => {
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
			const modelItem = screen.getByRole("option", { name: "model2" })
			fireEvent.click(modelItem)
		})

		// Verify the API config was updated.
		expect(mockSetApiConfiguration).toHaveBeenCalledWith({
			glamaModelId: "model2",
			glamaModelInfo: mockModels["model2"],
		})

		// Verify onUpdateApiConfig was called with the new config.
		expect(mockOnUpdateApiConfig).toHaveBeenCalledWith({
			glamaModelId: "model2",
			glamaModelInfo: mockModels["model2"],
		})
	})
})
