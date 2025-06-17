import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { csharpQuery } from "../queries"
import sampleCSharpContent from "./fixtures/sample-c-sharp"

describe("inspectCSharp", () => {
	const testOptions = {
		language: "c_sharp",
		wasmFile: "tree-sitter-c_sharp.wasm",
		queryString: csharpQuery,
		extKey: "cs",
	}

	it("should inspect C# tree structure", async () => {
		// Should execute without throwing
		await expect(inspectTreeStructure(sampleCSharpContent, "c_sharp")).resolves.not.toThrow()
	})

	it("should parse C# definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.cs", sampleCSharpContent, testOptions)
		expect(result).toBeDefined()
		expect(result).toMatch(/\d+--\d+ \|/)
	})
})
