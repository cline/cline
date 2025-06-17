import type { McpInstallationMethod } from "@roo-code/types"
import { mcpInstallationMethodSchema, mcpMarketplaceItemSchema } from "@roo-code/types"

describe("Nested Parameters", () => {
	describe("McpInstallationMethod Schema", () => {
		it("should validate installation method without parameters", () => {
			const method = {
				name: "Docker Installation",
				content: '{"command": "docker", "args": ["run", "image"]}',
			}

			const result = mcpInstallationMethodSchema.parse(method)
			expect(result.parameters).toBeUndefined()
		})

		it("should validate installation method with parameters", () => {
			const method = {
				name: "Docker Installation",
				content: '{"command": "docker", "args": ["run", "-p", "{{port}}:8080", "{{image}}"]}',
				parameters: [
					{
						name: "Port",
						key: "port",
						placeholder: "8080",
						optional: true,
					},
					{
						name: "Docker Image",
						key: "image",
						placeholder: "latest",
					},
				],
			}

			const result = mcpInstallationMethodSchema.parse(method)
			expect(result.parameters).toHaveLength(2)
			expect(result.parameters![0].key).toBe("port")
			expect(result.parameters![0].optional).toBe(true)
			expect(result.parameters![1].key).toBe("image")
			expect(result.parameters![1].optional).toBe(false)
		})

		it("should validate installation method with empty parameters array", () => {
			const method = {
				name: "Simple Installation",
				content: '{"command": "npm", "args": ["start"]}',
				parameters: [],
			}

			const result = mcpInstallationMethodSchema.parse(method)
			expect(result.parameters).toEqual([])
		})
	})

	describe("McpMarketplaceItem with Nested Parameters", () => {
		it("should validate MCP item with global and method-specific parameters", () => {
			const item = {
				id: "multi-method-mcp",
				name: "Multi-Method MCP",
				description: "MCP with multiple installation methods",
				url: "https://github.com/example/mcp",
				parameters: [
					{
						name: "API Key",
						key: "api_key",
						placeholder: "Enter your API key",
					},
				],
				content: [
					{
						name: "Docker Installation",
						content: '{"command": "docker", "args": ["-e", "API_KEY={{api_key}}", "-p", "{{port}}:8080"]}',
						parameters: [
							{
								name: "Port",
								key: "port",
								placeholder: "8080",
								optional: true,
							},
						],
					},
					{
						name: "NPM Installation",
						content: '{"command": "npx", "args": ["package@{{version}}", "--api-key", "{{api_key}}"]}',
						parameters: [
							{
								name: "Package Version",
								key: "version",
								placeholder: "latest",
								optional: true,
							},
						],
					},
				],
			}

			const result = mcpMarketplaceItemSchema.parse(item)
			expect(result.parameters).toHaveLength(1)
			expect(result.parameters![0].key).toBe("api_key")

			expect(Array.isArray(result.content)).toBe(true)
			const methods = result.content as McpInstallationMethod[]
			expect(methods).toHaveLength(2)

			expect(methods[0].parameters).toHaveLength(1)
			expect(methods[0].parameters![0].key).toBe("port")

			expect(methods[1].parameters).toHaveLength(1)
			expect(methods[1].parameters![0].key).toBe("version")
		})

		it("should validate MCP item with only global parameters", () => {
			const item = {
				id: "global-only-mcp",
				name: "Global Only MCP",
				description: "MCP with only global parameters",
				url: "https://github.com/example/mcp",
				parameters: [
					{
						name: "API Key",
						key: "api_key",
						placeholder: "Enter your API key",
					},
				],
				content: [
					{
						name: "Installation",
						content: '{"command": "npm", "args": ["--api-key", "{{api_key}}"]}',
					},
				],
			}

			const result = mcpMarketplaceItemSchema.parse(item)
			expect(result.parameters).toHaveLength(1)

			const methods = result.content as McpInstallationMethod[]
			expect(methods[0].parameters).toBeUndefined()
		})

		it("should validate MCP item with only method-specific parameters", () => {
			const item = {
				id: "method-only-mcp",
				name: "Method Only MCP",
				description: "MCP with only method-specific parameters",
				url: "https://github.com/example/mcp",
				content: [
					{
						name: "Docker Installation",
						content: '{"command": "docker", "args": ["-p", "{{port}}:8080"]}',
						parameters: [
							{
								name: "Port",
								key: "port",
								placeholder: "8080",
								optional: true,
							},
						],
					},
				],
			}

			const result = mcpMarketplaceItemSchema.parse(item)
			expect(result.parameters).toBeUndefined()

			const methods = result.content as McpInstallationMethod[]
			expect(methods[0].parameters).toHaveLength(1)
			expect(methods[0].parameters![0].key).toBe("port")
		})

		it("should validate MCP item with no parameters at all", () => {
			const item = {
				id: "no-params-mcp",
				name: "No Parameters MCP",
				description: "MCP with no parameters",
				url: "https://github.com/example/mcp",
				content: [
					{
						name: "Simple Installation",
						content: '{"command": "npm", "args": ["start"]}',
					},
				],
			}

			const result = mcpMarketplaceItemSchema.parse(item)
			expect(result.parameters).toBeUndefined()

			const methods = result.content as McpInstallationMethod[]
			expect(methods[0].parameters).toBeUndefined()
		})
	})

	describe("Parameter Key Conflicts", () => {
		it("should allow same parameter key in global and method-specific parameters", () => {
			const item = {
				id: "conflict-mcp",
				name: "Conflict MCP",
				description: "MCP with parameter key conflicts",
				url: "https://github.com/example/mcp",
				parameters: [
					{
						name: "Global Version",
						key: "version",
						placeholder: "1.0.0",
					},
				],
				content: [
					{
						name: "Method Installation",
						content: '{"command": "npm", "args": ["package@{{version}}"]}',
						parameters: [
							{
								name: "Method Version",
								key: "version",
								placeholder: "latest",
								optional: true,
							},
						],
					},
				],
			}

			// This should validate successfully - the conflict resolution happens at runtime
			const result = mcpMarketplaceItemSchema.parse(item)
			expect(result.parameters![0].key).toBe("version")

			const methods = result.content as McpInstallationMethod[]
			expect(methods[0].parameters![0].key).toBe("version")
		})
	})
})
