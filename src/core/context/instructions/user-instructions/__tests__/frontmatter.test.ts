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
})
