import { describe, it, expect, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import { sampleZig } from "./fixtures/sample-zig"
import { zigQuery } from "../queries"

describe("Zig Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("file.zig", sampleZig, {
			language: "zig",
			wasmFile: "tree-sitter-zig.wasm",
			queryString: zigQuery,
			extKey: "zig",
		})
		expect(result).toBeDefined()
		expect(typeof result).toBe("string")
		parseResult = result as string
	})

	it("should parse function definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| pub fn main\(\) !void/)
		expect(parseResult).toMatch(/\d+--\d+ \|     pub fn init\(x: f32, y: f32\) Point/)
		expect(parseResult).toMatch(/\d+--\d+ \|     pub fn distance\(self: Point\) f32/)
	})

	it("should parse container definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| pub const Point = struct/)
		expect(parseResult).toMatch(/\d+--\d+ \| pub const Vector = struct/)
		expect(parseResult).toMatch(/\d+--\d+ \| const Direction = enum/)
	})

	it("should parse variable definitions", () => {
		expect(parseResult).toMatch(/\d+--\d+ \| const std = @import\("std"\)/)
		expect(parseResult).toMatch(/\d+--\d+ \| var global_point: Point/)
		expect(parseResult).toMatch(/\d+--\d+ \| pub const VERSION: u32/)
	})
})
