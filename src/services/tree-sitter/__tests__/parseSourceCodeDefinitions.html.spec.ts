import { sampleHtmlContent } from "./fixtures/sample-html"
import { htmlQuery } from "../queries"
import { testParseSourceCodeDefinitions } from "./helpers"

describe("HTML Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const testOptions = {
			language: "html",
			wasmFile: "tree-sitter-html.wasm",
			queryString: htmlQuery,
			extKey: "html",
		}
		const result = await testParseSourceCodeDefinitions("test.html", sampleHtmlContent, testOptions)
		if (!result) {
			throw new Error("Failed to parse HTML content")
		}
		parseResult = result
	})

	it("should parse doctype definition", () => {
		expect(parseResult).toMatch(/1--1 \|\s*<!DOCTYPE html>/)
	})

	it("should parse document definition", () => {
		expect(parseResult).toMatch(/2--2 \|\s*<html lang=\"en\">/)
	})

	it("should parse element definition", () => {
		expect(parseResult).toMatch(/17--17 \|\s*<div class=\"test-element\"/)
	})

	it("should parse script definition", () => {
		expect(parseResult).toMatch(/32--32 \|\s*<script type=\"text\/javascript\">/)
	})

	it("should parse style definition", () => {
		expect(parseResult).toMatch(/39--39 \|\s*<style type=\"text\/css\">/)
	})

	it("should parse attribute definition", () => {
		expect(parseResult).toMatch(/24--24 \|\s*<div class=\"test-attribute\"/)
	})

	it("should parse comment definition", () => {
		expect(parseResult).toMatch(/12--15 \|\s*<!-- Multi-line comment structure/)
	})

	it("should parse text definition", () => {
		expect(parseResult).toMatch(/48--51 \|\s*This is a text node/)
	})

	it("should parse raw text definition", () => {
		expect(parseResult).toMatch(/70--73 \|\s*Raw text content/)
	})

	it("should parse void element definition", () => {
		expect(parseResult).toMatch(/61--61 \|\s*<img src=\"test\.jpg\"/)
	})

	it("should parse self closing tag definition", () => {
		expect(parseResult).toMatch(/66--66 \|\s*<br class=\"test-self-closing\" \/>/)
	})

	it("should parse nested elements definition", () => {
		expect(parseResult).toMatch(/77--77 \|\s*<div class=\"test-nested\"/)
	})
})
