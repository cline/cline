/**
 * System Prompt Integration Tests with Snapshot Testing
 *
 * This test suite validates that system prompts remain consistent across different
 * model families and context configurations using snapshot testing.
 *
 * Usage:
 * - Run tests normally: `npm test` or `yarn test`
 *   Tests will fail if generated prompts don't match existing snapshots
 *
 * - Update snapshots: `npm test -- --update-snapshots` or `yarn test --update-snapshots`
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
const UPDATE_SNAPSHOTS = process.argv.includes("--update-snapshots")

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
   npm test -- --update-snapshots
   # or
   yarn test --update-snapshots

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
}

const makeMockContext = (modelId: string, providerId: string = "test"): SystemPromptContext => ({
	...baseContext,
	providerInfo: makeMockProviderInfo(modelId, providerId),
})

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
						}
						it(`should generate consistent prompt for ${providerId}/${modelId} with ${contextName} context`, async function () {
							this.timeout(30000) // Allow more time for prompt generation

							try {
								const prompt = await getSystemPrompt(context as SystemPromptContext)

								// Basic structure assertions
								expect(prompt).to.be.a("string")
								expect(prompt.length).to.be.greaterThan(100)
								expect(prompt).to.not.include("{{TOOL_USE_SECTION}}") // Tools placeholder should be removed

								// Snapshot testing logic
								const snapshotName = `${providerId}_${modelId.replace(/[^a-zA-Z0-9]/g, "_")}-${contextName}.snap`
								const snapshotPath = path.join(snapshotsDir, snapshotName)

								if (UPDATE_SNAPSHOTS) {
									// Update mode: write new snapshot
									await fs.writeFile(snapshotPath, prompt, "utf-8")
									console.log(`Updated snapshot: ${snapshotName} (${prompt.length} chars)`)
								} else {
									// Test mode: compare with existing snapshot
									try {
										const existingSnapshot = await fs.readFile(snapshotPath, "utf-8")
										const differences = compareStrings(existingSnapshot, prompt)

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
										} else {
											// Re-throw comparison errors
											throw error
										}
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
				const prompt = await getSystemPrompt(contextWithBrowser)
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
				const prompt = await getSystemPrompt(baseContext)
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
				const prompt = await getSystemPrompt(baseContext)
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
				const prompt = await getSystemPrompt(baseContext)
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
				const prompt = await getSystemPrompt(invalidContext)
				expect(prompt).to.be.a("string")
			} catch (error) {
				// Error is acceptable for invalid context
				expect(error).to.be.instanceOf(Error)
			}
		})

		it("should handle undefined context properties", async function () {
			this.timeout(30000)

			const contextWithNulls: SystemPromptContext = {
				cwd: undefined,
				supportsBrowserUse: undefined,
				mcpHub: undefined,
				focusChainSettings: undefined,
				providerInfo: baseContext.providerInfo,
			}

			try {
				const prompt = await getSystemPrompt(contextWithNulls)
				expect(prompt).to.be.a("string")
				expect(prompt).to.include("{{TOOL_USE_SECTION}}")
			} catch (error) {
				// Error is acceptable for invalid context
				expect(error).to.be.instanceOf(Error)
			}
		})
	})

	describe("Legacy Prompt Compatibility", () => {
		// Import old prompt functions
		let SYSTEM_PROMPT_NEXT_GEN: any
		let SYSTEM_PROMPT_GENERIC: any

		before(async () => {
			const nextGenModule = await import("../../system-prompt-legacy/families/next-gen-models/next-gen-system-prompt")
			const genericModule = await import("../../system-prompt-legacy/generic-system-prompt")
			SYSTEM_PROMPT_NEXT_GEN = nextGenModule.SYSTEM_PROMPT_NEXT_GEN
			SYSTEM_PROMPT_GENERIC = genericModule.SYSTEM_PROMPT_GENERIC
		})

		// Helper function to extract section titles from prompt text
		const extractSectionTitles = (prompt: string): string[] => {
			const lines = prompt.split("\n")
			const titles: string[] = []

			for (const line of lines) {
				// Look for lines that start with # (markdown headers)
				const headerMatch = line.match(/^#+\s+(.+)$/)
				if (headerMatch) {
					titles.push(headerMatch[1].trim())
				}
				// Look for lines that are all caps (like "TOOL USE", "BROWSER USE", etc.)
				else if (line.match(/^[A-Z\s]+$/) && line.trim().length > 3) {
					titles.push(line.trim())
				}
				// Look for lines with === or --- separators
				else if (line.match(/^[=-]+$/) && titles.length > 0) {
					// This is a separator, the previous title might be the actual section
					const prevTitle = titles[titles.length - 1]
					if (prevTitle && prevTitle.length > 0) {
						// Keep the previous title as it's likely a section header
					}
				}
			}

			return titles.filter((title) => title.length > 0)
		}

		// Helper function to build old prompt with context
		const buildOldPrompt = async (promptType: "next-gen" | "generic", focusChainEnabled: boolean): Promise<string> => {
			const mockMcpHub = {
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
			} as unknown as McpHub

			const mockBrowserSettings = {
				viewport: {
					width: 1280,
					height: 720,
				},
			}

			const mockFocusChainSettings = {
				enabled: focusChainEnabled,
				remindClineInterval: 6,
			}

			if (promptType === "next-gen") {
				return await SYSTEM_PROMPT_NEXT_GEN(
					"/test/project",
					true,
					mockMcpHub,
					mockBrowserSettings,
					mockFocusChainSettings,
				)
			} else {
				return await SYSTEM_PROMPT_GENERIC("/test/project", true, mockMcpHub, mockBrowserSettings, mockFocusChainSettings)
			}
		}

		it("should generate old prompts with focus chain enabled and disabled", async function () {
			this.timeout(30000)

			// Generate old prompts with different focus chain settings
			const oldNextGenWithFocus = await buildOldPrompt("next-gen", true)
			const oldNextGenWithoutFocus = await buildOldPrompt("next-gen", false)
			const oldGenericWithFocus = await buildOldPrompt("generic", true)
			const oldGenericWithoutFocus = await buildOldPrompt("generic", false)

			// Basic validation
			expect(oldNextGenWithFocus).to.be.a("string")
			expect(oldNextGenWithoutFocus).to.be.a("string")
			expect(oldGenericWithFocus).to.be.a("string")
			expect(oldGenericWithoutFocus).to.be.a("string")

			// Check that focus chain content is present when enabled
			expect(oldNextGenWithFocus).to.include("task_progress")
			expect(oldGenericWithFocus).to.include("task_progress")

			// Check that focus chain content is absent when disabled
			expect(oldNextGenWithoutFocus).to.not.include("task_progress")
			expect(oldGenericWithoutFocus).to.not.include("task_progress")

			// Snapshot testing for old prompts
			const snapshotsDir = path.join(__dirname, "__snapshots__")
			await fs.mkdir(snapshotsDir, { recursive: true })

			const snapshots = [
				{ name: "old-next-gen-with-focus.snap", content: oldNextGenWithFocus },
				{ name: "old-next-gen-without-focus.snap", content: oldNextGenWithoutFocus },
				{ name: "old-generic-with-focus.snap", content: oldGenericWithFocus },
				{ name: "old-generic-without-focus.snap", content: oldGenericWithoutFocus },
			]

			for (const snapshot of snapshots) {
				const snapshotPath = path.join(snapshotsDir, snapshot.name)

				if (UPDATE_SNAPSHOTS) {
					// Update mode: write new snapshot
					await fs.writeFile(snapshotPath, snapshot.content, "utf-8")
					console.log(`Updated old prompt snapshot: ${snapshot.name} (${snapshot.content.length} chars)`)
				} else {
					// Test mode: compare with existing snapshot
					try {
						const existingSnapshot = await fs.readFile(snapshotPath, "utf-8")
						const differences = compareStrings(existingSnapshot, snapshot.content)

						if (differences) {
							throw new Error(formatSnapshotError(snapshot.name, differences))
						}

						console.log(`✓ Old prompt snapshot matches: ${snapshot.name}`)
					} catch (error) {
						if (error instanceof Error && (error as any).code === "ENOENT") {
							// Snapshot doesn't exist
							throw new Error(
								formatSnapshotError(
									snapshot.name,
									`Old prompt snapshot file does not exist: ${snapshotPath}\n` +
										`This is a new test case. Run with --update-snapshots to create the initial snapshot.`,
								),
							)
						} else {
							// Re-throw comparison errors
							throw error
						}
					}
				}
			}
		})

		it("should compare old and new prompts for section title compatibility", async function () {
			this.timeout(30000)

			// Generate old prompts
			const oldNextGenWithFocus = await buildOldPrompt("next-gen", true)
			const oldGenericWithFocus = await buildOldPrompt("generic", true)

			// Generate new prompts
			const claudeContext = makeMockContext("claude-sonnet-4")
			const newNextGenPrompt = await getSystemPrompt(claudeContext)
			const newGenericPrompt = await getSystemPrompt(baseContext)

			// Extract section titles from old prompts
			const oldNextGenTitles = extractSectionTitles(oldNextGenWithFocus)
			const oldGenericTitles = extractSectionTitles(oldGenericWithFocus)

			// Extract section titles from new prompts
			const newNextGenTitles = extractSectionTitles(newNextGenPrompt)
			const newGenericTitles = extractSectionTitles(newGenericPrompt)

			// Normalize and compare sets of titles
			const normalize = (t: string) => t.trim().toLowerCase()
			const unique = (arr: string[]) => Array.from(new Set(arr.map(normalize)))

			const oldCombined = unique([...oldNextGenTitles, ...oldGenericTitles])
			const newCombined = unique([...newNextGenTitles, ...newGenericTitles])

			// Quick sanity checks
			expect(newCombined.length).to.be.greaterThan(5)
			expect(oldCombined.length).to.be.greaterThan(5)

			// Compute diffs
			const oldOnly = oldCombined.filter((t) => !newCombined.includes(t))
			const newOnly = newCombined.filter((t) => !oldCombined.includes(t))

			// If counts differ or there are diffs, fail with detailed message
			if (oldCombined.length !== newCombined.length || oldOnly.length || newOnly.length) {
				const diffReport = {
					oldCount: oldCombined.length,
					newCount: newCombined.length,
					missingInNew: oldOnly,
					extraInNew: newOnly,
					oldNextGenTitles,
					oldGenericTitles,
					newNextGenTitles,
					newGenericTitles,
				}
				throw new Error(
					`Section title mismatch between legacy and new prompts.\n` +
						`Old count=${diffReport.oldCount}, New count=${diffReport.newCount}.\n` +
						`Missing in new: ${JSON.stringify(diffReport.missingInNew, null, 2)}\n` +
						`Extra in new: ${JSON.stringify(diffReport.extraInNew, null, 2)}\n`,
				)
			}

			// Check for key sections that should be present in both old and new
			const keySections = ["TOOL USE", "Tools", "execute_command", "read_file", "write_to_file"]

			for (const section of keySections) {
				// Check if section exists in old prompts (case insensitive)
				const oldNextGenHasSection = oldNextGenTitles.some((title) => title.toLowerCase().includes(section.toLowerCase()))
				const oldGenericHasSection = oldGenericTitles.some((title) => title.toLowerCase().includes(section.toLowerCase()))

				// Check if section exists in new prompts (case insensitive)
				const newNextGenHasSection = newNextGenTitles.some((title) => title.toLowerCase().includes(section.toLowerCase()))
				const newGenericHasSection = newGenericTitles.some((title) => title.toLowerCase().includes(section.toLowerCase()))

				// Assert that key sections are present in both old and new prompts
				expect(oldNextGenHasSection || oldGenericHasSection).to.be.true
				expect(newNextGenHasSection || newGenericHasSection).to.be.true
			}

			// Snapshot testing for section title comparison
			const snapshotsDir = path.join(__dirname, "__snapshots__")
			const comparisonPath = path.join(snapshotsDir, "section-title-comparison.json")

			const comparison = {
				oldNextGenTitles,
				newNextGenTitles,
				oldGenericTitles,
				newGenericTitles,
				keySections,
				summary: {
					oldNextGenCount: oldNextGenTitles.length,
					newNextGenCount: newNextGenTitles.length,
					oldGenericCount: oldGenericTitles.length,
					newGenericCount: newGenericTitles.length,
				},
			}

			// Use tabs for indentation to match existing snapshot format
			const comparisonContent = JSON.stringify(comparison, null, "\t").trim()

			if (UPDATE_SNAPSHOTS) {
				// Update mode: write new comparison snapshot
				await fs.writeFile(comparisonPath, comparisonContent, "utf-8")
				console.log(`Updated section title comparison snapshot`)
			} else {
				// Test mode: compare with existing snapshot
				try {
					const existingComparison = await fs.readFile(comparisonPath, "utf-8")
					const differences = compareStrings(existingComparison, comparisonContent)

					if (differences) {
						throw new Error(formatSnapshotError("section-title-comparison.json", differences))
					}

					console.log(`✓ Section title comparison matches`)
				} catch (error) {
					if (error instanceof Error && (error as any).code === "ENOENT") {
						// Snapshot doesn't exist
						throw new Error(
							formatSnapshotError(
								"section-title-comparison.json",
								`Section title comparison snapshot file does not exist: ${comparisonPath}\n` +
									`This is a new test case. Run with --update-snapshots to create the initial snapshot.`,
							),
						)
					} else {
						// Re-throw comparison errors
						throw error
					}
				}
			}
		})
	})
})
