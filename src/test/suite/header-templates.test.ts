import * as assert from "assert"
import { OPENAI_HEADER_TEMPLATES, processHeaderTemplate } from "../../shared/header-templates"

describe("Header Templates", () => {
	describe("OPENAI_HEADER_TEMPLATES", () => {
		it("should contain predefined templates", () => {
			assert.ok(OPENAI_HEADER_TEMPLATES.openWebUI, "Open WebUI template should exist")
			assert.ok(OPENAI_HEADER_TEMPLATES.azureApiGateway, "Azure API Gateway template should exist")
		})

		it("should have the expected structure", () => {
			const template = OPENAI_HEADER_TEMPLATES.openWebUI
			assert.strictEqual(typeof template.name, "string", "Template should have a name")
			assert.strictEqual(typeof template.description, "string", "Template should have a description")
			assert.strictEqual(typeof template.headers, "object", "Template should have headers object")
		})
	})

	describe("processHeaderTemplate", () => {
		it("should process template variables correctly", () => {
			const template = {
				name: "Test Template",
				description: "Test template for variable substitution",
				headers: {
					Authorization: "Bearer ${apiKey}",
					"X-Custom-Header": "Value-${customVar}",
				},
			}

			const variables = {
				apiKey: "test-api-key",
				customVar: "custom-value",
			}

			const result = processHeaderTemplate(template, variables)

			assert.deepStrictEqual(
				result,
				{
					Authorization: "Bearer test-api-key",
					"X-Custom-Header": "Value-custom-value",
				},
				"Template variables should be substituted correctly",
			)
		})

		it("should handle missing variables gracefully", () => {
			const template = {
				name: "Test Template",
				description: "Test template for missing variables",
				headers: {
					Authorization: "Bearer ${apiKey}",
					"X-Custom-Header": "Value-${missingVar}",
				},
			}

			const variables = {
				apiKey: "test-api-key",
			}

			const result = processHeaderTemplate(template, variables)

			assert.deepStrictEqual(
				result,
				{
					Authorization: "Bearer test-api-key",
					"X-Custom-Header": "Value-${missingVar}",
				},
				"Missing variables should remain as placeholders",
			)
		})

		it("should handle empty variables object", () => {
			const template = {
				name: "Test Template",
				description: "Test template for empty variables",
				headers: {
					Authorization: "Bearer ${apiKey}",
					"X-Static-Header": "static-value",
				},
			}

			const result = processHeaderTemplate(template, {})

			assert.deepStrictEqual(
				result,
				{
					Authorization: "Bearer ${apiKey}",
					"X-Static-Header": "static-value",
				},
				"Static headers should remain unchanged, variable placeholders should remain",
			)
		})
	})
})
