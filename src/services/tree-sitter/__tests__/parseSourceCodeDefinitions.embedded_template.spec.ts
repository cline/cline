import { debugLog, testParseSourceCodeDefinitions } from "./helpers"
import { embeddedTemplateQuery } from "../queries"
import sampleEmbeddedTemplateContent from "./fixtures/sample-embedded_template"

describe("parseSourceCodeDefinitions (Embedded Template)", () => {
	const testOptions = {
		language: "embedded_template",
		wasmFile: "tree-sitter-embedded_template.wasm",
		queryString: embeddedTemplateQuery,
		extKey: "erb",
		minComponentLines: 4,
	}

	let parseResult: string = ""

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("test.erb", sampleEmbeddedTemplateContent, testOptions)
		if (!result) {
			throw new Error("Failed to parse source code definitions")
		}
		parseResult = result
		debugLog("All definitions:", parseResult)
	})

	it("should detect multi-line comments", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| <%# Multi-line comment block explaining/)
	})

	it("should detect function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| <% def complex_helper\(param1, param2\)/)
		expect(parseResult).toMatch(/\d+--\d+ \| <% def render_navigation\(items\)/)
	})

	it("should detect class definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| <% class TemplateHelper/)
	})

	it("should detect module definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| <% module TemplateUtils/)
	})

	it("should detect control structures", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s+<% if user\.authenticated\? %>/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s+<% user\.posts\.each do \|post\| %>/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s+<% if post\.has_comments\? %>/)
	})

	it("should detect content blocks", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| <% content_for :header do/)
		expect(parseResult).toMatch(/\d+--\d+ \| <% content_for :main do/)
	})
})
