/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. Using Directives:
   (using_directive) - Can be parsed by tree-sitter but not appearing in output despite query pattern
*/

// Mocks must come first, before imports
vi.mock("fs/promises")

// Mock loadRequiredLanguageParsers
vi.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: vi.fn(),
}))

// Mock fileExistsAtPath to return true for our test paths
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => Promise.resolve(true)),
}))

import { csharpQuery } from "../queries"
import { testParseSourceCodeDefinitions } from "./helpers"
import sampleCSharpContent from "./fixtures/sample-c-sharp"

// C# test options
const csharpOptions = {
	language: "c_sharp",
	wasmFile: "tree-sitter-c_sharp.wasm",
	queryString: csharpQuery,
	extKey: "cs",
}

describe("parseSourceCodeDefinitionsForFile with C#", () => {
	let parseResult: string | undefined

	beforeAll(async () => {
		// Cache parse result for all tests
		const result = await testParseSourceCodeDefinitions("/test/file.cs", sampleCSharpContent, csharpOptions)
		if (!result) {
			throw new Error("Failed to parse C# source code definitions")
		}
		parseResult = result
	})

	beforeEach(() => {
		vi.clearAllMocks()
		expect(parseResult).toBeDefined()
	})

	it("should parse namespace declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*namespace TestNamespaceDefinition/)
	})

	it("should parse file-scoped namespace declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*namespace TestFileScopedNamespaceDefinition/)
	})

	it("should parse class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public class TestClassDefinition/)
	})

	it("should parse interface declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public interface ITestInterfaceDefinition/)
	})

	it("should parse enum declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public enum TestEnumDefinition/)
	})

	it("should parse method declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*void TestInterfaceMethod/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public async Task TestAsyncMethodDefinition/)
	})

	it("should parse property declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public string TestPropertyDefinition/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public required string TestRequiredProperty/)
	})

	it("should parse event declarations", () => {
		expect(parseResult).toMatch(
			/\d+--\d+ \|\s*public event EventHandler<TestEventArgsDefinition> TestEventDefinition/,
		)
	})

	it("should parse delegate declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public delegate void TestDelegateDefinition/)
	})

	it("should parse struct declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public struct TestStructDefinition/)
	})

	it("should parse record declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public record TestRecordDefinition/)
	})

	it("should parse attribute declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[AttributeUsage/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[TestAttributeDefinition/)
	})

	it("should parse generic type parameters", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public class TestGenericClassDefinition<T>/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public T TestGenericMethodDefinition<T>/)
	})

	it("should parse LINQ expressions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*var result = from num in _numbers/)
	})
})
