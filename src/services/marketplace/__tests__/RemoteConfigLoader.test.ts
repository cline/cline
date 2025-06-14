import axios from "axios"
import { RemoteConfigLoader } from "../RemoteConfigLoader"
import type { MarketplaceItemType } from "@roo-code/types"

// Mock axios
jest.mock("axios")
const mockedAxios = axios as jest.Mocked<typeof axios>

// Mock the cloud config
jest.mock("@roo-code/cloud", () => ({
	getRooCodeApiUrl: () => "https://test.api.com",
}))

describe("RemoteConfigLoader", () => {
	let loader: RemoteConfigLoader

	beforeEach(() => {
		loader = new RemoteConfigLoader()
		jest.clearAllMocks()
		// Clear any existing cache
		loader.clearCache()
	})

	describe("loadAllItems", () => {
		it("should fetch and combine modes and MCPs from API", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "customModes:\\n  - slug: test\\n    name: Test"`

			const mockMcpsYaml = `items:
  - id: "test-mcp"
    name: "Test MCP"
    description: "A test MCP"
    url: "https://github.com/test/test-mcp"
    content: '{"command": "test"}'`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()

			expect(mockedAxios.get).toHaveBeenCalledTimes(2)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://test.api.com/api/marketplace/modes",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)
			expect(mockedAxios.get).toHaveBeenCalledWith(
				"https://test.api.com/api/marketplace/mcps",
				expect.objectContaining({
					timeout: 10000,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
					},
				}),
			)

			expect(items).toHaveLength(2)
			expect(items[0]).toEqual({
				type: "mode",
				id: "test-mode",
				name: "Test Mode",
				description: "A test mode",
				content: "customModes:\n  - slug: test\n    name: Test",
			})
			expect(items[1]).toEqual({
				type: "mcp",
				id: "test-mcp",
				name: "Test MCP",
				description: "A test MCP",
				url: "https://github.com/test/test-mcp",
				content: '{"command": "test"}',
			})
		})

		it("should use cache on subsequent calls", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items:
  - id: "test-mcp"
    name: "Test MCP"
    description: "A test MCP"
    url: "https://github.com/test/test-mcp"
    content: "test content"`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call - should hit API
			const items1 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call - should use cache
			const items2 = await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2) // Still 2, not 4

			expect(items1).toEqual(items2)
		})

		it("should retry on network failures", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			// Mock modes endpoint to fail twice then succeed
			let modesCallCount = 0
			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					modesCallCount++
					if (modesCallCount <= 2) {
						return Promise.reject(new Error("Network error"))
					}
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const items = await loader.loadAllItems()

			// Should have retried modes endpoint 3 times (2 failures + 1 success)
			expect(modesCallCount).toBe(3)
			expect(items).toHaveLength(1)
			expect(items[0].type).toBe("mode")
		})

		it("should throw error after max retries", async () => {
			mockedAxios.get.mockRejectedValue(new Error("Persistent network error"))

			await expect(loader.loadAllItems()).rejects.toThrow("Persistent network error")

			// Both endpoints will be called with retries since Promise.all starts both promises
			// Each endpoint retries 3 times, but due to Promise.all behavior, one might fail faster
			expect(mockedAxios.get).toHaveBeenCalledWith(
				expect.stringContaining("/api/marketplace/"),
				expect.any(Object),
			)
			// Verify we got at least some retry attempts (should be at least 2 calls)
			expect(mockedAxios.get.mock.calls.length).toBeGreaterThanOrEqual(2)
		})

		it("should handle invalid data gracefully", async () => {
			const invalidModesYaml = `items:
  - id: "invalid-mode"
    # Missing required fields like name and description`

			const validMcpsYaml = `items:
  - id: "valid-mcp"
    name: "Valid MCP"
    description: "A valid MCP"
    url: "https://github.com/test/test-mcp"
    content: "test content"`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: invalidModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: validMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Should throw validation error for invalid modes
			await expect(loader.loadAllItems()).rejects.toThrow()
		})
	})

	describe("getItem", () => {
		it("should find specific item by id and type", async () => {
			const mockModesYaml = `items:
  - id: "target-mode"
    name: "Target Mode"
    description: "The mode we want"
    content: "test content"`

			const mockMcpsYaml = `items:
  - id: "target-mcp"
    name: "Target MCP"
    description: "The MCP we want"
    url: "https://github.com/test/test-mcp"
    content: "test content"`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			const modeItem = await loader.getItem("target-mode", "mode" as MarketplaceItemType)
			const mcpItem = await loader.getItem("target-mcp", "mcp" as MarketplaceItemType)
			const notFound = await loader.getItem("nonexistent", "mode" as MarketplaceItemType)

			expect(modeItem).toEqual({
				type: "mode",
				id: "target-mode",
				name: "Target Mode",
				description: "The mode we want",
				content: "test content",
			})

			expect(mcpItem).toEqual({
				type: "mcp",
				id: "target-mcp",
				name: "Target MCP",
				description: "The MCP we want",
				url: "https://github.com/test/test-mcp",
				content: "test content",
			})

			expect(notFound).toBeNull()
		})
	})

	describe("clearCache", () => {
		it("should clear cache and force fresh API calls", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Clear cache
			loader.clearCache()

			// Third call - should hit API again
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)
		})
	})

	describe("cache expiration", () => {
		it("should expire cache after 5 minutes", async () => {
			const mockModesYaml = `items:
  - id: "test-mode"
    name: "Test Mode"
    description: "A test mode"
    content: "test content"`

			const mockMcpsYaml = `items: []`

			mockedAxios.get.mockImplementation((url) => {
				if (url.includes("/modes")) {
					return Promise.resolve({ data: mockModesYaml })
				}
				if (url.includes("/mcps")) {
					return Promise.resolve({ data: mockMcpsYaml })
				}
				return Promise.reject(new Error("Unknown URL"))
			})

			// Mock Date.now to control time
			const originalDateNow = Date.now
			let currentTime = 1000000

			Date.now = jest.fn(() => currentTime)

			// First call
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Second call immediately - should use cache
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(2)

			// Advance time by 6 minutes (360,000 ms)
			currentTime += 6 * 60 * 1000

			// Third call - cache should be expired
			await loader.loadAllItems()
			expect(mockedAxios.get).toHaveBeenCalledTimes(4)

			// Restore original Date.now
			Date.now = originalDateNow
		})
	})
})
