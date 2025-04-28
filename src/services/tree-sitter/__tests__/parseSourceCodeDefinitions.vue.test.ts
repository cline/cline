/*
TODO: The following structures can be parsed by tree-sitter but lack query support:

1. Interpolation:
   (interpolation (raw_text))

2. Element Attributes:
   (attribute (attribute_name) (quoted_attribute_value (attribute_value)))
*/

import { describe, it, expect, beforeAll } from "@jest/globals"
import { testParseSourceCodeDefinitions } from "./helpers"
import { sampleVue } from "./fixtures/sample-vue"
import { vueQuery } from "../queries/vue"

describe("Vue Source Code Definition Tests", () => {
	let parseResult: string

	beforeAll(async () => {
		const result = await testParseSourceCodeDefinitions("test.vue", sampleVue, {
			language: "vue",
			wasmFile: "tree-sitter-vue.wasm",
			queryString: vueQuery,
			extKey: "vue",
		})
		expect(result).toBeDefined()
		expect(typeof result).toBe("string")
		parseResult = result as string
	})

	it("should parse template section", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*<template>/)
	})

	it("should parse script section", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*<script>/)
	})

	it("should parse style section", () => {
		expect(parseResult).toMatch(/\d+--\d+ \|\s*<style>/)
	})

	it("should parse sections in correct order", () => {
		const lines = parseResult?.split("\n") || []
		const templateIndex = lines.findIndex((line) => line.includes("| <template>"))
		const scriptIndex = lines.findIndex((line) => line.includes("| <script>"))
		const styleIndex = lines.findIndex((line) => line.includes("| <style>"))

		expect(templateIndex).toBeLessThan(scriptIndex)
		expect(scriptIndex).toBeLessThan(styleIndex)
	})

	it("should match expected line ranges", () => {
		expect(parseResult).toMatch(/2--93 \|\s*<template>/)
		expect(parseResult).toMatch(/13--83 \|\s*<script>/)
		expect(parseResult).toMatch(/85--92 \|\s*<style>/)
	})
})
