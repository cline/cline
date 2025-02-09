import * as assert from "assert"
import * as path from "path"
import Parser from "web-tree-sitter"
import * as queries from "./index"
import { before, after, describe, it } from "mocha"

describe("Tree-Sitter Query Tests", () => {
	let parser: Parser

	before(async () => {
		await Parser.init()
	})

	async function testLanguageQueries(name: string, wasmFile: string, mainQuery: string, importQuery?: string) {
		describe(name, () => {
			let language: Parser.Language

			before(async () => {
				// Load from the wasm directory where the WASM files are stored
				language = await Parser.Language.load(path.join(__dirname, "..", "wasm", wasmFile))
				parser = new Parser()
				parser.setLanguage(language)
			})

			it("should compile main query", () => {
				assert.doesNotThrow(() => {
					const query = language.query(mainQuery)
					// Verify query has captures
					assert.ok(query.captureNames.length > 0, "Query should have at least one capture")
				}, `Main query for ${name} failed to compile`)
			})

			if (importQuery) {
				it("should compile import query", () => {
					assert.doesNotThrow(() => {
						const query = language.query(importQuery)
						// Verify query has captures
						assert.ok(query.captureNames.length > 0, "Import query should have at least one capture")
					}, `Import query for ${name} failed to compile`)
				})
			}

			after(() => {
				parser.delete()
			})
		})
	}

	// Test each language
	testLanguageQueries("TypeScript", "tree-sitter-typescript.wasm", queries.typescriptQuery, queries.typescriptImports)
	testLanguageQueries("JavaScript", "tree-sitter-javascript.wasm", queries.javascriptQuery, queries.javascriptImports)
	testLanguageQueries("Python", "tree-sitter-python.wasm", queries.pythonQuery, queries.pythonImports)
	testLanguageQueries("Rust", "tree-sitter-rust.wasm", queries.rustQuery, queries.rustImports)
	testLanguageQueries("Go", "tree-sitter-go.wasm", queries.goQuery, queries.goImports)
	testLanguageQueries("Java", "tree-sitter-java.wasm", queries.javaQuery, queries.javaImports)
	testLanguageQueries("C++", "tree-sitter-cpp.wasm", queries.cppQuery, queries.cppImports)
	testLanguageQueries("C", "tree-sitter-c.wasm", queries.cQuery, queries.cImports)
	testLanguageQueries("C#", "tree-sitter-c_sharp.wasm", queries.csharpQuery, queries.csharpImports)
	testLanguageQueries("Ruby", "tree-sitter-ruby.wasm", queries.rubyQuery, queries.rubyImports)
	testLanguageQueries("PHP", "tree-sitter-php.wasm", queries.phpQuery, queries.phpImports)
	testLanguageQueries("Swift", "tree-sitter-swift.wasm", queries.swiftQuery, queries.swiftImports)
})
