import { groupItemsByType, formatItemText, getTotalItemCount, getUniqueTypes } from "../grouping"
import { MarketplaceItem } from "@roo-code/types"

describe("grouping utilities", () => {
	const mockItems: MarketplaceItem[] = [
		{
			id: "test-server",
			name: "Test Server",
			description: "A test MCP server",
			type: "mcp",
			url: "https://example.com/test-server",
			content: "test content",
		},
		{
			id: "test-mode",
			name: "Test Mode",
			description: "A test mode",
			type: "mode",
			content: "test content",
		},
		{
			id: "another-server",
			name: "Another Server",
			description: "Another test MCP server",
			type: "mcp",
			url: "https://example.com/another-server",
			content: "test content",
		},
	]

	describe("groupItemsByType", () => {
		it("should group items by type correctly", () => {
			const result = groupItemsByType(mockItems)

			expect(Object.keys(result)).toHaveLength(2)
			expect(result["mcp"].items).toHaveLength(2)
			expect(result["mode"].items).toHaveLength(1)

			expect(result["mcp"].items[0].name).toBe("Test Server")
			expect(result["mode"].items[0].name).toBe("Test Mode")
		})

		it("should handle empty items array", () => {
			expect(groupItemsByType([])).toEqual({})
			expect(groupItemsByType(undefined)).toEqual({})
		})

		it("should handle items with missing metadata", () => {
			const itemsWithMissingData: MarketplaceItem[] = [
				{
					id: "test-item",
					name: "",
					description: "",
					type: "mcp",
					url: "https://example.com/test-item",
					content: "test content",
				},
			]

			const result = groupItemsByType(itemsWithMissingData)
			expect(result["mcp"].items[0].name).toBe("Unnamed item")
		})

		it("should preserve item order within groups", () => {
			const result = groupItemsByType(mockItems)
			const servers = result["mcp"].items

			expect(servers[0].name).toBe("Test Server")
			expect(servers[1].name).toBe("Another Server")
		})

		it("should skip items without type", () => {
			const itemsWithoutType = [
				{
					id: "test-item",
					name: "Test Item",
					description: "Test description",
					type: undefined as any, // Force undefined type to test the skip logic
					content: "test content",
				},
			] as MarketplaceItem[]

			const result = groupItemsByType(itemsWithoutType)
			expect(Object.keys(result)).toHaveLength(0)
		})
	})

	describe("formatItemText", () => {
		it("should format item with name and description", () => {
			const item = { name: "Test", description: "Description" }
			expect(formatItemText(item)).toBe("Test - Description")
		})

		it("should handle items without description", () => {
			const item = { name: "Test" }
			expect(formatItemText(item)).toBe("Test")
		})
	})

	describe("getTotalItemCount", () => {
		it("should count total items across all groups", () => {
			const groups = groupItemsByType(mockItems)
			expect(getTotalItemCount(groups)).toBe(3)
		})

		it("should handle empty groups", () => {
			expect(getTotalItemCount({})).toBe(0)
		})
	})

	describe("getUniqueTypes", () => {
		it("should return sorted array of unique types", () => {
			const groups = groupItemsByType(mockItems)
			const types = getUniqueTypes(groups)

			expect(types).toEqual(["mcp", "mode"])
		})

		it("should handle empty groups", () => {
			expect(getUniqueTypes({})).toEqual([])
		})
	})
})
