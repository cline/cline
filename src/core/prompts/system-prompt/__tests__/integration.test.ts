/**
 * System Prompt Integration Tests with Snapshot Testing
 *
 * This test suite validates that system prompts remain consistent across different
 * model families and context configurations using snapshot testing.
 *
 * Usage:
 * - Run tests normally: `npm run test:unit -- --update-snapshots`
 *   Tests will fail if generated prompts don't match existing snapshots
 *
 * - Update snapshots: `npm run test:unit -- --update-snapshots`
 *   This will regenerate all snapshot files with current prompt output
 *
 * When tests fail:
 * 1. Review the differences shown in the error message
 * 2. Determine if changes are intentional (e.g., prompt improvements)
 * 3. If changes are correct, run with --update-snapshots to update baselines
 * 4. If changes are unintentional, investigate why prompt generation changed
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { ModelFamily } from "@/shared/prompts"
import { getSystemPrompt } from "../index"
import type { SystemPromptContext } from "../types"

// Check if snapshots should be updated via process argument
const UPDATE_SNAPSHOTS = process.argv.includes("--update-snapshots") || process.env.UPDATE_SNAPSHOTS === "true"

// Helper to format snapshot mismatch error messages
const formatSnapshotError = (snapshotName: string, differences: string): string => {
	return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SNAPSHOT MISMATCH: ${snapshotName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${differences}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 HOW TO FIX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 📋 Review the differences above to understand what changed
2. 🤔 Determine if the changes are intentional:
   - ✅ Expected changes (prompt improvements, new features)
   - ❌ Unexpected changes (bugs, regressions)

3. 🔄 If changes are correct, update snapshots:
   npm run test:unit -- --update-snapshots

4. 🐛 If changes are unintentional, investigate:
   - Check recent changes to prompt generation logic
   - Verify context/configuration hasn't changed unexpectedly
   - Look for dependency updates that might affect output

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
}

// Helper to compare two strings and return differences
const compareStrings = (expected: string, actual: string): string | null => {
	if (expected === actual) {
		return null
	}

	const expectedLines = expected.split("\n")
	const actualLines = actual.split("\n")
	const maxLines = Math.max(expectedLines.length, actualLines.length)
	const differences: string[] = []

	for (let i = 0; i < maxLines; i++) {
		const expectedLine = expectedLines[i] || ""
		const actualLine = actualLines[i] || ""

		if (expectedLine !== actualLine) {
			if (differences.length < 10) {
				// Limit to first 10 differences for readability
				differences.push(`Line ${i + 1}:`)
				if (expectedLine) {
					differences.push(`  - Expected: ${expectedLine.substring(0, 100)}${expectedLine.length > 100 ? "..." : ""}`)
				}
				if (actualLine) {
					differences.push(`  + Actual:   ${actualLine.substring(0, 100)}${actualLine.length > 100 ? "..." : ""}`)
				}
			}
		}
	}

	if (differences.length === 0) {
		return null
	}

	const summary = [
		`Expected length: ${expected.length} characters`,
		`Actual length: ${actual.length} characters`,
		`Line count difference: ${expectedLines.length} vs ${actualLines.length}`,
		"",
		"First differences:",
		...differences,
	]

	if (differences.length >= 10) {
		summary.push("... and more differences")
	}

	return summary.join("\n")
}

export const mockProviderInfo = {
	providerId: "test",
	model: {
		id: "fast",
		info: {
			supportsPromptCache: false,
		},
	},
}

const makeMockProviderInfo = (modelId: string, providerId: string = "test") => ({
	providerId: modelId.includes("ollama") ? "ollama" : providerId,
	model: {
		...mockProviderInfo.model,
		id: modelId,
	},
	customPrompt: providerId.includes("lmstudio") || providerId.includes("ollama") ? "compact" : undefined,
})

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
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
	} as unknown as McpHub,
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
	providerInfo: mockProviderInfo,
	enableNativeToolCalls: false,
}

describe("Prompt System Integration Tests", () => {
	beforeEach(() => {
		// Reset any necessary state before each test
	})

	// Show helpful information about snapshot testing mode
	before(() => {
		if (UPDATE_SNAPSHOTS) {
			console.log("🔄 SNAPSHOT UPDATE MODE: Will update all snapshot files with current output")
		} else {
			console.log("✅ SNAPSHOT TEST MODE: Will compare against existing snapshots")
		}
	})
	const contextVariations = [
		{ name: "basic", baseContext: { ...baseContext } },
		{
			name: "no-browser",
			baseContext: { ...baseContext, supportsBrowserUse: false },
		},
		{
			name: "no-mcp",
			baseContext: { ...baseContext, mcpHub: { getServers: () => [] } },
		},
		{
			name: "no-focus-chain",
			baseContext: { ...baseContext, focusChainSettings: { enabled: false } },
		},
	]

	// Table-driven test cases for different model families
	const modelTestCases = [
		{
			modelGroup: ModelFamily.GENERIC,
			modelIds: ["gpt-3"],
			providerId: "openai",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.GLM,
			modelIds: ["glm-4.6"],
			providerId: "zai",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.NEXT_GEN,
			modelIds: ["claude-sonnet-4"],
			providerId: "anthropic",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.XS,
			modelIds: ["qwen3_coder"],
			providerId: "lmstudio",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.NATIVE_NEXT_GEN,
			modelIds: ["claude-4-5-sonnet"],
			providerId: "cline",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.GPT_5,
			modelIds: ["gpt-5"],
			providerId: "openai",
			contextVariations,
		},
		{
			modelGroup: ModelFamily.NATIVE_GPT_5,
			modelIds: ["gpt-5-codex"],
			providerId: "openai",
			contextVariations,
		},
	]

	// Generate snapshots for all model/context combinations
	describe("Snapshot Testing", () => {
		const snapshotsDir = path.join(__dirname, "__snapshots__")

		before(async () => {
			// Ensure snapshots directory exists
			try {
				await fs.mkdir(snapshotsDir, { recursive: true })
			} catch {
				// Directory might already exist
			}
		})

		for (const { modelGroup, modelIds, providerId, contextVariations } of modelTestCases) {
			describe(`${modelGroup} Model Group`, () => {
				for (const modelId of modelIds) {
					for (const { name: contextName, baseContext } of contextVariations) {
						const context = {
							...baseContext,
							providerInfo: makeMockProviderInfo(modelId, providerId),
							isTesting: true,
							enableNativeToolCalls:
								modelGroup === ModelFamily.NATIVE_NEXT_GEN || modelGroup === ModelFamily.NATIVE_GPT_5,
						}
						it(`should generate consistent prompt for ${providerId}/${modelId} with ${contextName} context`, async function () {
							this.timeout(30000) // Allow more time for prompt generation

							try {
								const { systemPrompt } = await getSystemPrompt(context as SystemPromptContext)

								// Basic structure assertions
								expect(systemPrompt).to.be.a("string")
								expect(systemPrompt.length).to.be.greaterThan(100)
								expect(systemPrompt).to.not.include("{{TOOL_USE_SECTION}}") // Tools placeholder should be removed

								// Snapshot testing logic
								const snapshotName = `${providerId}_${modelId.replace(/[^a-zA-Z0-9]/g, "_")}-${contextName}.snap`
								const snapshotPath = path.join(snapshotsDir, snapshotName)

								if (UPDATE_SNAPSHOTS) {
									// Update mode: write new snapshot
									await fs.writeFile(snapshotPath, systemPrompt, "utf-8")
									console.log(`Updated snapshot: ${snapshotName} (${systemPrompt.length} chars)`)
								} else {
									// Test mode: compare with existing snapshot
									try {
										const existingSnapshot = await fs.readFile(snapshotPath, "utf-8")
										const differences = compareStrings(existingSnapshot, systemPrompt)

										if (differences) {
											throw new Error(formatSnapshotError(snapshotName, differences))
										}

										console.log(`✓ Snapshot matches: ${snapshotName}`)
									} catch (error) {
										if (error instanceof Error && (error as any).code === "ENOENT") {
											// Snapshot doesn't exist
											throw new Error(
												formatSnapshotError(
													snapshotName,
													`Snapshot file does not exist: ${snapshotPath}\n` +
														`This is a new test case. Run with --update-snapshots to create the initial snapshot.`,
												),
											)
										}
										// Re-throw comparison errors
										throw error
									}
								}
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
		it("should include browser-specific content when browser is enabled", async function () {
			this.timeout(30000)

			const contextWithBrowser = { ...baseContext, supportsBrowserUse: true }

			try {
				const { systemPrompt } = await getSystemPrompt(contextWithBrowser)
				expect(systemPrompt.toLowerCase()).to.include("browser")
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
				const { systemPrompt } = await getSystemPrompt(baseContext)
				expect(systemPrompt).to.include("MCP")
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
				const { systemPrompt } = await getSystemPrompt(baseContext)
				expect(systemPrompt).to.include("TODO")
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
				const { systemPrompt } = await getSystemPrompt(baseContext)
				expect(systemPrompt).to.include("USER'S CUSTOM INSTRUCTIONS")
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
			const { systemPrompt } = await getSystemPrompt(invalidContext)
			expect(systemPrompt).to.be.a("string")
		})

		it("should handle undefined context properties", async function () {
			this.timeout(30000)

			const contextWithNulls: SystemPromptContext = {
				cwd: undefined,
				ide: "",
				supportsBrowserUse: undefined,
				mcpHub: undefined,
				focusChainSettings: undefined,
				providerInfo: baseContext.providerInfo,
			}

			try {
				const { systemPrompt } = await getSystemPrompt(contextWithNulls)
				expect(systemPrompt).to.be.a("string")
				expect(systemPrompt).to.include("{{TOOL_USE_SECTION}}")
			} catch (error) {
				// Error is acceptable for invalid context
				expect(error).to.be.instanceOf(Error)
			}
		})
	})
})
