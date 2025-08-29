import { render, fireEvent } from "@testing-library/react"

import { ImageGenerationSettings } from "../ImageGenerationSettings"

// Mock the translation context
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ImageGenerationSettings", () => {
	const mockSetOpenRouterImageApiKey = vi.fn()
	const mockSetImageGenerationSelectedModel = vi.fn()
	const mockOnChange = vi.fn()

	const defaultProps = {
		enabled: false,
		onChange: mockOnChange,
		openRouterImageApiKey: undefined,
		openRouterImageGenerationSelectedModel: undefined,
		setOpenRouterImageApiKey: mockSetOpenRouterImageApiKey,
		setImageGenerationSelectedModel: mockSetImageGenerationSelectedModel,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Mount Behavior", () => {
		it("should not call setter functions on initial mount with empty configuration", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			// Should NOT call setter functions on initial mount to prevent dirty state
			expect(mockSetOpenRouterImageApiKey).not.toHaveBeenCalled()
			expect(mockSetImageGenerationSelectedModel).not.toHaveBeenCalled()
		})

		it("should not call setter functions on initial mount with existing configuration", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					openRouterImageApiKey="existing-key"
					openRouterImageGenerationSelectedModel="google/gemini-2.5-flash-image-preview:free"
				/>,
			)

			// Should NOT call setter functions on initial mount to prevent dirty state
			expect(mockSetOpenRouterImageApiKey).not.toHaveBeenCalled()
			expect(mockSetImageGenerationSelectedModel).not.toHaveBeenCalled()
		})
	})

	describe("User Interaction Behavior", () => {
		it("should call setimageGenerationSettings when user changes API key", async () => {
			const { getByPlaceholderText } = render(<ImageGenerationSettings {...defaultProps} enabled={true} />)

			const apiKeyInput = getByPlaceholderText(
				"settings:experimental.IMAGE_GENERATION.openRouterApiKeyPlaceholder",
			)

			// Simulate user typing
			fireEvent.input(apiKeyInput, { target: { value: "new-api-key" } })

			// Should call setimageGenerationSettings
			expect(defaultProps.setOpenRouterImageApiKey).toHaveBeenCalledWith("new-api-key")
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
