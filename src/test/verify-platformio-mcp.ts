/**
 * Verification script for PlatformIO MCP server
 * Run with: npm run test:verify-mcp
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

async function verifyPlatformIOServer() {
	console.log("=== PlatformIO MCP Server - Connection & Tools Report ===\n")

	const serverPath = "/Users/tony/Documents/Cline/MCP/platformio-mcp/build/index.js"

	console.log("📋 Configuration:")
	console.log("   Server: github.com/jl-codes/platformio-mcp")
	console.log("   Path:", serverPath)
	console.log("   Status: Enabled\n")

	// Create MCP client
	const client = new Client(
		{
			name: "cline-verification",
			version: "1.0.0",
		},
		{
			capabilities: {},
		}
	)

	// Create stdio transport
	const transport = new StdioClientTransport({
		command: "/opt/homebrew/bin/node",
		args: [serverPath],
		env: {
			PATH: "/Users/tony/Library/Python/3.9/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
		},
	})

	try {
		console.log("🔄 Connecting to server...")
		await client.connect(transport)
		console.log("✅ Successfully connected!\n")

		// Request tools list
		console.log("📥 Fetching available tools...")
		const response = await client.request({ method: "tools/list" }, { timeout: 5000 })

		console.log(`\n✅ Found ${response.tools.length} available tools:\n`)
		console.log("=".repeat(70))

		response.tools.forEach((tool: any, index: number) => {
			console.log(`\n${index + 1}. ${tool.name}`)
			console.log("   " + "─".repeat(60))
			console.log(`   ${tool.description || "No description provided"}`)

			if (tool.inputSchema && tool.inputSchema.properties) {
				const params = Object.keys(tool.inputSchema.properties)
				console.log(`\n   Parameters (${params.length}):`)
				params.forEach((param) => {
					const schema = tool.inputSchema.properties[param]
					const required = tool.inputSchema.required?.includes(param) ? "(required)" : "(optional)"
					console.log(`     • ${param} ${required}`)
					if (schema.description) {
						console.log(`       ${schema.description}`)
					}
					if (schema.type) {
						console.log(`       Type: ${schema.type}`)
					}
				})
			}
		})

		console.log("\n" + "=".repeat(70))
		console.log(`\n✅ Verification complete - PlatformIO MCP server is fully operational`)
		console.log(`   ${response.tools.length} tools are available for use\n`)

		await client.close()
		process.exit(0)
	} catch (error) {
		console.error("\n❌ Error:", error instanceof Error ? error.message : String(error))
		if (error instanceof Error && error.stack) {
			console.error("\nStack trace:")
			console.error(error.stack)
		}
		process.exit(1)
	}
}

verifyPlatformIOServer()
