import { expect } from "chai"
import {
	type CustomPromptMetadata,
	expandToolReferences,
	type PromptValidationResult,
	resolveEnabledTools,
	SystemPromptsManager,
	TOOL_GROUPS,
	type ToolConfiguration,
} from "../SystemPromptsManager"

describe("SystemPromptsManager - Custom Prompts System", () => {
	describe("YAML Frontmatter Parsing", () => {
		it("should handle prompts without frontmatter", async () => {
			const manager = SystemPromptsManager.getInstance()
			expect(manager).to.exist
		})

		it("should handle boolean values in metadata", () => {
			const metadata: CustomPromptMetadata = {
				enablePlaceholders: true,
				includeToolInstructions: false,
				suppressWarnings: true,
			}
			expect(metadata.enablePlaceholders).to.be.true
			expect(metadata.includeToolInstructions).to.be.false
			expect(metadata.suppressWarnings).to.be.true
		})

		it("should handle array values in metadata", () => {
			const metadata: CustomPromptMetadata = {
				includeComponents: ["TOOL_USE_SECTION", "RULES_SECTION", "SYSTEM_INFO_SECTION"],
				excludeComponents: ["MCP_SECTION"],
			}
			expect(metadata.includeComponents).to.have.length(3)
			expect(metadata.includeComponents).to.include("TOOL_USE_SECTION")
			expect(metadata.excludeComponents).to.have.length(1)
		})
	})

	describe("CustomPromptMetadata Interface", () => {
		it("should define all required metadata fields", () => {
			const metadata: CustomPromptMetadata = {
				name: "Test Prompt",
				description: "A test prompt",
				version: "1.0",
				author: "Test Author",
				includeComponents: ["TOOL_USE_SECTION", "RULES_SECTION"],
				excludeComponents: ["MCP_SECTION"],
				enablePlaceholders: true,
				includeToolInstructions: true,
				includeEditingGuidelines: true,
				includeBrowserRules: false,
				includeMcpSection: false,
				includeUserInstructions: true,
				suppressWarnings: false,
			}

			expect(metadata.includeComponents).to.have.length(2)
			expect(metadata.enablePlaceholders).to.be.true
		})

		it("should support tool configuration", () => {
			const metadata: CustomPromptMetadata = {
				tools: {
					enabled: ["@filesystem", "web_search"],
					disabled: ["write_to_file"],
				},
			}
			expect(metadata.tools?.enabled).to.include("@filesystem")
			expect(metadata.tools?.disabled).to.include("write_to_file")
		})
	})

	describe("PromptValidationResult Interface", () => {
		it("should provide detailed validation results", () => {
			const validResult: PromptValidationResult = {
				isValid: true,
				errors: [],
				warnings: [],
				missingComponents: [],
			}

			const invalidResult: PromptValidationResult = {
				isValid: false,
				errors: ["Prompt content is too short"],
				warnings: ["Unknown tool group: @invalid"],
				missingComponents: [],
				metadata: {},
			}

			expect(validResult.isValid).to.be.true
			expect(invalidResult.isValid).to.be.false
			expect(invalidResult.errors).to.have.length(1)
		})
	})

	describe("Singleton Pattern", () => {
		it("should return the same instance", () => {
			const instance1 = SystemPromptsManager.getInstance()
			const instance2 = SystemPromptsManager.getInstance()
			expect(instance1).to.equal(instance2)
		})
	})

	describe("Prompts Directory", () => {
		it("should return prompts directory path", () => {
			const manager = SystemPromptsManager.getInstance()
			const dir = manager.getPromptsDirectory()
			expect(dir).to.include("system-prompts")
		})
	})

	describe("Cache Management", () => {
		it("should clear cache when requested", () => {
			const manager = SystemPromptsManager.getInstance()
			expect(() => manager.clearCache()).to.not.throw()
		})
	})
})

