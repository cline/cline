import { render, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { ImageGenerationSettings } from "../ImageGenerationSettings"
import type { ProviderSettings } from "@roo-code/types"

// Mock the translation context
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ImageGenerationSettings", () => {
	const mockSetApiConfigurationField = vi.fn()
	const mockOnChange = vi.fn()

	const defaultProps = {
		enabled: false,
		onChange: mockOnChange,
		apiConfiguration: {} as ProviderSettings,
		setApiConfigurationField: mockSetApiConfigurationField,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Mount Behavior", () => {
		it("should not call setApiConfigurationField on initial mount with empty configuration", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			// Should NOT call setApiConfigurationField on initial mount to prevent dirty state
			expect(mockSetApiConfigurationField).not.toHaveBeenCalled()
		})

		it("should not call setApiConfigurationField on initial mount with existing configuration", () => {
			const apiConfiguration = {
				openRouterImageGenerationSettings: {
					openRouterApiKey: "existing-key",
					selectedModel: "google/gemini-2.5-flash-image-preview:free",
				},
			} as ProviderSettings

			render(<ImageGenerationSettings {...defaultProps} apiConfiguration={apiConfiguration} />)

			// Should NOT call setApiConfigurationField on initial mount to prevent dirty state
			expect(mockSetApiConfigurationField).not.toHaveBeenCalled()
		})
	})

	describe("User Interaction Behavior", () => {
		it("should call setApiConfigurationField when user changes API key", async () => {
			const { getByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			const apiKeyInput = getByPlaceholderText(
				"settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder",
			)

			// Simulate user typing
			fireEvent.input(apiKeyInput, { target: { value: "new-api-key" } })

			// Should call setApiConfigurationField with isUserAction=true
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"openRouterImageGenerationSettings",
				{
					openRouterApiKey: "new-api-key",
					selectedModel: "google/gemini-2.5-flash-image-preview",
				},
				true, // This should be true for user actions
			)
		})

		// Note: Testing VSCode dropdown components is complex due to their custom nature
		// The key functionality (not marking as dirty on initial mount) is already tested above
	})

	describe("Conditional Rendering", () => {
		it("should render input fields when enabled is true", () => {
			const { getByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			expect(
				getByPlaceholderText("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder"),
			).toBeInTheDocument()
		})

		it("should not render input fields when enabled is false", () => {
			const { queryByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={false} />)

			expect(
				queryByPlaceholderText("settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder"),
			).not.toBeInTheDocument()
		})
	})
})
