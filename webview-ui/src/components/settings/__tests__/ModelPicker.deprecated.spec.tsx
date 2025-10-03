// npx vitest src/components/settings/__tests__/ModelPicker.deprecated.spec.tsx

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, it, expect, vi, beforeEach } from "vitest"

import { ModelPicker } from "../ModelPicker"
import type { ModelInfo } from "@roo-code/types"

// Mock the i18n module
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: any) => {
			// Handle specific translation keys
			if (key === "settings:validation.modelDeprecated") {
				return "This model is no longer available. Please select a different model."
			}
			if (options) return `${key} ${JSON.stringify(options)}`
			return key
		},
	}),
}))

// Mock the useSelectedModel hook
vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: (apiConfiguration: any) => {
		const modelId = apiConfiguration?.openRouterModelId || "model-1"
		const models: Record<string, ModelInfo> = {
			"model-1": {
				maxTokens: 1000,
				contextWindow: 4000,
				supportsPromptCache: true,
			},
			"model-2": {
				maxTokens: 2000,
				contextWindow: 8000,
				supportsPromptCache: false,
			},
			"deprecated-model": {
				maxTokens: 1500,
				contextWindow: 6000,
				supportsPromptCache: true,
				deprecated: true,
			},
		}
		return {
			id: modelId,
			info: models[modelId],
			provider: "openrouter",
			isLoading: false,
			isError: false,
		}
	},
}))

describe("ModelPicker - Deprecated Models", () => {
	const mockSetApiConfigurationField = vi.fn()
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	})

	const regularModels: Record<string, ModelInfo> = {
		"model-1": {
			maxTokens: 1000,
			contextWindow: 4000,
			supportsPromptCache: true,
		},
		"model-2": {
			maxTokens: 2000,
			contextWindow: 8000,
			supportsPromptCache: false,
		},
		"deprecated-model": {
			maxTokens: 1500,
			contextWindow: 6000,
			supportsPromptCache: true,
			deprecated: true,
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should filter out deprecated models from the dropdown", async () => {
		const user = userEvent.setup()

		render(
			<QueryClientProvider client={queryClient}>
				<ModelPicker
					defaultModelId="model-1"
					models={regularModels}
					modelIdKey="openRouterModelId"
					serviceName="Test Service"
					serviceUrl="https://test.com"
					apiConfiguration={{ apiProvider: "openrouter" }}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={{ allowAll: true, providers: {} }}
				/>
			</QueryClientProvider>,
		)

		// Open the dropdown
		const button = screen.getByTestId("model-picker-button")
		await user.click(button)

		// Check that non-deprecated models are shown
		expect(screen.getByTestId("model-option-model-1")).toBeInTheDocument()
		expect(screen.getByTestId("model-option-model-2")).toBeInTheDocument()

		// Check that deprecated model is NOT shown
		expect(screen.queryByTestId("model-option-deprecated-model")).not.toBeInTheDocument()
	})

	it("should show error when a deprecated model is currently selected", () => {
		render(
			<QueryClientProvider client={queryClient}>
				<ModelPicker
					defaultModelId="deprecated-model"
					models={regularModels}
					modelIdKey="openRouterModelId"
					serviceName="Test Service"
					serviceUrl="https://test.com"
					apiConfiguration={{
						apiProvider: "openrouter",
						openRouterModelId: "deprecated-model",
					}}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={{ allowAll: true, providers: {} }}
				/>
			</QueryClientProvider>,
		)

		// Check that the error message is displayed
		expect(
			screen.getByText("This model is no longer available. Please select a different model."),
		).toBeInTheDocument()
	})

	it("should allow selecting non-deprecated models", async () => {
		const user = userEvent.setup()

		render(
			<QueryClientProvider client={queryClient}>
				<ModelPicker
					defaultModelId="model-1"
					models={regularModels}
					modelIdKey="openRouterModelId"
					serviceName="Test Service"
					serviceUrl="https://test.com"
					apiConfiguration={{ apiProvider: "openrouter" }}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={{ allowAll: true, providers: {} }}
				/>
			</QueryClientProvider>,
		)

		// Open the dropdown
		const button = screen.getByTestId("model-picker-button")
		await user.click(button)

		// Select a non-deprecated model
		const model2Option = screen.getByTestId("model-option-model-2")
		await user.click(model2Option)

		// Verify the selection was made
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("openRouterModelId", "model-2")
	})

	it("should not display model info for deprecated models", () => {
		render(
			<QueryClientProvider client={queryClient}>
				<ModelPicker
					defaultModelId="deprecated-model"
					models={regularModels}
					modelIdKey="openRouterModelId"
					serviceName="Test Service"
					serviceUrl="https://test.com"
					apiConfiguration={{
						apiProvider: "openrouter",
						openRouterModelId: "deprecated-model",
					}}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={{ allowAll: true, providers: {} }}
				/>
			</QueryClientProvider>,
		)

		// Model info should not be displayed for deprecated models
		expect(screen.queryByText("This is a deprecated model")).not.toBeInTheDocument()
	})
})
