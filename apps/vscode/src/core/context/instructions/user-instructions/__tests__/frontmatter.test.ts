import { describe, it } from "bun:test"
import { expect } from "chai"
import { parseYamlFrontmatter, updateMarkdownDisabledState } from "../frontmatter"

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

	// Regression test for https://github.com/cline/cline/issues/12151
	// A leading UTF-8 BOM (e.g. saved by Windows Notepad's "UTF-8 with BOM" encoding) must not
	// prevent frontmatter from being recognized.
	it("parses frontmatter correctly when the content has a leading UTF-8 BOM", () => {
		const input = `\uFEFF---\nname: my-skill\ndescription: A test skill\n---\n# my-skill\nThis is a test skill.`
		const result = parseYamlFrontmatter(input)
		expect(result.hadFrontmatter).to.equal(true)
		expect(result.parseError).to.equal(undefined)
		expect(result.data).to.deep.equal({ name: "my-skill", description: "A test skill" })
		expect(result.body.trim()).to.equal("# my-skill\nThis is a test skill.")
	})
})

describe("updateMarkdownDisabledState", () => {
	it("adds disabled: true when disabling a doc with existing frontmatter", () => {
		const input = ["---", "name: my-skill", "description: A skill", "---", "Body here"].join("\n")
		const output = updateMarkdownDisabledState(input, false)
		expect(output).to.contain("disabled: true")
		expect(output).to.contain("name: my-skill")
		expect(output).to.contain("Body here")
	})

	it("adds a frontmatter block when disabling a doc that has none", () => {
		const input = "Just body, no frontmatter"
		const output = updateMarkdownDisabledState(input, false)
		expect(output).to.equal("---\ndisabled: true\n---\nJust body, no frontmatter")
	})

	it("removes disabled flag when enabling a previously-disabled doc", () => {
		const input = ["---", "name: my-skill", "description: A skill", "disabled: true", "---", "Body"].join("\n")
		const output = updateMarkdownDisabledState(input, true)
		expect(output).to.not.contain("disabled")
		expect(output).to.contain("name: my-skill")
		expect(output).to.contain("Body")
	})

	it("also clears a stale enabled: false when enabling", () => {
		const input = ["---", "name: my-skill", "enabled: false", "---", "Body"].join("\n")
		const output = updateMarkdownDisabledState(input, true)
		expect(output).to.not.contain("enabled: false")
	})

	it("drops the frontmatter block entirely when enabling leaves it empty", () => {
		const input = ["---", "disabled: true", "---", "Body only"].join("\n")
		const output = updateMarkdownDisabledState(input, true)
		expect(output).to.equal("Body only")
	})

	it("returns content unchanged when enabling a doc with no frontmatter", () => {
		const input = "Just body, no frontmatter"
		expect(updateMarkdownDisabledState(input, true)).to.equal(input)
	})

	it("is idempotent: disabling an already-disabled doc keeps disabled: true once", () => {
		const input = ["---", "name: s", "disabled: true", "---", "B"].join("\n")
		const output = updateMarkdownDisabledState(input, false)
		expect(output.match(/disabled: true/g)).to.have.lengthOf(1)
	})

	// Frontmatter block whose YAML is genuinely invalid (asserted below). The
	// `---` markers are well-formed so parseYamlFrontmatter detects frontmatter
	// and then fails to parse it, exercising the parseError branch.
	const MALFORMED_FRONTMATTER = ["---", "name: s", "description: : : bad", "  - nope", "---", "Body"].join("\n")

	it("uses a fixture whose frontmatter YAML is actually invalid", () => {
		// Guards the two tests below from rotting into false positives: if this
		// fixture ever became valid YAML, updateMarkdownDisabledState would
		// take a different (rewriting) path and the "untouched" assertions could
		// pass for the wrong reason.
		const parsed = parseYamlFrontmatter(MALFORMED_FRONTMATTER)
		expect(parsed.hadFrontmatter).to.be.true
		expect(parsed.parseError, "fixture frontmatter should be invalid YAML").to.be.a("string")
	})

	it("leaves malformed-frontmatter files untouched when disabling (no double header)", () => {
		// parseYamlFrontmatter fails open and returns the full original document
		// as the body. Disabling must not prepend a second `---` block and corrupt
		// the file.
		const output = updateMarkdownDisabledState(MALFORMED_FRONTMATTER, false)
		expect(output).to.equal(MALFORMED_FRONTMATTER)
		// Exactly one frontmatter opener/closer pair, not two.
		expect(output.match(/^---$/gm)).to.have.lengthOf(2)
	})

	it("leaves malformed-frontmatter files untouched when enabling", () => {
		expect(updateMarkdownDisabledState(MALFORMED_FRONTMATTER, true)).to.equal(MALFORMED_FRONTMATTER)
	})
})
