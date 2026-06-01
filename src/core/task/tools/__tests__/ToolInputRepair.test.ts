import { describe, it } from "mocha"
import "should"
import { repairMcpArgumentsString, repairToolParams, unwrapMarkdownAutolink } from "../ToolInputRepair"

describe("ToolInputRepair — Domain A (path/string unwrap)", () => {
	it("unwraps a degenerate markdown auto-link path", () => {
		unwrapMarkdownAutolink("[notes.md](http://notes.md)")!.should.equal("notes.md")
	})

	it("unwraps when only a trailing slash differs", () => {
		unwrapMarkdownAutolink("[src/app](http://src/app/)")!.should.equal("src/app")
	})

	it("leaves a real link (label != url) untouched", () => {
		;(unwrapMarkdownAutolink("[click here](https://example.com)") === undefined).should.be.true()
	})

	it("leaves a plain path untouched", () => {
		;(unwrapMarkdownAutolink("src/utils/foo.ts") === undefined).should.be.true()
	})

	it("repairs path-like params only, leaving content-bearing params alone", () => {
		const { params, repairs } = repairToolParams({
			path: "[a.md](http://a.md)",
			content: "see [a.md](http://a.md) for details", // must NOT be touched
		})
		params.path!.should.equal("a.md")
		params.content!.should.equal("see [a.md](http://a.md) for details")
		repairs.length.should.equal(1)
		repairs[0].param!.should.equal("path")
	})

	it("is a no-op (same reference) when nothing needs repair", () => {
		const input = { path: "src/index.ts", regex: "foo" }
		const { params, repairs } = repairToolParams(input)
		repairs.length.should.equal(0)
		params.should.equal(input)
	})
})

describe("ToolInputRepair — Domain B (MCP arguments JSON)", () => {
	it("passes valid JSON through (no repairs)", () => {
		const { repairs } = repairMcpArgumentsString('{"gauge_id":"01234"}')
		repairs.length.should.equal(0)
	})

	it("strips a ```json code fence", () => {
		const { value, repairs } = repairMcpArgumentsString('```json\n{"a":1}\n```')
		JSON.parse(value).should.deepEqual({ a: 1 })
		repairs.map((r) => r.kind).should.containEql("json_code_fence_strip")
	})

	it("strips explicit null for a non-required field", () => {
		const { value, repairs } = repairMcpArgumentsString('{"a":1,"b":null}')
		JSON.parse(value).should.deepEqual({ a: 1 })
		repairs.map((r) => r.kind).should.containEql("json_null_field_strip")
	})

	it("keeps null for a required field", () => {
		const schema = { properties: { b: { type: "string" } }, required: ["b"] }
		const { value } = repairMcpArgumentsString('{"b":null}', schema)
		JSON.parse(value).should.deepEqual({ b: null })
	})

	it("parses a stringified array", () => {
		const { value, repairs } = repairMcpArgumentsString('{"ids":"[\\"a\\",\\"b\\"]"}')
		JSON.parse(value).should.deepEqual({ ids: ["a", "b"] })
		repairs.map((r) => r.kind).should.containEql("json_stringified_array_parse")
	})

	it("wraps a bare string into an array when the schema expects array", () => {
		const schema = { properties: { ids: { type: "array" } } }
		const { value, repairs } = repairMcpArgumentsString('{"ids":"a"}', schema)
		JSON.parse(value).should.deepEqual({ ids: ["a"] })
		repairs.map((r) => r.kind).should.containEql("json_string_to_array")
	})

	it("unwraps a single wrapper-keyed object", () => {
		const { value, repairs } = repairMcpArgumentsString('{"input":{"gauge_id":"01"}}')
		JSON.parse(value).should.deepEqual({ gauge_id: "01" })
		repairs.map((r) => r.kind).should.containEql("json_single_arg_unwrap")
	})

	it("applies text fixes (trailing comma) only after strict parse fails", () => {
		const { value, repairs } = repairMcpArgumentsString('{"a":1,}')
		JSON.parse(value).should.deepEqual({ a: 1 })
		repairs.map((r) => r.kind).should.containEql("json_text_fix")
	})

	it("returns the raw string unchanged when unrepairable", () => {
		const raw = "this is not json at all {"
		const { value, repairs } = repairMcpArgumentsString(raw)
		value.should.equal(raw)
		repairs.length.should.equal(0)
	})
})