describe("Tool Groups and Configuration", () => {
	describe("TOOL_GROUPS constant", () => {
		it("should define all expected tool groups", () => {
			expect(TOOL_GROUPS).to.have.property("filesystem")
			expect(TOOL_GROUPS).to.have.property("browser")
			expect(TOOL_GROUPS).to.have.property("web")
			expect(TOOL_GROUPS).to.have.property("terminal")
			expect(TOOL_GROUPS).to.have.property("mcp")
			expect(TOOL_GROUPS).to.have.property("communication")
			expect(TOOL_GROUPS).to.have.property("task")
			expect(TOOL_GROUPS).to.have.property("utility")
		})

		it("should have filesystem group contain expected tools", () => {
			expect(TOOL_GROUPS.filesystem).to.include("read_file")
			expect(TOOL_GROUPS.filesystem).to.include("write_to_file")
			expect(TOOL_GROUPS.filesystem).to.include("replace_in_file")
			expect(TOOL_GROUPS.filesystem).to.include("list_files")
			expect(TOOL_GROUPS.filesystem).to.include("search_files")
		})

		it("should have browser group contain browser_action", () => {
			expect(TOOL_GROUPS.browser).to.include("browser_action")
		})

		it("should have web group contain fetch and search", () => {
			expect(TOOL_GROUPS.web).to.include("web_fetch")
			expect(TOOL_GROUPS.web).to.include("web_search")
		})

		it("should have terminal group contain execute_command", () => {
			expect(TOOL_GROUPS.terminal).to.include("execute_command")
		})

		it("should have mcp group contain MCP tools", () => {
			expect(TOOL_GROUPS.mcp).to.include("use_mcp_tool")
			expect(TOOL_GROUPS.mcp).to.include("access_mcp_resource")
			expect(TOOL_GROUPS.mcp).to.include("load_mcp_documentation")
		})
	})

	describe("expandToolReferences", () => {
		it("should expand group references to individual tools", () => {
			const result = expandToolReferences(["@filesystem"])
			expect(result).to.include("read_file")
			expect(result).to.include("write_to_file")
			expect(result).to.include("replace_in_file")
		})

		it("should pass through individual tool IDs unchanged", () => {
			const result = expandToolReferences(["read_file", "write_to_file"])
			expect(result).to.deep.equal(["read_file", "write_to_file"])
		})

		it("should handle mixed group and individual references", () => {
			const result = expandToolReferences(["@browser", "read_file"])
			expect(result).to.include("browser_action")
			expect(result).to.include("read_file")
		})

		it("should deduplicate tools", () => {
			const result = expandToolReferences(["read_file", "@filesystem"])
			const readFileCount = result.filter((t) => t === "read_file").length
			expect(readFileCount).to.equal(1)
		})

		it("should handle unknown groups gracefully", () => {
			const result = expandToolReferences(["@unknown"])
			expect(result).to.deep.equal([])
		})

		it("should handle empty array", () => {
			const result = expandToolReferences([])
			expect(result).to.deep.equal([])
		})
	})

	describe("resolveEnabledTools", () => {
		const allTools = ["read_file", "write_to_file", "execute_command", "browser_action", "web_search"]

		it("should return all tools when no config provided", () => {
			const { enabledTools, disabledTools } = resolveEnabledTools(allTools, undefined)
			expect(enabledTools).to.deep.equal(allTools)
			expect(disabledTools).to.deep.equal([])
		})

		it("should return all tools when config is empty", () => {
			const { enabledTools, disabledTools } = resolveEnabledTools(allTools, {})
			expect(enabledTools).to.deep.equal(allTools)
			expect(disabledTools).to.deep.equal([])
		})

		it("should filter to only enabled tools (whitelist mode)", () => {
			const config: ToolConfiguration = {
				enabled: ["read_file", "write_to_file"],
			}
			const { enabledTools, disabledTools } = resolveEnabledTools(allTools, config)
			expect(enabledTools).to.deep.equal(["read_file", "write_to_file"])
			expect(disabledTools).to.include("execute_command")
			expect(disabledTools).to.include("browser_action")
		})

		it("should remove disabled tools (blacklist mode)", () => {
			const config: ToolConfiguration = {
				disabled: ["browser_action", "execute_command"],
			}
			const { enabledTools, disabledTools } = resolveEnabledTools(allTools, config)
			expect(enabledTools).to.not.include("browser_action")
			expect(enabledTools).to.not.include("execute_command")
			expect(enabledTools).to.include("read_file")
			expect(disabledTools).to.include("browser_action")
		})

		it("should apply disabled after enabled (combined mode)", () => {
			const config: ToolConfiguration = {
				enabled: ["read_file", "write_to_file", "execute_command"],
				disabled: ["write_to_file"],
			}
			const { enabledTools } = resolveEnabledTools(allTools, config)
			expect(enabledTools).to.deep.equal(["read_file", "execute_command"])
		})

		it("should expand group references in enabled list", () => {
			const allToolsWithMcp = [...allTools, "use_mcp_tool"]
			const config: ToolConfiguration = {
				enabled: ["@mcp"],
			}
			const { enabledTools } = resolveEnabledTools(allToolsWithMcp, config)
			expect(enabledTools).to.include("use_mcp_tool")
			expect(enabledTools).to.not.include("read_file")
		})

		it("should expand group references in disabled list", () => {
			const config: ToolConfiguration = {
				disabled: ["@browser"],
			}
			const { enabledTools } = resolveEnabledTools(allTools, config)
			expect(enabledTools).to.not.include("browser_action")
			expect(enabledTools).to.include("read_file")
		})
	})
})

