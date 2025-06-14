import { webviewMessageHandler } from "../../../core/webview/webviewMessageHandler"
import { MarketplaceManager } from "../MarketplaceManager"

// Mock the provider and marketplace manager
const mockProvider = {
	getState: jest.fn(),
	postStateToWebview: jest.fn(),
} as any

const mockMarketplaceManager = {
	updateWithFilteredItems: jest.fn(),
} as any

describe("Marketplace Setting Check", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should skip API calls when marketplace is disabled", async () => {
		// Mock experiments with marketplace disabled
		mockProvider.getState.mockResolvedValue({
			experiments: { marketplace: false },
		})

		const message = {
			type: "filterMarketplaceItems" as const,
			filters: { type: "mcp", search: "", tags: [] },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManager)

		// Should not call marketplace manager methods
		expect(mockMarketplaceManager.updateWithFilteredItems).not.toHaveBeenCalled()
		expect(mockProvider.postStateToWebview).not.toHaveBeenCalled()
	})

	it("should allow API calls when marketplace is enabled", async () => {
		// Mock experiments with marketplace enabled
		mockProvider.getState.mockResolvedValue({
			experiments: { marketplace: true },
		})

		const message = {
			type: "filterMarketplaceItems" as const,
			filters: { type: "mcp", search: "", tags: [] },
		}

		await webviewMessageHandler(mockProvider, message, mockMarketplaceManager)

		// Should call marketplace manager methods
		expect(mockMarketplaceManager.updateWithFilteredItems).toHaveBeenCalledWith({
			type: "mcp",
			search: "",
			tags: [],
		})
		expect(mockProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("should skip installation when marketplace is disabled", async () => {
		// Mock experiments with marketplace disabled
		mockProvider.getState.mockResolvedValue({
			experiments: { marketplace: false },
		})

		const mockInstallMarketplaceItem = jest.fn()
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

		// Should not call install method
		expect(mockInstallMarketplaceItem).not.toHaveBeenCalled()
	})
})
