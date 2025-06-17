import { inspectTreeStructure, testParseSourceCodeDefinitions } from "./helpers"
import { samplePythonContent } from "./fixtures/sample-python"
import { pythonQuery } from "../queries"

// Python test options
const pythonOptions = {
	language: "python",
	wasmFile: "tree-sitter-python.wasm",
	queryString: pythonQuery,
	extKey: "py",
}

describe("Python Tree-sitter Parser", () => {
	it("should successfully parse and inspect Python code", async () => {
		// Verify tree structure inspection succeeds
		const inspectResult = await inspectTreeStructure(samplePythonContent, "python")
		expect(inspectResult).toBeDefined()

		// Verify source code definitions parsing succeeds
		const parseResult = await testParseSourceCodeDefinitions("test.py", samplePythonContent, pythonOptions)
		expect(parseResult).toMatch(/\d+--\d+ \|/) // Verify line number format
		expect(parseResult).toContain("class") // Basic content verification
	})
})
