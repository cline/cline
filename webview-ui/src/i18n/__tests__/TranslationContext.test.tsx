import React from "react"
import { render } from "@testing-library/react"
import "@testing-library/jest-dom"
import TranslationProvider, { useAppTranslation } from "../TranslationContext"
import { setupI18nForTests } from "../test-utils"

// Mock the useExtensionState hook
jest.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		language: "en",
	}),
}))

// Mock component that uses the translation context
const TestComponent = () => {
	const { t } = useAppTranslation()
	return (
		<div>
			<h1 data-testid="translation-test">{t("settings.autoApprove.title")}</h1>
			<p data-testid="translation-interpolation">{t("notifications.error", { message: "Test error" })}</p>
		</div>
	)
}

describe("TranslationContext", () => {
	beforeAll(() => {
		// Initialize i18next with test translations
		setupI18nForTests()
	})

	it("should provide translations via context", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if translation is provided correctly
		expect(getByTestId("translation-test")).toHaveTextContent("Auto-Approve")
	})

	it("should handle interpolation correctly", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if interpolation works
		expect(getByTestId("translation-interpolation")).toHaveTextContent("Operation failed: Test error")
	})
})
