import type { HistoryItem } from "@roo-code/types"

import { render, screen, fireEvent } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"

import { TaskActions } from "../TaskActions"

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
				"cloud:cloudBenefitsTitle": "Connect to Roo Code Cloud",
				"cloud:cloudBenefitHistory": "Access your task history from anywhere",
				"cloud:cloudBenefitSharing": "Share tasks with your team",
				"cloud:cloudBenefitMetrics": "Track usage and costs",
				"cloud:connect": "Connect",
				"history:copyPrompt": "Copy",
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

			// ShareButton now uses data-testid for reliable testing
			const shareButton = screen.getByTestId("share-button")
			expect(shareButton).toBeInTheDocument()
		})

		it("does not render share button when item has no id", () => {
			render(<TaskActions item={undefined} buttonsDisabled={false} />)

			// ShareButton returns null when no item ID
			const shareButton = screen.queryByTestId("share-button")
			expect(shareButton).toBeNull()
		})

		it("renders share button even when not authenticated", () => {
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)

			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// ShareButton should still render when not authenticated
			const shareButton = screen.getByTestId("share-button")
			expect(shareButton).toBeInTheDocument()
		})
	})

	describe("Authenticated User Share Flow", () => {
		it("shows organization and public share options when authenticated and sharing enabled", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

			expect(screen.getByText("Share with Organization")).toBeInTheDocument()
			expect(screen.getByText("Share Publicly")).toBeInTheDocument()
		})

		it("sends shareCurrentTask message when organization option is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

			const orgOption = screen.getByText("Share with Organization")
			fireEvent.click(orgOption)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "shareCurrentTask",
				visibility: "organization",
			})
		})

		it("sends shareCurrentTask message when public option is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

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

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

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

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

			expect(screen.getByText("Connect to Roo Code Cloud")).toBeInTheDocument()
			expect(screen.getByText("Connect")).toBeInTheDocument()
		})

		it("does not show organization and public options when not authenticated", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.queryByText("Share Publicly")).not.toBeInTheDocument()
		})

		it("sends rooCloudSignIn message when connect to cloud is selected", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Find share button by its test ID and click it
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

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

			// Find share button by its test ID
			const shareButton = screen.getByTestId("share-button")
			expect(shareButton).toBeInTheDocument()
			expect(shareButton).toBeDisabled()

			// Should not have a popover when sharing is disabled
			fireEvent.click(shareButton!)
			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.queryByText("Connect to Cloud")).not.toBeInTheDocument()
		})

		it("does not automatically open popover when user becomes authenticated from elsewhere", () => {
			// Start with unauthenticated state
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)

			const { rerender } = render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Verify popover is not open initially
			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()

			// Simulate user becoming authenticated (e.g., from CloudView)
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: true,
				cloudIsAuthenticated: true,
				cloudUserInfo: {
					organizationName: "Test Organization",
				},
			} as any)

			rerender(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Verify popover does NOT automatically open when auth happens from elsewhere
			expect(screen.queryByText("Share with Organization")).not.toBeInTheDocument()
			expect(screen.queryByText("Share Publicly")).not.toBeInTheDocument()
		})

		it("automatically opens popover when user authenticates from share button", () => {
			// Start with unauthenticated state
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: false,
				cloudIsAuthenticated: false,
			} as any)

			const { rerender } = render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Click share button to open connect modal
			const shareButton = screen.getByTestId("share-button")
			fireEvent.click(shareButton)

			// Click connect button to initiate authentication
			const connectButton = screen.getByText("Connect")
			fireEvent.click(connectButton)

			// Verify rooCloudSignIn message was sent
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "rooCloudSignIn",
			})

			// Simulate user becoming authenticated after clicking connect from share button
			mockUseExtensionState.mockReturnValue({
				sharingEnabled: true,
				cloudIsAuthenticated: true,
				cloudUserInfo: {
					organizationName: "Test Organization",
				},
			} as any)

			rerender(<TaskActions item={mockItem} buttonsDisabled={false} />)

			// Verify popover automatically opens when auth was initiated from share button
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

		it("renders delete button when item has size", () => {
			render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			const deleteButton = screen.getByLabelText("Delete Task (Shift + Click to skip confirmation)")
			expect(deleteButton).toBeInTheDocument()
		})

		it("does not render delete button when item has no size", () => {
			const itemWithoutSize = { ...mockItem, size: 0 }
			render(<TaskActions item={itemWithoutSize} buttonsDisabled={false} />)

			const deleteButton = screen.queryByLabelText("Delete Task (Shift + Click to skip confirmation)")
			expect(deleteButton).not.toBeInTheDocument()
		})
	})

	describe("Button States", () => {
		it("share, export, and copy buttons are always enabled while delete button respects buttonsDisabled state", () => {
			// Test with buttonsDisabled = false
			const { rerender } = render(<TaskActions item={mockItem} buttonsDisabled={false} />)

			let shareButton = screen.getByTestId("share-button")
			let exportButton = screen.getByLabelText("Export task history")
			let copyButton = screen.getByLabelText("Copy")
			let deleteButton = screen.getByLabelText("Delete Task (Shift + Click to skip confirmation)")

			expect(shareButton).not.toBeDisabled()
			expect(exportButton).not.toBeDisabled()
			expect(copyButton).not.toBeDisabled()
			expect(deleteButton).not.toBeDisabled()

			// Test with buttonsDisabled = true
			rerender(<TaskActions item={mockItem} buttonsDisabled={true} />)

			shareButton = screen.getByTestId("share-button")
			exportButton = screen.getByLabelText("Export task history")
			copyButton = screen.getByLabelText("Copy")
			deleteButton = screen.getByLabelText("Delete Task (Shift + Click to skip confirmation)")

			// Share, export, and copy remain enabled
			expect(shareButton).not.toBeDisabled()
			expect(exportButton).not.toBeDisabled()
			expect(copyButton).not.toBeDisabled()
			// Delete button is disabled
			expect(deleteButton).toBeDisabled()
		})
	})
})
