import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { ModelFamily } from "@/shared/prompts"
import { PromptBuilder } from "../registry/PromptBuilder"
import { SystemPromptSection } from "../templates/placeholders"
import type { ComponentRegistry, PromptVariant, SystemPromptContext } from "../types"
import { createVariant } from "../variants/variant-builder"
import { mockProviderInfo } from "./integration.test"

describe("PromptBuilder", () => {
	const mockContext: SystemPromptContext = {
		cwd: "/test/project",
		supportsBrowserUse: true,
		mcpHub: {
			getServers: () => [],
			getMcpServersPath: () => "/test/mcp-servers",
			getSettingsDirectoryPath: () => "/test/settings",
			clientVersion: "1.0.0",
			disposables: [],
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
		isTesting: true,
		providerInfo: mockProviderInfo,
	}

	const mockComponents: ComponentRegistry = {
		SYSTEM_INFO_SECTION: async () => "SYSTEM INFORMATION\n\nOS: macOS\nShell: zsh",
		TOOL_USE_SECTION: async () => "TOOL USE\n\n- {{TOOLS}}",
		CAPABILITIES_SECTION: async () => "CAPABILITIES\n\n- Code execution\n- File operations",
		RULES_SECTION: async () => "RULES\n\n- Follow best practices\n- Be concise",
	}

	const baseVariant: PromptVariant = {
		id: "test-model",
		family: ModelFamily.GENERIC,
		version: 1,
		description: "A test model",
		tags: ["test"],
		labels: { test: 1 },
		config: {
			modelName: "test-model",
			temperature: 0.7,
		},
		baseTemplate:
			"You are Cline.\n\n{{TOOL_USE_SECTION}}\n\n{{CAPABILITIES_SECTION}}\n\n{{RULES_SECTION}}\n\n{{SYSTEM_INFO_SECTION}}",
		componentOrder: [
			SystemPromptSection.TOOL_USE,
			SystemPromptSection.CAPABILITIES,
			SystemPromptSection.RULES,
			SystemPromptSection.SYSTEM_INFO,
		],
		componentOverrides: {},
		placeholders: {
			MODEL_FAMILY: "test",
		},
	}

	describe("build", () => {
		it("should build a complete prompt", async () => {
			const builder = new PromptBuilder(baseVariant, mockContext, mockComponents)
			const result = await builder.build()

			expect(result).to.include("You are Cline.")
			expect(result).to.include("TOOL USE")
			expect(result).to.include("CAPABILITIES")
			expect(result).to.include("RULES")
			expect(result).to.include("SYSTEM INFORMATION")
			expect(result).to.include("OS: macOS")
		})

		it("should handle missing components gracefully", async () => {
			const incompleteComponents: ComponentRegistry = {
				TOOL_USE_SECTION: async () => "TOOL USE REPLACER",
				SYSTEM_INFO_SECTION: async () => "SYSTEM INFO",
			}

			// Mock console.warn to capture and verify warnings
			const originalWarn = console.warn
			const warnSpy = {
				calls: [] as any[],
				warn: (...args: any[]) => {
					warnSpy.calls.push(args)
				},
			}
			console.warn = warnSpy.warn

			try {
				const builder = new PromptBuilder(baseVariant, mockContext, incompleteComponents)
				const result = await builder.build()

				expect(result).to.include("You are Cline.")
				expect(result).to.include("TOOL USE REPLACER")
				expect(result).to.include("SYSTEM INFO")
				// Missing components should not break the build

				// Verify that warnings were logged for missing components
				expect(warnSpy.calls).to.have.length(2)
				expect(warnSpy.calls[0][0]).to.include("Warning: Component 'CAPABILITIES_SECTION' not found")
				expect(warnSpy.calls[1][0]).to.include("Warning: Component 'RULES_SECTION' not found")
			} finally {
				// Restore original console.warn
				console.warn = originalWarn
			}
		})

		it("should apply component overrides", async () => {
			const variantWithOverrides: PromptVariant = {
				...baseVariant,
				componentOverrides: {
					SYSTEM_INFO_SECTION: {
						template: "CUSTOM SYSTEM INFO: {{os}} on {{shell}}",
					},
				},
			}

			const customComponents: ComponentRegistry = {
				...mockComponents,
				SYSTEM_INFO_SECTION: async (variant) => {
					const template = variant.componentOverrides?.SYSTEM_INFO_SECTION?.template || "DEFAULT"
					return template.replace("{{os}}", "Linux").replace("{{shell}}", "bash")
				},
			}

			const builder = new PromptBuilder(variantWithOverrides, mockContext, customComponents)
			const result = await builder.build()

			expect(result).to.include("CUSTOM SYSTEM INFO: Linux on bash")
		})

		it("should resolve runtime placeholders", async () => {
			const contextWithRuntime = {
				...mockContext,
				runtimePlaceholders: {
					USER_NAME: "TestUser",
					PROJECT_TYPE: "React",
				},
			}

			const templateWithRuntime: PromptVariant = {
				...baseVariant,
				baseTemplate: "Hello {{USER_NAME}}! Working on {{PROJECT_TYPE}} project.\n\n{{TOOLS}}",
			}

			const builder = new PromptBuilder(templateWithRuntime, contextWithRuntime as SystemPromptContext, mockComponents)
			const result = await builder.build()

			expect(result).to.include("Hello TestUser!")
			expect(result).to.include("Working on React project.")
		})

		it("should handle component errors gracefully", async () => {
			// Mock console.warn to suppress warning output and verify it's called
			const originalWarn = console.warn
			const warnSpy = {
				calls: [] as any[],
				warn: (...args: any[]) => {
					warnSpy.calls.push(args)
				},
			}
			console.warn = warnSpy.warn

			try {
				const failingComponents: ComponentRegistry = {
					TOOL_USE_SECTION: async () => "TOOL USE CONTENT",
					SYSTEM_INFO_SECTION: async () => {
						throw new Error("Component failed")
					},
					CAPABILITIES_SECTION: async () => "CAPABILITIES WORK",
					RULES_SECTION: async () => "RULES WORK",
				}

				const builder = new PromptBuilder(baseVariant, mockContext, failingComponents)
				const result = await builder.build()

				// Should still build successfully despite failing component
				expect(result).to.include("You are Cline.")
				expect(result).to.include("CAPABILITIES WORK")
				expect(result).to.include("TOOL USE CONTENT")

				// Verify that the warning was logged for the failing component
				expect(warnSpy.calls).to.have.length(1)
				expect(warnSpy.calls[0][0]).to.include("Failed to build component 'SYSTEM_INFO_SECTION'")
			} finally {
				// Restore original console.warn
				console.warn = originalWarn
			}
		})
	})

	describe("getBuildMetadata", () => {
		it("should return build metadata", () => {
			const builder = new PromptBuilder(baseVariant, mockContext, mockComponents)
			const metadata = builder.getBuildMetadata()

			expect(metadata.variantId).to.equal("test-model")
			expect(metadata.version).to.equal(1)
			expect(metadata.componentsUsed).to.deep.equal([
				"TOOL_USE_SECTION",
				"CAPABILITIES_SECTION",
				"RULES_SECTION",
				"SYSTEM_INFO_SECTION",
			])
			expect(metadata.placeholdersResolved).to.include("TOOL_USE_SECTION")
			expect(metadata.placeholdersResolved).to.include("CAPABILITIES_SECTION")
		})
	})

	describe("postProcess", () => {
		it("should clean up multiple empty lines", async () => {
			const templateWithExtraLines: PromptVariant = {
				...baseVariant,
				baseTemplate: "Line 1\n\n\n\nLine 2\n\n\n{{TOOLS}}",
			}

			const builder = new PromptBuilder(templateWithExtraLines, mockContext, mockComponents)
			const result = await builder.build()

			// Should not have more than 2 consecutive newlines
			expect(result).to.not.match(/\n\s*\n\s*\n/)
		})

		it("should ensure proper section separation", async () => {
			const templateWithSections: PromptVariant = {
				...baseVariant,
				baseTemplate: "Section 1\n====\nSection 2\n====\n{{TOOLS}}",
			}

			const builder = new PromptBuilder(templateWithSections, mockContext, mockComponents)
			const result = await builder.build()

			expect(result).to.include("====\n\nSection 2")
		})
	})

	describe("VariantBuilder auto-generation", () => {
		it("should auto-generate baseTemplate from componentOrder when not provided", () => {
			const config = createVariant(ModelFamily.GENERIC)
				.description("Test variant without explicit template")
				.version(1)
				.components(
					SystemPromptSection.AGENT_ROLE,
					SystemPromptSection.TOOL_USE,
					SystemPromptSection.CAPABILITIES,
					SystemPromptSection.RULES,
				)
				.build()

			// Should have auto-generated a baseTemplate
			expect(config.baseTemplate).to.exist
			expect(config.baseTemplate).to.include("{{AGENT_ROLE_SECTION}}")
			expect(config.baseTemplate).to.include("{{TOOL_USE_SECTION}}")
			expect(config.baseTemplate).to.include("{{CAPABILITIES_SECTION}}")
			expect(config.baseTemplate).to.include("{{RULES_SECTION}}")

			// Should have separators between components
			expect(config.baseTemplate).to.include("====")

			// Should match the expected format
			const expectedTemplate = `{{${SystemPromptSection.AGENT_ROLE}}}

====

{{${SystemPromptSection.TOOL_USE}}}

====

{{${SystemPromptSection.CAPABILITIES}}}

====

{{${SystemPromptSection.RULES}}}`
			expect(config.baseTemplate).to.equal(expectedTemplate)
		})

		it("should use explicit baseTemplate when provided", () => {
			const customTemplate = "Custom template with {{AGENT_ROLE_SECTION}}"

			const config = createVariant(ModelFamily.GENERIC)
				.description("Test variant with explicit template")
				.version(1)
				.template(customTemplate)
				.components(SystemPromptSection.AGENT_ROLE, SystemPromptSection.TOOL_USE)
				.build()

			// Should use the explicitly provided template
			expect(config.baseTemplate).to.equal(customTemplate)
		})

		it("should throw error when componentOrder is empty", () => {
			expect(() => {
				createVariant(ModelFamily.GENERIC)
					.description("Test variant with empty components")
					.version(1)
					.components() // Empty components
					.build()
			}).to.throw("Component order is required")
		})
	})
})
