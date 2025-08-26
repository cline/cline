import { render, screen } from "@/utils/test-utils"

import { Package } from "@roo/package"

import Announcement from "../Announcement"

// Mock the components from @src/components/ui
vi.mock("@src/components/ui", () => ({
	Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<button onClick={onClick}>{children}</button>
	),
}))

// Mock the useAppTranslation hook and Trans component
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { version: string }) => {
			if (key === "chat:announcement.title") {
				return `🎉 Roo Code ${options?.version} Released`
			}
			if (key === "chat:announcement.stealthModel.feature") {
				return "The Sonic stealth model is now Grok Code Fast!"
			}
			if (key === "chat:announcement.stealthModel.note") {
				return "As a thank you for all the helpful feedback about Sonic, you'll also continue to have free access to the grok-code-fast-1 model for another week through the Roo Code Cloud provider."
			}
			if (key === "chat:announcement.stealthModel.connectButton") {
				return "Connect to Roo Code Cloud"
			}
			// Return key for other translations not relevant to this test
			return key
		},
	}),
}))

// Mock react-i18next Trans component
vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: { i18nKey?: string; children: React.ReactNode }) => {
		if (i18nKey === "chat:announcement.stealthModel.feature") {
			return (
				<>
					The Sonic stealth model is now Grok Code Fast! The fast reasoning model is now available as
					grok-code-fast-1 under the &ldquo;xAI (Grok)&rdquo; provider.
				</>
			)
		}
		if (i18nKey === "chat:announcement.stealthModel.selectModel") {
			return <>Visit Settings to get started</>
		}
		if (i18nKey === "chat:announcement.stealthModel.note") {
			return (
				<>
					As a thank you for all the helpful feedback about Sonic, you&rsquo;ll also continue to have free
					access to the grok-code-fast-1 model for another week through the Roo Code Cloud provider.
				</>
			)
		}
		return <>{children}</>
	},
}))

// Mock VSCodeLink
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
		<a onClick={onClick}>{children}</a>
	),
}))

// Mock the useExtensionState hook
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: null,
		cloudIsAuthenticated: false,
	}),
}))

describe("Announcement", () => {
	const mockHideAnnouncement = vi.fn()
	const expectedVersion = Package.version

	it("renders the announcement with the version number from package.json", () => {
		render(<Announcement hideAnnouncement={mockHideAnnouncement} />)

		// Check if the mocked version number is present in the title
		expect(screen.getByText(`🎉 Roo Code ${expectedVersion} Released`)).toBeInTheDocument()

		// Check if the Grok Code Fast feature is displayed
		expect(screen.getByText(/The Sonic stealth model is now Grok Code Fast!/)).toBeInTheDocument()

		// Check if the note is displayed
		expect(screen.getByText(/As a thank you for all the helpful feedback about Sonic/)).toBeInTheDocument()

		// Check if the connect button is displayed (since cloudIsAuthenticated is false in the mock)
		expect(screen.getByText("Connect to Roo Code Cloud")).toBeInTheDocument()
	})
})
