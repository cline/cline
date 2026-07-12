import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AiHydroAuthProvider } from "@/context/AiHydroAuthContext"
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
		aihydroMessages: [],
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
	return <AiHydroAuthProvider>{children}</AiHydroAuthProvider>
}

describe("Announcement", () => {
	const hideAnnouncement = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the onboarding checklist", () => {
		render(
			<TestWrapper>
				<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />
			</TestWrapper>,
		)
		// `version` is kept for API compatibility but is no longer rendered —
		// the announcement is now a 3-step "Get started" onboarding checklist
		// (model / MCP tools / researcher profile), not a version banner.
		expect(screen.getByText(/Get started with AI-Hydro/)).toBeInTheDocument()
	})

	it("calls hideAnnouncement when close button is clicked", () => {
		render(
			<TestWrapper>
				<Announcement hideAnnouncement={hideAnnouncement} version="2.0.0" />
			</TestWrapper>,
		)
		// The close (X) icon button has no data-testid; its title is unique
		// (the footer "Skip for now" button has the same label as visible
		// text, not a `title` attribute, so this doesn't collide with it).
		fireEvent.click(screen.getByTitle("Skip for now"))
		expect(hideAnnouncement).toHaveBeenCalled()
	})
})
