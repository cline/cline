import { describe, expect, it, jest, beforeAll, beforeEach } from "@jest/globals"
import { javaQuery } from "../queries"
import { testParseSourceCodeDefinitions } from "./helpers"
import sampleJavaContent from "./fixtures/sample-java"

/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. Import Declarations:
   (import_declaration (scoped_identifier))
   - Tree-sitter successfully parses import statements but no query pattern exists
   - Example from inspect output: 'import java.util.List;'
   - Would enable capturing package dependencies and API usage

2. Field Declarations:
   (field_declaration (modifiers) type: (type_identifier) declarator: (variable_declarator))
   - Current query pattern needs enhancement to fully capture modifier information
   - Example from inspect output: 'private static final int count = 0;'
   - Would improve field visibility and mutability analysis
*/

// Java test options
const testOptions = {
	language: "java",
	wasmFile: "tree-sitter-java.wasm",
	queryString: javaQuery,
	extKey: "java",
}

describe("parseSourceCodeDefinitionsForFile with Java", () => {
	let parseResult: string = ""

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.java", sampleJavaContent, testOptions)
		if (!result) {
			throw new Error("Failed to parse Java source code")
		}
		parseResult = result
	})

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should parse package declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*package test\.package\.definition/)
	})

	it("should parse module declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*module test\.module\.definition/)
	})

	it("should parse annotation declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*@Target/)
	})

	it("should parse interface declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public interface TestInterfaceDefinition/)
	})

	it("should parse enum declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public enum TestEnumDefinition/)
	})

	it("should parse class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*@TestAnnotationDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*implements TestInterfaceDefinition<T>/)
	})

	it("should parse abstract class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public abstract class TestAbstractClassDefinition/)
	})

	it("should parse inner class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public class TestInnerClassDefinition/)
	})

	it("should parse static nested class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public static class TestStaticNestedClassDefinition/)
	})

	it("should parse record declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public record TestRecordDefinition/)
	})

	it("should parse constructor declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public TestClassDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public TestInnerClassDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public TestStaticNestedClassDefinition\(/)
	})

	it("should parse method declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*void testInterfaceMethod\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*default String testInterfaceDefaultMethod\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public <R extends Comparable<R>> R testGenericMethodDefinition\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public String formatMessage\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public abstract String testAbstractMethod\(/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*public void testInnerMethod\(/)
	})
})
