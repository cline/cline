import React from "react"
import { render, screen } from "@testing-library/react"

import ErrorBoundary from "../ErrorBoundary"

// Mock telemetryClient
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

// Mock translation
vi.mock("react-i18next", () => ({
	withTranslation: () => (Component: any) => {
		Component.defaultProps = {
			...Component.defaultProps,
			t: (key: string) => {
				// Mock translations for tests
				const translations: Record<string, string> = {
					"errorBoundary.title": "Something went wrong",
					"errorBoundary.reportText": "Please help us improve by reporting this error on",
					"errorBoundary.githubText": "GitHub",
					"errorBoundary.copyInstructions": "Please copy and paste the following error message:",
				}
				return translations[key] || key
			},
		}
		return Component
	},
}))

// Test component that throws an error
const ErrorThrowingComponent = ({ shouldThrow = false }) => {
	if (shouldThrow) {
		throw new Error("Test error")
	}
	return <div data-testid="normal-render">Content rendered normally</div>
}

describe("ErrorBoundary", () => {
	// Suppress console errors during tests
	const originalConsoleError = console.error
	beforeAll(() => {
		console.error = vi.fn()
	})
	afterAll(() => {
		console.error = originalConsoleError
	})

	test("renders children when no error occurs", () => {
		render(
			<ErrorBoundary>
				<ErrorThrowingComponent shouldThrow={false} />
			</ErrorBoundary>,
		)

		expect(screen.getByTestId("normal-render")).toBeInTheDocument()
	})

	test("renders error UI when an error occurs", () => {
		// React will log the error to the console - we're just testing the UI behavior
		render(
			<ErrorBoundary>
				<ErrorThrowingComponent shouldThrow={true} />
			</ErrorBoundary>,
		)

		// Verify error message is displayed using a more flexible approach
		const errorTitle = screen.getByRole("heading", { level: 2 })
		expect(errorTitle.textContent).toContain("Something went wrong")
		expect(screen.getByText(/please copy and paste the following error message/i)).toBeInTheDocument()
	})

	test("error boundary renders error UI when component changes but still in error state", () => {
		const { rerender } = render(
			<ErrorBoundary>
				<ErrorThrowingComponent shouldThrow={true} />
			</ErrorBoundary>,
		)

		// Verify error message is displayed using a more flexible approach
		const errorTitle = screen.getByRole("heading", { level: 2 })
		expect(errorTitle.textContent).toContain("Something went wrong")

		// Update the component to not throw
		rerender(
			<ErrorBoundary>
				<ErrorThrowingComponent shouldThrow={false} />
			</ErrorBoundary>,
		)

		// The error boundary should still show the error since it doesn't automatically reset
		const errorTitleAfterRerender = screen.getByRole("heading", { level: 2 })
		expect(errorTitleAfterRerender.textContent).toContain("Something went wrong")
	})
})
