import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { SystemPromptContext } from "../types"
import { mockProviderInfo } from "./integration.test"

describe("TemplateEngine", () => {
	let templateEngine: TemplateEngine

	beforeEach(() => {
		templateEngine = new TemplateEngine()
	})

	describe("resolve", () => {
		const mockContext: SystemPromptContext = {
			cwd: "/test/project",
			ide: "TestIde",
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
			yoloModeToggled: false,
		}

		it("should resolve simple placeholders", () => {
			const template = "Hello {{name}}!"
			const placeholders = { name: "World" }
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal("Hello World!")
		})

		it("should resolve multiple placeholders", () => {
			const template = "{{greeting}} {{name}}, today is {{day}}"
			const placeholders = {
				greeting: "Hello",
				name: "Alice",
				day: "Monday",
			}
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal("Hello Alice, today is Monday")
		})

		it("should handle nested object placeholders", () => {
			const template = "User: {{user.name}}, Age: {{user.age}}"
			const placeholders = {
				user: {
					name: "John",
					age: 30,
				},
			}
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal("User: John, Age: 30")
		})

		it("should preserve unmatched placeholders", () => {
			const template = "Hello {{name}}, your {{missing}} is pending"
			const placeholders = { name: "Alice" }
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal("Hello Alice, your {{missing}} is pending")
		})

		it("should handle object and array values", () => {
			const template = "Config: {{config}}"
			const placeholders = {
				config: { key: "value", items: [1, 2, 3] },
			}
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal('Config: {"key":"value","items":[1,2,3]}')
		})

		it("should handle whitespace around placeholder names", () => {
			const template = "Hello {{ name }}, welcome to {{  place  }}"
			const placeholders = { name: "Bob", place: "Paradise" }
			const result = templateEngine.resolve(template, mockContext, placeholders)
			expect(result).to.equal("Hello Bob, welcome to Paradise")
		})
	})

	describe("extractPlaceholders", () => {
		it("should extract all unique placeholders", () => {
			const template = "Hello {{name}}, {{greeting}} {{name}}!"
			const placeholders = templateEngine.extractPlaceholders(template)
			expect(placeholders).to.deep.equal(["name", "greeting"])
		})

		it("should handle nested placeholders", () => {
			const template = "User {{user.name}} lives in {{user.location.city}}"
			const placeholders = templateEngine.extractPlaceholders(template)
			expect(placeholders).to.deep.equal(["user.name", "user.location.city"])
		})

		it("should handle whitespace in placeholders", () => {
			const template = "Hello {{  name  }} and {{greeting}}"
			const placeholders = templateEngine.extractPlaceholders(template)
			expect(placeholders).to.deep.equal(["name", "greeting"])
		})

		it("should return empty array for template without placeholders", () => {
			const template = "Hello World!"
			const placeholders = templateEngine.extractPlaceholders(template)
			expect(placeholders).to.deep.equal([])
		})
	})

	describe("validate", () => {
		it("should return missing placeholders", () => {
			const template = "Hello {{name}}, your order is ready"
			const required = ["name", "missing"]
			const missing = templateEngine.validate(template, required)
			expect(missing).to.deep.equal(["missing"])
		})

		it("should return empty array when all required placeholders are present", () => {
			const template = "Hello {{name}}, your {{item}} is ready"
			const required = ["name", "item"]
			const missing = templateEngine.validate(template, required)
			expect(missing).to.deep.equal([])
		})
	})

	describe("escape and unescape", () => {
		it("should escape placeholder markers", () => {
			const template = "Hello {{name}}!"
			const escaped = templateEngine.escape(template)
			expect(escaped).to.equal("Hello \\{\\{name\\}\\}!")
		})

		it("should unescape placeholder markers", () => {
			const escaped = "Hello \\{\\{name\\}\\}!"
			const unescaped = templateEngine.unescape(escaped)
			expect(unescaped).to.equal("Hello {{name}}!")
		})

		it("should handle round-trip escaping/unescaping", () => {
			const template = "Hello {{name}}! Welcome to {{place}}."
			const escaped = templateEngine.escape(template)
			const unescaped = templateEngine.unescape(escaped)
			expect(unescaped).to.equal(template)
		})
	})
})
