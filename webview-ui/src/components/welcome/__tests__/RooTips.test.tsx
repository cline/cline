import React from "react"
import { render, screen } from "@testing-library/react"
import RooTips from "../RooTips"

// Mock the translation hook
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	// Mock Trans component if it were used directly, but it's not here
}))

// Mock VSCodeLink
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

// Mock clsx if complex class logic needs specific testing (optional)
// jest.mock('clsx');

describe("RooTips Component", () => {
	beforeEach(() => {
		jest.useFakeTimers()
		// Reset Math.random mock for consistent starting points if needed
		// jest.spyOn(global.Math, 'random').mockReturnValue(0); // Example: always start with the first tip
	})

	afterEach(() => {
		jest.runOnlyPendingTimers()
		jest.useRealTimers()
		// Restore Math.random if mocked
		// jest.spyOn(global.Math, 'random').mockRestore();
	})

	describe("when cycle is false (default)", () => {
		beforeEach(() => {
			render(<RooTips cycle={false} />)
		})

		test("renders only the top two tips", () => {
			// Ensure only two tips are present (check by link role)
			expect(screen.getAllByRole("link")).toHaveLength(2)
		})
	})
})
