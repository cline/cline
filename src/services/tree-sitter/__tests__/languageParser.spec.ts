// npx vitest services/tree-sitter/__tests__/languageParser.spec.ts

import * as path from "path"
import { loadRequiredLanguageParsers } from "../languageParser"

// Path to the directory containing the WASM files.
const WASM_DIR = path.join(__dirname, "../../../node_modules/tree-sitter-wasms/out")

describe("loadRequiredLanguageParsers", () => {
	it("should load Python parser for .py files", async () => {
		const files = ["test.py"]
		const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
		expect(parsers.py).toBeDefined()
	})

	it("should load JavaScript parser for .js and .jsx files", async () => {
		const files = ["test.js", "test.jsx"]
		const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
		expect(parsers.js).toBeDefined()
		expect(parsers.jsx).toBeDefined()
		expect(parsers.js.query).toBeDefined()
		expect(parsers.jsx.query).toBeDefined()
	})

	it("should load multiple language parsers as needed", async () => {
		const files = ["test.js", "test.py", "test.rs", "test.go"]
		const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
		expect(parsers.js).toBeDefined()
		expect(parsers.py).toBeDefined()
		expect(parsers.rs).toBeDefined()
		expect(parsers.go).toBeDefined()
	})

	it("should handle C/C++ files correctly", async () => {
		const files = ["test.c", "test.h", "test.cpp", "test.hpp"]
		const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
		expect(parsers.c).toBeDefined()
		expect(parsers.h).toBeDefined()
		expect(parsers.cpp).toBeDefined()
		expect(parsers.hpp).toBeDefined()
	})

	it("should handle Kotlin files correctly", async () => {
		const files = ["test.kt", "test.kts"]
		const parsers = await loadRequiredLanguageParsers(files, WASM_DIR)
		expect(parsers.kt).toBeDefined()
		expect(parsers.kts).toBeDefined()
		expect(parsers.kt.query).toBeDefined()
		expect(parsers.kts.query).toBeDefined()
	})

	it("should throw error for unsupported file extensions", async () => {
		const files = ["test.unsupported"]
		await expect(loadRequiredLanguageParsers(files, WASM_DIR)).rejects.toThrow("Unsupported language: unsupported")
	})
})
