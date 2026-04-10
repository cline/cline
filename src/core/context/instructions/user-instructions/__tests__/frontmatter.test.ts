import { expect } from "chai"
import { parseYamlFrontmatter } from "../frontmatter"

describe("parseYamlFrontmatter", () => {
	it("returns original content when no frontmatter", () => {
		const input = "Just text"
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(false)
		expect(result.data).to.deep.equal({})
		expect(result.body).to.equal(input)
	})

	it("parses valid YAML frontmatter", () => {
		const input = `---\npaths:\n  - "src/**"\n---\n\nHello`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.parseError).to.equal(undefined)
		expect(result.data).to.deep.equal({ paths: ["src/**"] })
		expect(result.body.trim()).to.equal("Hello")
	})

	it("fails open on malformed YAML", () => {
		const input = `---\npaths: [invalid\n---\nBody`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.data).to.deep.equal({})
		expect(result.body).to.equal(input)
		expect(result.parseError).to.be.a("string")
	})

	it("rejects YAML custom tags (security: prevents unsafe deserialization)", () => {
		// !!js/function is the classic RCE vector in js-yaml v3.
		// With JSON_SCHEMA, any custom tag should be rejected.
		const input = `---\nfoo: !!js/function 'function(){ return 1 }'\n---\nBody`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.data).to.deep.equal({})
		expect(result.body).to.equal(input)
		expect(result.parseError).to.be.a("string")
	})

	it("rejects !!python/object YAML tag", () => {
		const input = `---\nfoo: !!python/object:os.system 'echo pwned'\n---\nBody`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.data).to.deep.equal({})
		expect(result.parseError).to.be.a("string")
	})

	it("parses JSON-compatible YAML values correctly", () => {
		const input = `---\ncount: 42\nenabled: true\ntags:\n  - "a"\n  - "b"\n---\nContent`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.parseError).to.equal(undefined)
		expect(result.data).to.deep.equal({ count: 42, enabled: true, tags: ["a", "b"] })
		expect(result.body.trim()).to.equal("Content")
	})
})
