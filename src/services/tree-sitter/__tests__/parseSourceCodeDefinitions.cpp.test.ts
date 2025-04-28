/*
TODO: The following C++ structures can be parsed by tree-sitter but lack query support:

1. Virtual Methods:
   (field_declaration (virtual) type: (primitive_type) declarator: (function_declarator))
   Example: virtual void method() = 0;

2. Default Methods:
   (default_method_clause)
   Example: virtual ~base_class_definition() = default;

3. Field Initializer Lists:
   (field_initializer_list (field_initializer))
   Example: constructor() : field1(value1), field2(value2) {}

4. Base Class Clauses:
   (base_class_clause (access_specifier) (type_identifier))
   Example: class derived : public base {}

5. Type Aliases:
   (alias_declaration name: (type_identifier) type: (type_descriptor))
   Example: using size_type = std::size_t;
*/

import { describe, it, expect, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import { cppQuery } from "../queries"
import sampleCppContent from "./fixtures/sample-cpp"

describe("parseSourceCodeDefinitions (C++)", () => {
	const testOptions = {
		language: "cpp",
		wasmFile: "tree-sitter-cpp.wasm",
		queryString: cppQuery,
		extKey: "cpp",
	}

	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("test.cpp", sampleCppContent, testOptions)
		expect(result).toBeDefined()
		expect(typeof result).toBe("string")
		expect(result).toContain("# test.cpp")
		parseResult = result as string
	})

	it("should parse function declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| void multiline_function_prototype\(/)
		expect(parseResult).toMatch(/\d+--\d+ \| void function_with_implementation\(/)
	})

	it("should parse struct declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| struct four_field_struct/)
	})

	it("should parse class declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| class base_class_definition/)
		expect(parseResult).toMatch(/\d+--\d+ \| class template_class_definition/)
	})

	it("should parse union declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| union four_member_union/)
	})

	it("should parse enum declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| enum class scoped_enumeration/)
	})

	it("should parse typedef declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| typedef std::vector</)
	})

	it("should parse namespace declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| namespace deeply_nested_namespace/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*namespace inner/)
	})

	it("should parse template declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| template</)
	})

	it("should parse macro definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| #define MULTI_LINE_MACRO\(x, y\)/)
	})

	it("should parse variable declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| static const std::map</)
	})

	it("should parse constructor declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*constructor_test\(/)
	})

	it("should parse destructor declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*~destructor_test\(\)/)
	})

	it("should parse operator overloads", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*bool operator==/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*bool operator</)
	})

	it("should parse friend declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*friend class friend_class;/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*friend void friend_function\(/)
	})

	it("should parse using declarations", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*using base_class_definition::virtual_method;/)
	})
})