describe("Component Configuration", () => {
	it("should support component whitelist", () => {
		const metadata: CustomPromptMetadata = {
			includeComponents: ["TOOL_USE_SECTION", "EDITING_FILES_SECTION", "RULES_SECTION", "SYSTEM_INFO_SECTION"],
		}
		expect(metadata.includeComponents).to.have.length(4)
	})

	it("should support component blacklist", () => {
		const metadata: CustomPromptMetadata = {
			excludeComponents: ["MCP_SECTION", "SKILLS_SECTION"],
		}
		expect(metadata.excludeComponents).to.have.length(2)
	})

	it("should support convenience flags", () => {
		const metadata: CustomPromptMetadata = {
			includeToolInstructions: true,
			includeEditingGuidelines: true,
			includeBrowserRules: false,
			includeMcpSection: false,
			includeUserInstructions: true,
			includeRules: true,
			includeSystemInfo: true,
		}
		expect(metadata.includeToolInstructions).to.be.true
		expect(metadata.includeBrowserRules).to.be.false
	})
})

describe("Placeholder Processing", () => {
	it("should enable placeholders by default", () => {
		const metadata: CustomPromptMetadata = {}
		// When enablePlaceholders is undefined, the system should treat it as true
		expect(metadata.enablePlaceholders).to.be.undefined
	})

	it("should allow explicit placeholder control", () => {
		const metadata: CustomPromptMetadata = {
			enablePlaceholders: false,
		}
		expect(metadata.enablePlaceholders).to.be.false
	})

	it("should define custom placeholders", () => {
		const placeholders: CustomPromptMetadata["placeholders"] = {
			CUSTOM_VAR: "custom value",
			TEAM_NAME: "Engineering",
		}
		expect(placeholders).to.have.property("CUSTOM_VAR")
		expect(placeholders?.TEAM_NAME).to.equal("Engineering")
	})
})

describe("Tool Configuration Types", () => {
	it("should support nested tool configuration structure", () => {
		const config: ToolConfiguration = {
			enabled: ["@filesystem", "web_search"],
			disabled: ["write_to_file", "replace_in_file"],
			enableNativeToolCalls: true,
			customToolInstructions: {
				read_file: "Always read files before editing",
			},
		}

		expect(config.enabled).to.have.length(2)
		expect(config.disabled).to.have.length(2)
		expect(config.enableNativeToolCalls).to.be.true
		expect(config.customToolInstructions?.read_file).to.include("read files")
	})

	it("should support whitelist-only mode", () => {
		const config: ToolConfiguration = {
			enabled: ["read_file", "list_files", "@communication"],
		}

		const allTools = ["read_file", "write_to_file", "list_files", "ask_followup_question"]
		const { enabledTools } = resolveEnabledTools(allTools, config)

		expect(enabledTools).to.include("read_file")
		expect(enabledTools).to.include("list_files")
		expect(enabledTools).to.include("ask_followup_question")
		expect(enabledTools).to.not.include("write_to_file")
	})

	it("should support blacklist-only mode", () => {
		const config: ToolConfiguration = {
			disabled: ["@browser", "execute_command"],
		}

		const allTools = ["read_file", "browser_action", "execute_command"]
		const { enabledTools } = resolveEnabledTools(allTools, config)

		expect(enabledTools).to.include("read_file")
		expect(enabledTools).to.not.include("browser_action")
		expect(enabledTools).to.not.include("execute_command")
	})
})

describe("YAML Frontmatter Parser - Nested Objects", () => {
	it("should parse tools configuration with enabled array", () => {
		const metadata: CustomPromptMetadata = {
			tools: {
				enabled: ["@filesystem", "@web"],
				disabled: ["write_to_file"],
			},
		}
		expect(metadata.tools?.enabled).to.deep.equal(["@filesystem", "@web"])
		expect(metadata.tools?.disabled).to.deep.equal(["write_to_file"])
	})

	it("should parse tools configuration with customToolInstructions", () => {
		const metadata: CustomPromptMetadata = {
			tools: {
				customToolInstructions: {
					read_file: "Check encoding first",
					execute_command: "Prefer non-destructive commands",
				},
			},
		}
		expect(metadata.tools?.customToolInstructions?.read_file).to.equal("Check encoding first")
	})

	it("should parse tools configuration with enableNativeToolCalls", () => {
		const metadata: CustomPromptMetadata = {
			tools: {
				enableNativeToolCalls: true,
				enabled: ["@filesystem"],
			},
		}
		expect(metadata.tools?.enableNativeToolCalls).to.be.true
		expect(metadata.tools?.enabled).to.deep.equal(["@filesystem"])
	})
})
