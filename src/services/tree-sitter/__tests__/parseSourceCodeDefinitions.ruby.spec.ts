// npx vitest services/tree-sitter/__tests__/parseSourceCodeDefinitions.ruby.spec.ts

vi.mock("fs/promises")

vi.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: vi.fn(),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => Promise.resolve(true)),
}))

import { rubyQuery } from "../queries"
import { testParseSourceCodeDefinitions, debugLog } from "./helpers"
import sampleRubyContent from "./fixtures/sample-ruby"

const rubyOptions = {
	language: "ruby",
	wasmFile: "tree-sitter-ruby.wasm",
	queryString: rubyQuery,
	extKey: "rb",
}

describe("Ruby Source Code Definition Parsing", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should capture standard and nested class definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Class definitions:", result)
		expect(result).toContain("StandardClassDefinition")
		expect(result).toContain("NestedClassDefinition")
	})

	it("should capture standard and nested module definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Module definitions:", result)
		expect(result).toContain("StandardModuleDefinition")
		expect(result).toContain("NestedModuleDefinition")
	})

	it("should capture all method definition types", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Method definitions:", result)
		expect(result).toContain("standard_instance_method")
		expect(result).toContain("class_method_example")
		expect(result).toContain("singleton_method_example")
	})

	it("should capture block definitions with both syntaxes", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Block definitions:", result)
		expect(result).toContain("method_with_do_end_block")
		expect(result).toContain("method_with_brace_block")
	})

	it("should capture begin/rescue/ensure blocks", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Exception handling:", result)
		expect(result).toContain("exception_handling_method")
		expect(result).toContain("begin")
		expect(result).toContain("rescue")
		expect(result).toContain("ensure")
	})

	it("should capture all attribute accessor types", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Attribute accessors:", result)
		expect(result).toContain("attr_reader")
		expect(result).toContain("attr_writer")
		expect(result).toContain("attr_accessor")
	})

	it("should capture include and extend mixins", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Mixins:", result)

		// Test for basic mixin presence
		expect(result).toMatch(/module\s+MixinTestModule/)
		expect(result).toMatch(/shared_mixin_method/)

		// Test for mixin usage
		expect(result).toMatch(/include/)
		expect(result).toMatch(/extend/)
		expect(result).toMatch(/prepend/)

		// Test for mixin-related methods
		expect(result).toMatch(/included_method/)
		expect(result).toMatch(/class << self/)
		expect(result).toMatch(/prepended_method/)
	})

	it("should capture Rails-style class macros", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Class macros:", result)
		expect(result).toContain("has_many")
		expect(result).toContain("belongs_to")
		expect(result).toContain("validates")
	})

	it("should capture symbol and hash definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.rb", sampleRubyContent, rubyOptions)
		debugLog("Symbols and hashes:", result)
		expect(result).toContain("HASH_EXAMPLES")
		expect(result).toContain("SYMBOL_EXAMPLES")
	})
})
