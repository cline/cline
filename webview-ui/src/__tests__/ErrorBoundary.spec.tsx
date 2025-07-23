import React from "react"
import { render, screen } from "@testing-library/react"
import ErrorBoundary from "../components/ErrorBoundary"

// Mock telemetry client
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

// Mock translation function
vi.mock("react-i18next", () => {
	const tFunction = (key: string) => key
	return {
		withTranslation: () => (Component: any) => {
			const MockedComponent = (props: any) => {
				return <Component t={tFunction} i18n={{ t: tFunction }} tReady {...props} />
			}
			MockedComponent.displayName = `withTranslation(${Component.displayName || Component.name || "Component"})`
			return MockedComponent
		},
	}
})

// Test component that can throw errors on demand
const ErrorThrower = ({ shouldThrow = false, message = "Test error" }: { shouldThrow?: boolean; message?: string }) => {
	if (shouldThrow) {
		throw new Error(message)
	}
	return <div>No error</div>
}

describe("ErrorBoundary", () => {
	// Suppress console errors during tests
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders children when there is no error", () => {
		render(
			<ErrorBoundary>
				<div data-testid="test-child">Test Content</div>
			</ErrorBoundary>,
		)

		expect(screen.getByTestId("test-child")).toBeInTheDocument()
		expect(screen.getByText("Test Content")).toBeInTheDocument()
	})

	it("renders error UI when a child component throws", () => {
		vi.stubEnv("PKG_VERSION", "1.2.3")

		// Using the React testing library's render method with an error boundary is tricky
		// We need to catch and ignore the error during the test
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})

		render(
			<ErrorBoundary>
				<ErrorThrower shouldThrow={true} message="Test component error" />
			</ErrorBoundary>,
		)

		// Verify error boundary elements are displayed - using partial matchers to account for version info
		expect(screen.getByText(/errorBoundary.title/)).toBeInTheDocument()

		// Check for the GitHub link
		const githubLink = screen.getByRole("link", { name: /errorBoundary.githubText/ })
		expect(githubLink).toBeInTheDocument()
		expect(githubLink).toHaveAttribute("href", "https://github.com/RooCodeInc/Roo-Code/issues")

		// Check for other error boundary elements
		expect(screen.getByText(/errorBoundary.copyInstructions/)).toBeInTheDocument()
		expect(screen.getByText(/errorBoundary.errorStack/)).toBeInTheDocument()

		// In test environments, the componentStack might not always be available
		// so we don't check for it to make the test more reliable

		// The test error message should be included in the error display
		expect(screen.getByText(/Test component error/)).toBeInTheDocument()

		spy.mockRestore()
	})
})
