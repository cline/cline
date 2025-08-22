import * as fs from "node:fs/promises"
import * as path from "node:path"
import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { ModelFamily } from "@/shared/prompts"
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
	}

	const contextVariations = [
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
	]

	// Table-driven test cases for different model families
	const modelTestCases = [
		{
			modelGroup: ModelFamily.GENERIC,
			modelIds: ["gpt-3"],
			contextVariations,
		},
		{
			modelGroup: ModelFamily.NEXT_GEN,
			modelIds: ["claude-sonnet-4"],
			contextVariations,
		},
		{
			modelGroup: ModelFamily.XS,
			modelIds: ["qwen3-coder"],
			contextVariations,
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
								expect(prompt).to.not.include("{{TOOL_USE_SECTION}}") // Tools placeholder should be removed

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
				expect(prompt).to.include("{{TOOL_USE_SECTION}}")
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

			// Save snapshots of old prompts
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
				await fs.writeFile(snapshotPath, snapshot.content, "utf-8")
				console.log(`Generated old prompt snapshot: ${snapshot.name} (${snapshot.content.length} chars)`)
			}
		})

		it("should compare old and new prompts for section title compatibility", async function () {
			this.timeout(30000)

			// Generate old prompts
			const oldNextGenWithFocus = await buildOldPrompt("next-gen", true)
			const oldGenericWithFocus = await buildOldPrompt("generic", true)

			// Generate new prompts
			const newNextGenPrompt = await getPrompt("claude-sonnet-4", baseContext)
			const newGenericPrompt = await getPrompt("generic", baseContext)

			// Extract section titles from old prompts
			const oldNextGenTitles = extractSectionTitles(oldNextGenWithFocus)
			const oldGenericTitles = extractSectionTitles(oldGenericWithFocus)

			// Extract section titles from new prompts
			const newNextGenTitles = extractSectionTitles(newNextGenPrompt)
			const newGenericTitles = extractSectionTitles(newGenericPrompt)

			console.log("Old Next-Gen section titles:", oldNextGenTitles)
			console.log("New Next-Gen section titles:", newNextGenTitles)
			console.log("Old Generic section titles:", oldGenericTitles)
			console.log("New Generic section titles:", newGenericTitles)

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

			// Save comparison results
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

			await fs.writeFile(comparisonPath, JSON.stringify(comparison, null, 2), "utf-8")
			// console.log(`Saved section title comparison to: ${comparisonPath}`)
		})
	})
})
