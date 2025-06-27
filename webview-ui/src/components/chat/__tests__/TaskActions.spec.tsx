import { render, screen, fireEvent } from "@/utils/test-utils"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { TaskActions } from "../TaskActions"
import type { HistoryItem } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Mock scrollIntoView for JSDOM
Object.defineProperty(Element.prototype, "scrollIntoView", {
	value: vi.fn(),
	writable: true,
})

// Mock the vscode utility
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the useExtensionState hook
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

const mockPostMessage = vi.mocked(vscode.postMessage)
const mockUseExtensionState = vi.mocked(useExtensionState)

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"chat:task.share": "Share task",
				"chat:task.export": "Export task history",
				"chat:task.delete": "Delete Task (Shift + Click to skip confirmation)",
				"chat:task.shareWithOrganization": "Share with Organization",
				"chat:task.shareWithOrganizationDescription": "Only members of your organization can access",
				"chat:task.sharePublicly": "Share Publicly",
				"chat:task.sharePubliclyDescription": "Anyone with the link can access",
				"chat:task.connectToCloud": "Connect to Cloud",
				"chat:task.connectToCloudDescription": "Sign in to Roo Code Cloud to share tasks",
				"chat:task.sharingDisabledByOrganization": "Sharing disabled by organization",
				"account:cloudBenefitsTitle": "Connect to Roo Code Cloud",
				"account:cloudBenefitsSubtitle": "Sign in to Roo Code Cloud to share tasks",
				"account:cloudBenefitHistory": "Access your task history from anywhere",
				"account:cloudBenefitSharing": "Share tasks with your team",
				"account:cloudBenefitMetrics": "Track usage and costs",
				"account:connect": "Connect",
			}
			return translations[key] || key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}))

// Mock pretty-bytes
vi.mock("pretty-bytes", () => ({
	default: (bytes: number) => `${bytes} B`,
}))

describe("TaskActions", () => {
	const mockItem: HistoryItem = {
		id: "test-task-id",
		number: 1,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 200,
		totalCost: 0.01,
		size: 1024,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockUseExtensionState.mockReturnValue({
			sharingEnabled: true,
			cloudIsAuthenticated: true,
			cloudUserInfo: {
				organizationName: "Test Organization",
			},
		} as any)
	})

	describe("Share Button Visibility", () => {
		it("renders share button when item has id", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeInTheDocument()
		})

		it("does not render share button when item has no id", () => {
			render(<TaskActions item={undefined} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.queryAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).not.toBeDefined()
		})

		it("renders share button even when not authenticated", () => {
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)

			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeInTheDocument()
		})
	})

	describe("Authenticated User Share Flow", () => {
		it("shows organization and public share options when authenticated and sharing enabled", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			expect(screen.getByText("Share with Organization")).toBeInTheDocument()
			expect(screen.getByText("Share Publicly")).toBeInTheDocument()
		})

		it("sends shareCurrentTask message when organization option is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			const orgOption = screen.getByText("Share with Organization")
			fireEvent.click(orgOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "shareCurrentTask",
				visibility: "organization",
			})
		})

		it("sends shareCurrentTask message when public option is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			const publicOption = screen.getByText("Share Publicly")
			fireEvent.click(publicOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "shareCurrentTask",
				visibility: "public",
			})
		})

		it("does not show organization option when user is not in an organization", () => {
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: true,
				cloudIsAuthenticated: true,
				cloudUserInfo: {
					// No organizationName property
				},
			} as any)

			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.getByText("Share Publicly")).toBeInTheDocument()
		})
	})

	describe("Unauthenticated User Login Flow", () => {
		beforeEach(() => {
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)
		})

		it("shows connect to cloud option when not authenticated", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			expect(screen.getByText("Connect to Roo Code Cloud")).toBeInTheDocument()
			expect(screen.getByText("Sign in to Roo Code Cloud to share tasks")).toBeInTheDocument()
			expect(screen.getByText("Connect")).toBeInTheDocument()
		})

		it("does not show organization and public options when not authenticated", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.queryByText("Share Publicly")).not.toBeInTheDocument()
		})

		it("sends rooCloudSignIn message when connect to cloud is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeDefined()
			fireEvent.click(shareButton!)

			const connectOption = screen.getByText("Connect")
			fireEvent.click(connectOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "rooCloudSignIn",
			})
		})
	})

	describe("Mixed Authentication States", () => {
		it("shows disabled share button when authenticated but sharing not enabled", () => {
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: true,
			} as any)

			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			expect(shareButton).toBeInTheDocument()
			expect(shareButton).toBeDisabled()

			// Should not have a popover when sharing is disabled
			fireEvent.click(shareButton!)
			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.queryByText("Connect to Cloud")).not.toBeInTheDocument()
		})

		it("automatically opens popover when user becomes authenticated", () => {
			// Start with unauthenticated state
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)

			const { rerender } = render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Verify popover is not open initially
			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()

			// Simulate user becoming authenticated
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: true,
				cloudIsAuthenticated: true,
				cloudUserInfo: {
					organizationName: "Test Organization",
				},
			} as any)

			rerender(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Verify popover automatically opens and shows sharing options
			expect(screen.getByText("Share with Organization")).toBeInTheDocument()
			expect(screen.getByText("Share Publicly")).toBeInTheDocument()
		})
	})

	describe("Other Actions", () => {
		it("renders export button", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			const exportButton = screen.getByLabelText("Export task history")
			expect(exportButton).toBeInTheDocument()
		})

		it("sends exportCurrentTask message when export button is clicked", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			const exportButton = screen.getByLabelText("Export task history")
			fireEvent.click(exportButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "exportCurrentTask",
			})
		})

		it("renders delete button and file size when item has size", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			const deleteButton = screen.getByLabelText("Delete Task (Shift + Click to skip confirmation)")
			expect(deleteButton).toBeInTheDocument()
			expect(screen.getByText("1024 B")).toBeInTheDocument()
		})

		it("does not render delete button when item has no size", () => {
			const itemWithoutSize = { ...mockItem, size: 0 }
			render(<TaskActions item={itemWithoutSize} buttonsDisabled={false} />)

			const deleteButton = screen.queryByLabelText("Delete Task (Shift + Click to skip confirmation)")
			expect(deleteButton).not.toBeInTheDocument()
		})
	})

	describe("Button States", () => {
		it("disables buttons when buttonsDisabled is true", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={true} />)

			// Find button by its icon class
			const buttons = screen.getAllByRole("button")
			const shareButton = buttons.find((btn) => btn.querySelector(".codicon-link"))
			const exportButton = screen.getByLabelText("Export task history")

			expect(shareButton).toBeDisabled()
			expect(exportButton).toBeDisabled()
		})
	})
})
