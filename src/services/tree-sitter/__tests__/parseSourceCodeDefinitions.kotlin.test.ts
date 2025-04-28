import { describe, it } from "@jest/globals"
import { kotlinQuery } from "../queries"
import { testParseSourceCodeDefinitions, inspectTreeStructure, debugLog } from "./helpers"
import sampleKotlinContent from "./fixtures/sample-kotlin"

describe("parseSourceCodeDefinitionsForFile with Kotlin", () => {
	const testOptions = {
		language: "kotlin",
		wasmFile: "tree-sitter-kotlin.wasm",
		queryString: kotlinQuery,
		extKey: "kt",
	}

	it("should inspect Kotlin tree structure", async () => {
		const result = await inspectTreeStructure(sampleKotlinContent, "kotlin")
		debugLog("Kotlin Tree Structure:", result)
	})

	it("should parse Kotlin source code definitions", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.kt", sampleKotlinContent, testOptions)
		debugLog("Kotlin Source Code Definitions:", result)
	})
})
