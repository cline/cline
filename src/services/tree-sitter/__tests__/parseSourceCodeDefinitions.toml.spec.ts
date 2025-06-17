import { initializeTreeSitter, testParseSourceCodeDefinitions } from "./helpers"
import { tomlQuery } from "../queries"
import { sampleToml } from "./fixtures/sample-toml"

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

describe("TOML Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		await initializeTreeSitter()
		const result = await testParseSourceCodeDefinitions("test.toml", sampleToml, {
			language: "toml",
			wasmFile: "tree-sitter-toml.wasm",
			queryString: tomlQuery,
			extKey: "toml",
		})
		expect(result).toBeDefined()
		expect(typeof result).toBe("string")
		parseResult = result as string
	})

	it("should parse tables", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[database\]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[servers\]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[owner\.personal\]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[complex_values\]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[mixed_content\]/)
	})

	it("should parse table arrays", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[\[products\]\]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*\[\[products\]\]  # Array of tables/)
	})

	it("should parse inline tables", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*alpha = \{ ip = "10\.0\.0\.1", role = "frontend" \}/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*beta = \{ ip = "10\.0\.0\.2", role = "backend" \}/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*metadata = \{ created = 2024-01-01, updated = 2024-04-13 \}/)
	})

	it("should parse arrays", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*ports = \[ 8001, 8001, 8002 \]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*strings = \[/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*numbers = \[ 42, -17, 3\.14, 1e10 \]/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*dates = \[/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*features = \[/)
	})

	it("should parse strings", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*server = "192\.168\.1\.1"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*name = "Tom Preston-Werner"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*description = """/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*'''/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*"""/)
	})

	it("should parse numbers", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*connection_max = 5000/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*sku = 738594937/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*numbers = \[ 42, -17, 3\.14, 1e10 \]/)
	})

	it("should parse booleans", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*enabled = true/)
	})

	it("should parse dates and times", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*dob = 1979-05-27T07:32:00-08:00/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*1979-05-27T07:32:00-08:00/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*1979-05-27/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*07:32:00/)
	})

	it("should parse dotted keys", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*"dotted\.key\.example" = "value"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*physical\.color = "orange"/)
		expect(parseResult).toMatch(/\d+--\d+ \|\s*physical\.shape = "round"/)
	})
})
