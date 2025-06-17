/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. React Hooks:
   (call_expression
     function: (member_expression
       object: (identifier) @react
       property: [(property_identifier) @hook_name]))
   - Affects useState, useEffect, useRef, useCallback, useMemo
   - Currently visible in parse tests but no query patterns exist

2. Context Providers/Consumers:
   (jsx_element
     open_tag: (jsx_opening_element
       name: (member_expression
         object: (identifier) @context
         property: [(property_identifier) @provider
                   (property_identifier) @consumer])))
   - Can be parsed as JSX elements but no specific capture patterns

3. React Event Handlers:
   (arrow_function
     parameters: (formal_parameters
       (required_parameter
         pattern: (identifier)
         type: (type_annotation
           (generic_type
             name: (nested_type_identifier
               module: (identifier) @react
               name: (type_identifier) @event_type)))))
   - Parsed but no specific patterns for React synthetic events
*/

import { initializeTreeSitter, testParseSourceCodeDefinitions } from "./helpers"
import sampleTsxContent from "./fixtures/sample-tsx"

// Mock fs module
vi.mock("fs/promises")

// Mock languageParser module
vi.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: vi.fn(),
}))

// Mock file existence check
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => Promise.resolve(true)),
}))

describe("parseSourceCodeDefinitionsForFile with TSX", () => {
	// Cache test results at the top of the describe block
	let result: string

	beforeAll(async () => {
		await initializeTreeSitter()
		// Cache the parse result for use in all tests
		const parseResult = await testParseSourceCodeDefinitions("test.tsx", sampleTsxContent, {
			language: "tsx",
			wasmFile: "tree-sitter-tsx.wasm",
		})
		expect(parseResult).toBeDefined()
		expect(typeof parseResult).toBe("string")
		result = parseResult as string
	})

	// Type Definition Tests
	it("should capture interface declarations", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*interface StandardInterfaceProps/)
		expect(result).toMatch(/\d+--\d+ \|\s*interface PropsDefinitionExample/)
		expect(result).toMatch(/\d+--\d+ \|\s*interface ClassComponentState/)
		expect(result).toMatch(/\d+--\d+ \|\s*interface GenericComponentProps<T>/)
	})

	it("should capture type alias declarations", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*type StandardTypeAlias/)
		expect(result).toMatch(/\d+--\d+ \|\s*type UserType/)
	})

	// Component Definition Tests
	it("should capture function component declarations", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*function StandardFunctionComponent/)
		expect(result).toMatch(/\d+--\d+ \|\s*function GenericListComponent<T>/)
	})

	it("should capture arrow function components", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*export const ArrowFunctionComponent/)
		expect(result).toMatch(/\d+--\d+ \|\s*const JSXElementsExample/)
		expect(result).toMatch(/\d+--\d+ \|\s*const EventHandlersComponent/)
		expect(result).toMatch(/\d+--\d+ \|\s*const HooksStateComponent/)
		expect(result).toMatch(/\d+--\d+ \|\s*const HooksUsageComponent/)
		expect(result).toMatch(/\d+--\d+ \|\s*const GenericComponentUsage/)
	})

	it("should capture class components", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*class StandardClassComponent extends React.Component/)
	})

	it("should capture higher order components", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*function withLogging<P extends object>/)
	})

	// JSX Elements Tests
	it("should capture JSX elements", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*<div className="jsx-elements-container">/)
		expect(result).toMatch(/\d+--\d+ \|\s*<Input/)
		expect(result).toMatch(/\d+--\d+ \|\s*<UI.Button/)
		expect(result).toMatch(/\d+--\d+ \|\s*<StandardFunctionComponent/)
	})

	it("should capture React hooks usage", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*const \[data, setData\] = React\.useState/)
		expect(result).toMatch(/\d+--\d+ \|\s*const counter = React\.useRef/)
		expect(result).toMatch(/\d+--\d+ \|\s*React\.useEffect\(\(\)/)
		expect(result).toMatch(/\d+--\d+ \|\s*const fetchData = React\.useCallback/)
		expect(result).toMatch(/\d+--\d+ \|\s*const memoizedValue = React\.useMemo/)
	})

	it("should capture event handlers", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*const handleClick =/)
		expect(result).toMatch(/\d+--\d+ \|\s*const handleChange =/)
		expect(result).toMatch(/\d+--\d+ \|\s*const handleSubmit =/)
	})

	it("should capture generic component declarations", () => {
		expect(result).toMatch(/\d+--\d+ \|\s*function GenericListComponent<T>/)
		expect(result).toMatch(/\d+--\d+ \|\s*interface GenericComponentProps<T>/)
	})
})
