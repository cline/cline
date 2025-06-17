// npx vitest services/marketplace/__tests__/marketplace-setting-check.spec.ts

import { webviewMessageHandler } from "../../../core/webview/webviewMessageHandler"

// Mock the provider and marketplace manager
const mockProvider = {
	getState: vi.fn(),
	postStateToWebview: vi.fn(),
	postMessageToWebview: vi.fn(),
} as any

const mockMarketplaceManager = {
	updateWithFilteredItems: vi.fn(),
} as any

describe("Marketplace General Availability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should allow marketplace API calls (marketplace is generally available)", async () => {
		// Mock state without marketplace experiment (since it's now generally available)
		mockProvider.getState.mockResolvedValue({
			experiments: {},
		})

		const message = {
			type: "filterMarketplaceItems" as const,
			filters: { type: "mcp", search: "", tags: [] },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManager)

		// Should call marketplace manager methods since marketplace is generally available
		expect(mockMarketplaceManager.updateWithFilteredItems).toHaveBeenCalledWith({
			type: "mcp",
			search: "",
			tags: [],
		})
		expect(mockProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("should allow marketplace installation (marketplace is generally available)", async () => {
		// Mock state without marketplace experiment (since it's now generally available)
		mockProvider.getState.mockResolvedValue({
			experiments: {},
		})

		const mockInstallMarketplaceItem = vi.fn().mockResolvedValue(undefined)
		const mockMarketplaceManagerWithInstall = {
			installMarketplaceItem: mockInstallMarketplaceItem,
		}

		const message = {
			type: "installMarketplaceItem" as const,
			mpItem: {
				id: "test-item",
				name: "Test Item",
				type: "mcp" as const,
				description: "Test description",
				content: "test content",
				url: "https://example.com/test-mcp",
			},
			mpInstallOptions: { target: "project" as const },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManagerWithInstall as any)

		// Should call install method since marketplace is generally available
		expect(mockInstallMarketplaceItem).toHaveBeenCalledWith(message.mpItem, message.mpInstallOptions)
	})
})
