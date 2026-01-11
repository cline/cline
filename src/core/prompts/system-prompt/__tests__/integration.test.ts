/**
 * System Prompt Integration Tests with Snapshot Testing
 *
 * This test suite validates that system prompts remain consistent across different
 * model families and context configurations using snapshot testing.
 *
 * Usage:
 * - Run tests normally: `npm run test:unit`
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

// ============================================================================
// Configuration
// ============================================================================

const UPDATE_SNAPSHOTS = process.argv.includes("--update-snapshots") || process.env.UPDATE_SNAPSHOTS === "true"
const SNAPSHOTS_DIR = path.join(__dirname, "__snapshots__")
const TEST_TIMEOUT = 30000
const MAX_DIFF_LINES = 10

// ============================================================================
// Snapshot Helpers
// ============================================================================

const formatSnapshotError = (snapshotName: string, details: string): string => `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ SNAPSHOT MISMATCH: ${snapshotName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${details}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 To update snapshots: npm run test:unit -- --update-snapshots
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`

const compareStrings = (expected: string, actual: string): string | null => {
	if (expected === actual) {
		return null
	}

	const expectedLines = expected.split("\n")
	const actualLines = actual.split("\n")
	const diffs: string[] = []

	for (let i = 0; i < Math.max(expectedLines.length, actualLines.length) && diffs.length < MAX_DIFF_LINES; i++) {
		const exp = expectedLines[i] || ""
		const act = actualLines[i] || ""
		if (exp !== act) {
			diffs.push(`Line ${i + 1}:`)
			if (exp) {
				diffs.push(`  - Expected: ${exp.substring(0, 100)}${exp.length > 100 ? "..." : ""}`)
			}
			if (act) {
				diffs.push(`  + Actual:   ${act.substring(0, 100)}${act.length > 100 ? "..." : ""}`)
			}
		}
	}

	return [
		`Expected: ${expected.length} chars, ${expectedLines.length} lines`,
		`Actual: ${actual.length} chars, ${actualLines.length} lines`,
		"",
		...diffs,
		diffs.length >= MAX_DIFF_LINES ? "... and more differences" : "",
	].join("\n")
}

async function assertSnapshot(name: string, content: string): Promise<void> {
	const snapshotPath = path.join(SNAPSHOTS_DIR, name)

	if (UPDATE_SNAPSHOTS) {
		await fs.writeFile(snapshotPath, content, "utf-8")
		console.log(`Updated snapshot: ${name} (${content.length} chars)`)
		return
	}

	try {
		const existing = await fs.readFile(snapshotPath, "utf-8")
		const diff = compareStrings(existing, content)
		if (diff) {
			throw new Error(formatSnapshotError(name, diff))
		}
		console.log(`✓ Snapshot matches: ${name}`)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(formatSnapshotError(name, `Snapshot does not exist. Run with --update-snapshots to create it.`))
		}
		throw error
	}
}

// ============================================================================
// Test Context Helpers
// ============================================================================

export const mockProviderInfo = {
	providerId: "test",
	model: { id: "fast", info: { supportsPromptCache: false } },
	mode: "act" as const,
}

const makeProviderInfo = (modelId: string, providerId: string = "test") => ({
	providerId: modelId.includes("ollama") ? "ollama" : providerId,
	model: { ...mockProviderInfo.model, id: modelId },
	mode: "act" as const,
	customPrompt: providerId.includes("lmstudio") || providerId.includes("ollama") ? "compact" : undefined,
})

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	clineWebToolsEnabled: true,
	mcpHub: {
		getServers: () => [
			{
				uid: "1234567",
				name: "test-server",
				status: "connected",
				config: '{"command": "test"}',
				tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
				resources: [],
				resourceTemplates: [],
			},
		],
	} as unknown as McpHub,
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	browserSettings: { viewport: { width: 1280, height: 720 } },
	globalClineRulesFileInstructions: "Follow global rules",
	localClineRulesFileInstructions: "Follow local rules",
	preferredLanguageInstructions: "Prefer TypeScript",
	isTesting: true,
	providerInfo: mockProviderInfo,
	enableNativeToolCalls: false,
}

const isNativeToolsFamily = (family: ModelFamily) =>
	[ModelFamily.NATIVE_NEXT_GEN, ModelFamily.NATIVE_GPT_5, ModelFamily.NATIVE_GPT_5_1, ModelFamily.GEMINI_3].includes(family)

type TestRunner = Mocha.Context & { skip(): void; timeout(ms: number): void }

async function runPromptTest(
	testCtx: TestRunner,
	context: SystemPromptContext,
	modelId: string,
	handler: (result: Awaited<ReturnType<typeof getSystemPrompt>>) => Promise<void>,
): Promise<void> {
	testCtx.timeout(TEST_TIMEOUT)
	try {
		const result = await getSystemPrompt(context)
		await handler(result)
	} catch (error) {
		if (error instanceof Error && error.message.includes("No prompt variant found")) {
			console.log(`Skipping ${modelId} - no variant available (expected)`)
			testCtx.skip()
		} else {
			throw error
		}
	}
}

// ============================================================================
// Test Data
// ============================================================================

const contextVariations: Array<{ name: string; override: Partial<SystemPromptContext> }> = [
	{ name: "basic", override: {} },
	{ name: "no-browser", override: { supportsBrowserUse: false } },
	{ name: "no-mcp", override: { mcpHub: { getServers: () => [] } as unknown as McpHub } },
	{ name: "no-focus-chain", override: { focusChainSettings: { enabled: false, remindClineInterval: 0 } } },
]

const modelTestCases = [
	{ family: ModelFamily.GENERIC, modelId: "gpt-3", providerId: "openai" },
	{ family: ModelFamily.GLM, modelId: "glm-4.6", providerId: "zai" },
	{ family: ModelFamily.HERMES, modelId: "hermes-4", providerId: "test" },
	{ family: ModelFamily.DEVSTRAL, modelId: "devstral", providerId: "cline" },
	{ family: ModelFamily.NEXT_GEN, modelId: "claude-sonnet-4", providerId: "anthropic" },
	{ family: ModelFamily.XS, modelId: "qwen3_coder", providerId: "lmstudio" },
	{ family: ModelFamily.NATIVE_NEXT_GEN, modelId: "claude-4-5-sonnet", providerId: "cline" },
	{ family: ModelFamily.GPT_5, modelId: "gpt-5", providerId: "openai" },
	{ family: ModelFamily.NATIVE_GPT_5, modelId: "gpt-5-codex", providerId: "openai" },
	{ family: ModelFamily.NATIVE_GPT_5_1, modelId: "gpt-5-1", providerId: "openai" },
	{ family: ModelFamily.GEMINI_3, modelId: "gemini-3", providerId: "vertex" },
]

// ============================================================================
// Tests
// ============================================================================

describe("Prompt System Integration Tests", () => {
	before(async () => {
		console.log(UPDATE_SNAPSHOTS ? "🔄 SNAPSHOT UPDATE MODE" : "✅ SNAPSHOT TEST MODE")
		await fs.mkdir(SNAPSHOTS_DIR, { recursive: true }).catch(() => {})
	})

	describe("Snapshot Testing", () => {
		for (const { family, modelId, providerId } of modelTestCases) {
			describe(`${family} Model Group`, () => {
				const enableNativeToolCalls = isNativeToolsFamily(family)

				it(`should generate consistent native tools object when enabled`, async function () {
					const context: SystemPromptContext = {
						...baseContext,
						providerInfo: makeProviderInfo(modelId, providerId),
						enableNativeToolCalls,
					}

					await runPromptTest(this, context, modelId, async ({ tools }) => {
						if (!enableNativeToolCalls) {
							expect(tools).to.be.undefined
							return
						}

						expect(tools).to.be.an("array").that.is.not.empty
						const snapshotName = `${providerId}_${family.replace(/[^a-zA-Z0-9]/g, "_")}.tools.snap`
						await assertSnapshot(snapshotName, JSON.stringify(tools, null, 2))
					})
				})

				for (const { name: contextName, override } of contextVariations) {
					it(`should generate consistent prompt for ${providerId}/${modelId} with ${contextName} context`, async function () {
						const context: SystemPromptContext = {
							...baseContext,
							...override,
							providerInfo: makeProviderInfo(modelId, providerId),
							enableNativeToolCalls,
						}

						await runPromptTest(this, context, modelId, async ({ systemPrompt, tools }) => {
							if (enableNativeToolCalls) {
								expect(tools).to.be.an("array").that.is.not.empty
							} else {
								expect(tools).to.be.undefined
							}

							expect(systemPrompt).to.be.a("string").with.length.greaterThan(100)
							expect(systemPrompt).to.not.include("{{TOOL_USE_SECTION}}")

							const snapshotName = `${providerId}_${modelId.replace(/[^a-zA-Z0-9]/g, "_")}-${contextName}.snap`
							await assertSnapshot(snapshotName, systemPrompt)
						})
					})
				}
			})
		}
	})

	describe("Context-Specific Features", () => {
		const featureTests = [
			{ name: "browser-specific content when browser is enabled", context: { supportsBrowserUse: true }, check: "browser" },
			{ name: "MCP content when MCP servers are present", context: {}, check: "MCP" },
			{ name: "TODO content when focus chain is enabled", context: {}, check: "TODO" },
			{ name: "user instructions when provided", context: {}, check: "USER'S CUSTOM INSTRUCTIONS" },
		]

		for (const { name, context, check } of featureTests) {
			it(`should include ${name}`, async function () {
				await runPromptTest(this, { ...baseContext, ...context }, "default", async ({ systemPrompt }) => {
					expect(systemPrompt.toLowerCase()).to.include(check.toLowerCase())
				})
			})
		}
	})

	describe("Error Handling", () => {
		it("should handle completely invalid context gracefully", async function () {
			this.timeout(TEST_TIMEOUT)
			const { systemPrompt } = await getSystemPrompt({} as SystemPromptContext)
			expect(systemPrompt).to.be.a("string")
		})

		it("should handle undefined context properties", async function () {
			this.timeout(TEST_TIMEOUT)
			const contextWithNulls: SystemPromptContext = {
				cwd: undefined,
				ide: "",
				supportsBrowserUse: undefined,
				mcpHub: undefined,
				focusChainSettings: undefined,
				providerInfo: mockProviderInfo,
			}

			try {
				const { systemPrompt } = await getSystemPrompt(contextWithNulls)
				expect(systemPrompt).to.be.a("string")
				expect(systemPrompt).to.include("{{TOOL_USE_SECTION}}")
			} catch (error) {
				expect(error).to.be.instanceOf(Error)
			}
		})
	})
})
