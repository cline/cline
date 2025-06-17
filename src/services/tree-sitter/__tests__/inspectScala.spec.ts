import { inspectTreeStructure, testParseSourceCodeDefinitions, debugLog } from "./helpers"
import { scalaQuery } from "../queries"
import { sampleScala } from "./fixtures/sample-scala"

describe("inspectScala", () => {
	const testOptions = {
		language: "scala",
		wasmFile: "tree-sitter-scala.wasm",
		queryString: scalaQuery,
		extKey: "scala",
	}

	it("should inspect Scala tree structure", async () => {
		const result = await inspectTreeStructure(sampleScala, "scala")
		expect(result).toBeDefined()
	})

	it("should parse Scala definitions", async () => {
		const result = await testParseSourceCodeDefinitions("test.scala", sampleScala, testOptions)
		expect(result).toBeDefined()
		expect(result).toMatch(/\d+--\d+ \|/)
		debugLog("Scala parse result:", result)
	})
})
