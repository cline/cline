import { describe, it, beforeAll, beforeEach } from "@jest/globals"
import { testParseSourceCodeDefinitions, debugLog } from "./helpers"
import { cssQuery } from "../queries"
import sampleCSSContent from "./fixtures/sample-css"

describe("parseSourceCodeDefinitionsForFile with CSS", () => {
	const testOptions = {
		language: "css",
		wasmFile: "tree-sitter-css.wasm",
		queryString: cssQuery,
		extKey: "css",
		debug: true,
	}

	let parseResult: string | undefined

	beforeAll(async () => {
		// Cache parse result for all tests
		parseResult = await testParseSourceCodeDefinitions("test.css", sampleCSSContent, testOptions)
		if (!parseResult) {
			throw new Error("No result returned from parser")
		}
		debugLog("CSS Parse Result:", parseResult)
	})

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should parse CSS variable declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*--test-variable-definition-primary:/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*--test-variable-definition-secondary:/)
		debugLog("Variable declarations:", parseResult!.match(/--test-variable-definition-[\w-]+:[\s\S]*?;/g))
	})

	it("should parse import statements", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| @import .+test-import-definition/)
		debugLog("Import statements:", parseResult!.match(/@import[\s\S]*?;/g))
	})

	it("should parse media queries", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\.test-media-query-definition/)
		debugLog("Media queries:", parseResult!.match(/@media[\s\S]*?{[\s\S]*?}/g))
	})

	it("should parse keyframe declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| @keyframes test-keyframe-definition-fade/)
		debugLog("Keyframe declarations:", parseResult!.match(/@keyframes[\s\S]*?{[\s\S]*?}/g))
	})

	it("should parse function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| {1,}background-color: rgba\(/)
		expect(parseResult).toMatch(/\d+--\d+ \| {1,}transform: translate\(/)
		debugLog("Function declarations:", parseResult!.match(/(?:rgba|translate|calc|var)\([\s\S]*?\)/g))
	})

	it("should parse basic rulesets", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \.test-ruleset-definition {/)
		debugLog("Basic rulesets:", parseResult!.match(/\.test-ruleset-definition[\s\S]*?{[\s\S]*?}/g))
	})

	it("should parse complex selectors", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \.test-selector-definition[:\s>]/)
		debugLog("Complex selectors:", parseResult!.match(/\.test-selector-definition[\s\S]*?{[\s\S]*?}/g))
	})

	it("should parse nested rulesets", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| \.test-nested-ruleset-definition {/)
		debugLog("Nested rulesets:", parseResult!.match(/\.test-nested-ruleset-definition[\s\S]*?{[\s\S]*?}/g))
	})
})
