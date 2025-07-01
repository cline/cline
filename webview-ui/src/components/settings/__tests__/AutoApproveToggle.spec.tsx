import { render, screen, fireEvent } from "@/utils/test-utils"

import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext"

import { AutoApproveToggle, autoApproveSettingsConfig } from "../AutoApproveToggle"

vi.mock("@/i18n/TranslationContext", () => {
	const actual = vi.importActual("@/i18n/TranslationContext")
	return {
		...actual,
		useAppTranslation: () => ({
			t: (key: string) => key,
		}),
	}
})

describe("AutoApproveToggle", () => {
	const mockOnToggle = vi.fn()
	const initialProps = {
		alwaysAllowReadOnly: true,
		alwaysAllowWrite: false,
		alwaysAllowBrowser: false,
		alwaysApproveResubmit: true,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: true,
		alwaysAllowSubtasks: false,
		alwaysAllowExecute: true,
		alwaysAllowFollowupQuestions: false,
		onToggle: mockOnToggle,
	}

	beforeEach(() => {
		mockOnToggle.mockClear()
	})

	test("renders all toggle buttons with correct initial ARIA attributes", () => {
		render(
			<TranslationProvider>
				<AutoApproveToggle {...initialProps} />
			</TranslationProvider>,
		)

		Object.values(autoApproveSettingsConfig).forEach((config) => {
			const button = screen.getByTestId(config.testId)
			expect(button).toBeInTheDocument()
			expect(button).toHaveAttribute("aria-label", config.labelKey)
			expect(button).toHaveAttribute("aria-pressed", String(initialProps[config.key]))
		})
	})

	test("calls onToggle with the correct key and value when a button is clicked", () => {
		render(
			<TranslationProvider>
				<AutoApproveToggle {...initialProps} />
			</TranslationProvider>,
		)

		const writeToggleButton = screen.getByTestId(autoApproveSettingsConfig.alwaysAllowWrite.testId)
		fireEvent.click(writeToggleButton)

		expect(mockOnToggle).toHaveBeenCalledTimes(1)
		expect(mockOnToggle).toHaveBeenCalledWith("alwaysAllowWrite", true)

		const readOnlyButton = screen.getByTestId(autoApproveSettingsConfig.alwaysAllowReadOnly.testId)
		fireEvent.click(readOnlyButton)
		expect(mockOnToggle).toHaveBeenCalledTimes(2)
		expect(mockOnToggle).toHaveBeenCalledWith("alwaysAllowReadOnly", false)
	})

	test("updates aria-pressed attribute after toggle", () => {
		const { rerender } = render(
			<TranslationProvider>
				<AutoApproveToggle {...initialProps} />
			</TranslationProvider>,
		)

		const writeToggleButton = screen.getByTestId(autoApproveSettingsConfig.alwaysAllowWrite.testId)
		expect(writeToggleButton).toHaveAttribute("aria-pressed", "false")

		const updatedProps = { ...initialProps, alwaysAllowWrite: true }
		rerender(
			<TranslationProvider>
				<AutoApproveToggle {...updatedProps} />
			</TranslationProvider>,
		)

		expect(screen.getByTestId(autoApproveSettingsConfig.alwaysAllowWrite.testId)).toHaveAttribute(
			"aria-pressed",
			"true",
		)
	})
})
