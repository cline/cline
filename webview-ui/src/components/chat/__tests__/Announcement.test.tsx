import { render, screen } from "@testing-library/react"
import { jest } from "@jest/globals" // Or 'jest' if using Jest

import { Package } from "@roo/package"

import Announcement from "../Announcement"

// Mock the components from @src/components/ui
jest.mock("@src/components/ui", () => ({
	Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock the useAppTranslation hook
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { version: string }) => {
			if (key === "chat:announcement.title") {
				return `🎉 Roo Code ${options?.version} Released`
			}
			if (key === "chat:announcement.description") {
				return `Roo Code ${options?.version} brings powerful new features and improvements based on your feedback.`
			}
			// Return key for other translations not relevant to this test
			return key
		},
	}),
}))

describe("Announcement", () => {
	const mockHideAnnouncement = jest.fn()
	const expectedVersion = Package.version

	it("renders the announcement with the version number from package.json", () => {
		render(<Announcement hideAnnouncement={mockHideAnnouncement} />)

		// Check if the mocked version number is present in the title and description
		expect(screen.getByText(`🎉 Roo Code ${expectedVersion} Released`)).toBeInTheDocument()
		expect(
			screen.getByText(
				`Roo Code ${expectedVersion} brings powerful new features and improvements based on your feedback.`,
			),
		).toBeInTheDocument()
	})
})
