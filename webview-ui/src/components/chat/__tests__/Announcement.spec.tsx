import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineAuthProvider } from "@/context/ClineAuthContext"
import Announcement from "../Announcement"

// Mock the VSCode webview toolkit
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	useTheme: () => ({ themeType: "light" }),
	VSCodeButton: (props: ComponentProps<"button">) => <button {...props}>{props.children}</button>,
	VSCodeLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

// Mock the gRPC service client
vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		accountLoginClicked: vi.fn().mockResolvedValue({}),
		subscribeToAuthStatusUpdate: vi.fn().mockReturnValue(() => {}),
		getUserOrganizations: vi.fn().mockResolvedValue({ organizations: [] }),
	},
}))

// Mock HeroUI components
vi.mock("@heroui/react", () => ({
	Accordion: ({ children }: { children: React.ReactNode }) => <div data-testid="accordion">{children}</div>,
	AccordionItem: ({ children, title }: { children: React.ReactNode; title: string }) => (
		<div data-testid="accordion-item">
			<div>{title}</div>
			<div>{children}</div>
		</div>
	),
}))

// Mock the settings utils
vi.mock("../settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleFieldsChange: vi.fn(),
	}),
}))

// Mock the entire ExtensionStateContext since it has complex internal logic
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: null,
		openRouterModels: {},
		setShowChatModelSelector: vi.fn(),
		refreshOpenRouterModels: vi.fn(), // Add this missing mock function
		version: "2.0.0",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		theme: "dark",
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		workspaceFilePaths: [],
	}),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Test wrapper component that provides all necessary contexts
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <ClineAuthProvider>{children}</ClineAuthProvider>
}

describe("Announcement", () => {
	const hideAnnouncement = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the announcement with the correct version", () => {
		render(
			<TestWrapper>
				<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />
			</TestWrapper>,
		)
		expect(screen.getByText(/New in v2.0/)).toBeInTheDocument()
	})

	it("calls hideAnnouncement when close button is clicked", () => {
		render(
			<TestWrapper>
				<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />
			</TestWrapper>,
		)
		fireEvent.click(screen.getByTestId("close-announcement-button"))
		expect(hideAnnouncement).toHaveBeenCalled()
	})
})
