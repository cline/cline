import React from "react"
import { render, screen } from "@/utils/test-utils"

import RooTips from "../RooTips"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	Trans: ({
		children,
		components,
	}: {
		children?: React.ReactNode
		components?: Record<string, React.ReactElement>
	}) => {
		// Simple mock that renders children or the first component if no children
		return children || (components && Object.values(components)[0]) || null
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

describe("RooTips Component", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	describe("when cycle is false (default)", () => {
		beforeEach(() => {
			render(<RooTips />)
		})

		test("renders only the top two tips", () => {
			// Ensure only two tips are present plus the docs link in the Trans component (3 total links)
			expect(screen.getAllByRole("link")).toHaveLength(3)
		})
	})
})
