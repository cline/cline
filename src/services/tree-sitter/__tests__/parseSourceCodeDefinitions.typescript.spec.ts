import { testParseSourceCodeDefinitions } from "./helpers"
import { typescriptQuery } from "../queries"
import sampleTypeScriptContent from "./fixtures/sample-typescript"

describe("TypeScript Source Code Definition Tests", () => {
	const testOptions = {
		language: "typescript",
		wasmFile: "tree-sitter-typescript.wasm",
		queryString: typescriptQuery,
		extKey: "ts",
	}

	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("test.ts", sampleTypeScriptContent, testOptions)
		if (!result) {
			throw new Error("Failed to parse TypeScript content")
		}
		parseResult = result
	})

	it("should parse interface declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*interface TestInterfaceDefinition/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*interface TestGenericInterfaceDefinition<T, U>/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*interface TestJsxPropsDefinition/)
	})

	it("should parse type alias declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*type TestTypeDefinition =/)
	})

	it("should parse enum declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*enum TestEnumDefinition/)
	})

	it("should parse namespace declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*namespace TestNamespaceDefinition/)
	})

	it("should parse function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*function testTypedFunctionDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*async function testTypedAsyncFunctionDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*function testGenericFunctionDefinition<T, U>\(/)
	})

	it("should parse class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*class TestTypedClassDefinition/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*abstract class TestAbstractClassDefinition/)
	})

	it("should parse method declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*methodSignature\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*genericMethod<T>\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*format\(\): string/)
	})

	it("should parse decorated class and method declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*function testTypedDecoratorDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*testDecoratedMethodDefinition\(/)
	})
})
