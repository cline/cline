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
				return "Stealth reasoning model with advanced capabilities"
			}
			if (key === "chat:announcement.stealthModel.note") {
				return "Note: This is an experimental feature"
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
			return <>Stealth reasoning model with advanced capabilities</>
		}
		if (i18nKey === "chat:announcement.stealthModel.selectModel") {
			return <>Please select the roo/sonic model in settings</>
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

		// Check if the stealth model feature is displayed (using partial match due to bullet point)
		expect(screen.getByText(/Stealth reasoning model with advanced capabilities/)).toBeInTheDocument()

		// Check if the note is displayed
		expect(screen.getByText("Note: This is an experimental feature")).toBeInTheDocument()

		// Check if the connect button is displayed (since cloudIsAuthenticated is false in the mock)
		expect(screen.getByText("Connect to Roo Code Cloud")).toBeInTheDocument()
	})
})
