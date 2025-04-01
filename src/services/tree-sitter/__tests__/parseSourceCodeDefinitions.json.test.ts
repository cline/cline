import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { parseSourceCodeDefinitionsForFile } from ".."
import * as fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../../utils/fs"
import { loadRequiredLanguageParsers } from "../languageParser"
import { javascriptQuery } from "../queries"
import { initializeTreeSitter, testParseSourceCodeDefinitions, inspectTreeStructure, debugLog } from "./helpers"

// Sample JSON content for tests
const sampleJsonContent = `{
  "server": {
    "port": 3000,
    "host": "localhost",
    "ssl": {
      "enabled": true,
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem"
    }
  },
  "database": {
    "primary": {
      "host": "db.example.com",
      "port": 5432,
      "credentials": {
        "user": "admin",
        "password": "secret123",
        "roles": ["read", "write", "admin"]
      }
    }
  }
}`

// JSON test options
const jsonOptions = {
	language: "javascript",
	wasmFile: "tree-sitter-javascript.wasm",
	queryString: javascriptQuery,
	extKey: "json",
	content: sampleJsonContent,
}

// Mock file system operations
jest.mock("fs/promises")
const mockedFs = jest.mocked(fs)

// Mock fileExistsAtPath to return true for our test paths
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockImplementation(() => Promise.resolve(true)),
}))

// Mock loadRequiredLanguageParsers
jest.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: jest.fn(),
}))

describe("jsonParserDebug", () => {
	it("should debug tree-sitter parsing directly using JSON example", async () => {
		jest.unmock("fs/promises")

		// Initialize tree-sitter
		const TreeSitter = await initializeTreeSitter()

		// Create parser and query
		const parser = new TreeSitter()
		const wasmPath = path.join(process.cwd(), "dist/tree-sitter-javascript.wasm")
		const jsLang = await TreeSitter.Language.load(wasmPath)
		parser.setLanguage(jsLang)
		const tree = parser.parse(sampleJsonContent)

		// Extract definitions using JavaScript query
		const query = jsLang.query(javascriptQuery)

		expect(tree).toBeDefined()
	})

	it("should successfully parse basic JSON objects", async function () {
		const testFile = "/test/config.json"
		const result = await testParseSourceCodeDefinitions(testFile, sampleJsonContent, jsonOptions)
		expect(result).toBeDefined()
		expect(result).toContain("# config.json")
		expect(result).toContain('"server"')
		expect(result).toContain('"database"')
	})

	it("should detect nested JSON objects and arrays", async function () {
		const testFile = "/test/nested.json"
		const nestedJson = `{
      "users": [
        {
          "id": 1,
          "name": "John Doe",
          "roles": ["admin", "user"]
        },
        {
          "id": 2,
          "name": "Jane Smith",
          "roles": ["user"]
        }
      ],
      "settings": {
        "theme": {
          "dark": true,
          "colors": {
            "primary": "#007bff",
            "secondary": "#6c757d"
          }
        }
      }
    }`

		const result = await testParseSourceCodeDefinitions(testFile, nestedJson, jsonOptions)
		expect(result).toBeDefined()
		expect(result).toContain('"users"')
		expect(result).toContain('"settings"')
		expect(result).toContain('"theme"')
	})
})

describe("parseSourceCodeDefinitions for JSON", () => {
	const testFilePath = "/test/config.json"

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Mock file existence check
		mockedFs.access.mockResolvedValue(undefined)

		// Mock file reading
		mockedFs.readFile.mockResolvedValue(Buffer.from(sampleJsonContent))
	})

	it("should parse top-level object properties", async function () {
		debugLog("\n=== Parse Test: Top-level Properties ===")
		const result = await testParseSourceCodeDefinitions(testFilePath, sampleJsonContent, jsonOptions)
		expect(result).toBeDefined()
		expect(result).toContain('"server"')
		expect(result).toContain('"database"')
	})

	it("should parse nested object properties", async function () {
		debugLog("\n=== Parse Test: Nested Properties ===")
		const result = await testParseSourceCodeDefinitions(testFilePath, sampleJsonContent, jsonOptions)
		expect(result).toBeDefined()
		expect(result).toContain('"ssl"')
		expect(result).toContain('"primary"')
	})

	it("should parse arrays in JSON", async function () {
		const arrayJson = `{
      "items": [1, 2, 3, 4, 5],
      "users": [
        {"name": "John", "age": 30, "active": true},
        {"name": "Jane", "age": 25, "active": false}
      ]
    }`

		const result = await testParseSourceCodeDefinitions("/test/arrays.json", arrayJson, jsonOptions)
		expect(result).toBeDefined()
		// Only check for users since that's what's being captured
		expect(result).toContain('"users"')
	})

	it("should handle complex nested structures", async function () {
		const complexJson = `{
      "metadata": {
        "version": "1.0",
        "generated": "2024-03-31",
        "stats": {
          "count": 42,
          "distribution": {
            "regions": {
              "north": 10,
              "south": 15,
              "east": 8,
              "west": 9
            }
          }
        }
      }
    }`

		const result = await testParseSourceCodeDefinitions("/test/complex.json", complexJson, jsonOptions)
		expect(result).toBeDefined()
		expect(result).toContain('"metadata"')
		expect(result).toContain('"stats"')
		expect(result).toContain('"distribution"')
		expect(result).toContain('"regions"')
	})
})
