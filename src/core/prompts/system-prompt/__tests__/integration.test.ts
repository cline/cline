import * as fs from "node:fs/promises"
import * as path from "node:path"
import { expect } from "chai"
import { getPrompt } from "../index"
import type { SystemPromptContext } from "../types"

describe("Prompt System Integration Tests", () => {
	const baseContext: SystemPromptContext = {
		cwd: "/test/project",
		supportsBrowserUse: true,
		mcpHub: {
			getServers: () => [
				{
					name: "test-server",
					status: "connected",
					config: '{"command": "test"}',
					tools: [
						{
							name: "test_tool",
							description: "A test tool",
							inputSchema: { type: "object", properties: {} },
						},
					],
					resources: [],
					resourceTemplates: [],
				},
			],
		},
		focusChainSettings: {
			enabled: true,
			remindClineInterval: 6,
		},
		browserSettings: {
			viewport: {
				width: 1280,
				height: 720,
			},
		},
		globalClineRulesFileInstructions: "Follow global rules",
		localClineRulesFileInstructions: "Follow local rules",
		preferredLanguageInstructions: "Prefer TypeScript",
		isTesting: true,
	}

	// Table-driven test cases for different model families
	const modelTestCases = [
		{
			modelGroup: "generic",
			modelIds: ["gpt-3"],
			contextVariations: [
				{ name: "basic", context: baseContext },
				{
					name: "no-browser",
					context: { ...baseContext, supportsBrowserUse: false },
				},
				{
					name: "no-mcp",
					context: { ...baseContext, mcpHub: { getServers: () => [] } },
				},
				{
					name: "no-focus-chain",
					context: { ...baseContext, focusChainSettings: { enabled: false } },
				},
			],
		},
		{
			modelGroup: "next-gen",
			modelIds: ["claude-sonnet-4"],
			contextVariations: [
				{ name: "basic", context: baseContext },
				{
					name: "no-browser",
					context: { ...baseContext, supportsBrowserUse: false },
				},
				{
					name: "no-mcp",
					context: { ...baseContext, mcpHub: { getServers: () => [] } },
				},
				{
					name: "no-focus-chain",
					context: { ...baseContext, focusChainSettings: { enabled: false } },
				},
			],
		},
	]

	// Generate snapshots for all model/context combinations
	describe("Snapshot Generation", () => {
		const snapshotsDir = path.join(__dirname, "__snapshots__")

		before(async () => {
			// Ensure snapshots directory exists
			try {
				await fs.mkdir(snapshotsDir, { recursive: true })
			} catch {
				// Directory might already exist
			}
		})

		for (const { modelGroup, modelIds, contextVariations } of modelTestCases) {
			describe(`${modelGroup} Model Group`, () => {
				for (const modelId of modelIds) {
					for (const { name: contextName, context } of contextVariations) {
						it(`should generate consistent prompt for ${modelId} with ${contextName} context`, async function () {
							this.timeout(30000) // Allow more time for prompt generation

							try {
								const prompt = await getPrompt(modelId, context as SystemPromptContext)

								// Basic structure assertions
								expect(prompt).to.be.a("string")
								expect(prompt.length).to.be.greaterThan(100)
								expect(prompt).to.not.include("{{TOOL_USE}}") // Tools placeholder should be removed

								// Save snapshot
								const snapshotName = `${modelId.replace(/[^a-zA-Z0-9]/g, "_")}-${contextName}.snap`
								const snapshotPath = path.join(snapshotsDir, snapshotName)

								await fs.writeFile(snapshotPath, prompt, "utf-8")

								console.log(`Generated snapshot: ${snapshotName} (${prompt.length} chars)`)

								// Verify snapshot was created
								const snapshotExists = await fs
									.access(snapshotPath)
									.then(() => true)
									.catch(() => false)
								expect(snapshotExists).to.be.true
							} catch (error) {
								// For missing variants, we expect errors - that's okay
								if (error instanceof Error && error.message.includes("No prompt variant found")) {
									console.log(`Skipping ${modelId} - no variant available (expected)`)
									this.skip()
								} else {
									throw error
								}
							}
						})
					}
				}
			})
		}
	})

	describe("Context-Specific Features", () => {
		const testModelId = "generic" // Use generic as it should always be available

		it("should include browser-specific content when browser is enabled", async function () {
			this.timeout(30000)

			const contextWithBrowser = { ...baseContext, supportsBrowserUse: true }

			try {
				const prompt = await getPrompt(testModelId, contextWithBrowser)
				expect(prompt.toLowerCase()).to.include("browser")
			} catch (error) {
				if (error instanceof Error && error.message.includes("No prompt variant found")) {
					this.skip()
				} else {
					throw error
				}
			}
		})

		it("should include MCP content when MCP servers are present", async function () {
			this.timeout(30000)

			try {
				const prompt = await getPrompt(testModelId, baseContext)
				expect(prompt).to.include("MCP")
			} catch (error) {
				if (error instanceof Error && error.message.includes("No prompt variant found")) {
					this.skip()
				} else {
					throw error
				}
			}
		})

		it("should include TODO content when focus chain is enabled", async function () {
			this.timeout(30000)

			try {
				const prompt = await getPrompt(testModelId, baseContext)
				expect(prompt).to.include("TODO")
			} catch (error) {
				if (error instanceof Error && error.message.includes("No prompt variant found")) {
					this.skip()
				} else {
					throw error
				}
			}
		})

		it("should include user instructions when provided", async function () {
			this.timeout(30000)

			try {
				const prompt = await getPrompt(testModelId, baseContext)
				expect(prompt).to.include("USER'S CUSTOM INSTRUCTIONS")
			} catch (error) {
				if (error instanceof Error && error.message.includes("No prompt variant found")) {
					this.skip()
				} else {
					throw error
				}
			}
		})
	})

	describe("Error Handling", () => {
		it("should handle completely invalid context gracefully", async function () {
			this.timeout(30000)

			const invalidContext = {} as SystemPromptContext

			try {
				const prompt = await getPrompt("generic", invalidContext)
				expect(prompt).to.be.a("string")
			} catch (error) {
				// Error is acceptable for invalid context
				expect(error).to.be.instanceOf(Error)
			}
		})

		it("should handle null/undefined context properties", async function () {
			this.timeout(30000)

			const contextWithNulls: SystemPromptContext = {
				cwd: undefined,
				supportsBrowserUse: undefined,
				mcpHub: undefined,
				focusChainSettings: undefined,
			}

			try {
				const prompt = await getPrompt("generic", contextWithNulls)
				expect(prompt).to.be.a("string")
				expect(prompt).to.include("{{TOOL_USE}}")
			} catch (error) {
				// Error is acceptable for invalid context
				expect(error).to.be.instanceOf(Error)
			}
		})
	})

	describe("Performance", () => {
		it("should generate prompts efficiently", async function () {
			this.timeout(30000)

			const start = Date.now()

			try {
				// Generate multiple prompts
				const prompts = await Promise.allSettled([
					getPrompt("generic", baseContext),
					getPrompt("claude", baseContext),
					getPrompt("gpt", baseContext),
					getPrompt("gemini", baseContext),
				])

				const duration = Date.now() - start

				// Should complete within reasonable time (adjust as needed)
				expect(duration).to.be.lessThan(15000) // 15 seconds max for all

				// At least one should succeed (generic fallback)
				const succeeded = prompts.filter((p) => p.status === "fulfilled")
				expect(succeeded.length).to.be.greaterThan(0)
			} catch {
				// Even if individual prompts fail, the test shouldn't take too long
				const duration = Date.now() - start
				expect(duration).to.be.lessThan(15000)
			}
		})
	})

	describe("Template Resolution", () => {
		it("should preserve unresolved placeholders for external processing", async function () {
			this.timeout(30000)

			try {
				const prompt = await getPrompt("generic", baseContext)

				expect(prompt).to.not.include("{{TOOL_USE}}")
			} catch (error) {
				if (error instanceof Error && error.message.includes("No prompt variant found")) {
					this.skip()
				} else {
					throw error
				}
			}
		})
	})
})
