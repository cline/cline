import { describe, expect, it, jest, beforeEach, beforeAll } from "@jest/globals"
import { swiftQuery } from "../queries"
import { testParseSourceCodeDefinitions } from "./helpers"
import sampleSwiftContent from "./fixtures/sample-swift"

// Swift test options
const testOptions = {
	language: "swift",
	wasmFile: "tree-sitter-swift.wasm",
	queryString: swiftQuery,
	extKey: "swift",
}

// Mock fs module
jest.mock("fs/promises")

// Mock languageParser module
jest.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: jest.fn(),
}))

// Mock file existence check
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockImplementation(() => Promise.resolve(true)),
}))

describe("parseSourceCodeDefinitionsForFile with Swift", () => {
	// Cache the result to avoid repeated slow parsing
	let parsedResult: string | undefined

	// Run once before all tests to parse the Swift code
	beforeAll(async () => {
		// Parse Swift code once and store the result
		parsedResult = await testParseSourceCodeDefinitions("/test/file.swift", sampleSwiftContent, testOptions)
	})

	beforeEach(() => {
		jest.clearAllMocks()
	})

	// Single test for class declarations (standard, final, open, and inheriting classes)
	it("should capture class declarations with all modifiers", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*class StandardClassDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*final class FinalClassDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*open class OpenClassDefinition/)
		expect(parsedResult).toMatch(
			/\d+--\d+ \|\s*class InheritingClassDefinition: StandardClassDefinition, ProtocolDefinition/,
		)
	})

	// Single test for struct declarations (standard and generic structs)
	it("should capture struct declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*struct StandardStructDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*struct GenericStructDefinition<T: Comparable, U>/)
	})

	// Single test for protocol declarations (basic and with associated types)
	it("should capture protocol declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*protocol ProtocolDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*protocol AssociatedTypeProtocolDefinition/)
	})

	// Single test for extension declarations (for class, struct, and protocol)
	it("should capture extension declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*extension StandardClassDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*extension StandardStructDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*extension ProtocolDefinition/)
	})

	// Single test for method declarations (instance and type methods)
	it("should capture method declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*func instanceMethodDefinition/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*static func typeMethodDefinition/)
	})

	// Single test for property declarations (stored and computed)
	it("should capture property declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*var storedPropertyWithObserver: Int = 0/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*var computedProperty: String/)
	})

	// Single test for initializer declarations (designated and convenience)
	it("should capture initializer declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*init\(/)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*convenience init\(/)
	})

	// Single test for deinitializer declarations
	it("should capture deinitializer declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*deinit/)
	})

	// Single test for subscript declarations
	it("should capture subscript declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*subscript\(/)
	})

	// Single test for type alias declarations
	it("should capture type alias declarations", async () => {
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*typealias DictionaryOfArrays</)
		expect(parsedResult).toMatch(/\d+--\d+ \|\s*class TypeAliasContainer/)
	})
})
