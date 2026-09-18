import { describe, it } from "bun:test"
import { expect } from "chai"
import { parseYamlFrontmatter, updateUserInstructionMarkdownDisabledState } from "../frontmatter"

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

describe("updateUserInstructionMarkdownDisabledState", () => {
	it("adds disabled frontmatter when a rule is toggled off", () => {
		const output = updateUserInstructionMarkdownDisabledState("Follow this rule", false)
		expect(output).to.equal("---\ndisabled: true\n---\nFollow this rule")
	})

	it("preserves existing frontmatter fields when disabling", () => {
		const input = ["---", "paths:", "  - src/**", "---", "Scoped rule"].join("\n")
		const output = updateUserInstructionMarkdownDisabledState(input, false)
		expect(output).to.contain("disabled: true")
		expect(output).to.contain("paths:")
		expect(output).to.contain("Scoped rule")
	})

	it("removes disabled frontmatter when a rule is toggled back on", () => {
		const input = ["---", "disabled: true", "---", "Follow this rule"].join("\n")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal("Follow this rule")
	})

	it("leaves malformed frontmatter untouched", () => {
		const input = ["---", "paths: [invalid", "---", "Rule body"].join("\n")
		expect(updateUserInstructionMarkdownDisabledState(input, false)).to.equal(input)
	})
})

describe("updateUserInstructionMarkdownDisabledState preserves authored frontmatter", () => {
	it("keeps comments, key order, and quoting when disabling", () => {
		const input = ["---", "# scope this rule", "paths:", "  - 'src/**'", 'name: "My rule"', "---", "Body"].join("\n")
		const output = updateUserInstructionMarkdownDisabledState(input, false)
		expect(output).to.equal(
			["---", "# scope this rule", "paths:", "  - 'src/**'", 'name: "My rule"', "disabled: true", "---", "Body"].join("\n"),
		)
	})

	it("replaces an existing top-level disabled line instead of duplicating it", () => {
		const input = ["---", "disabled: false # toggled", "paths:", "  - src/**", "---", "Body"].join("\n")
		const output = updateUserInstructionMarkdownDisabledState(input, false)
		expect(output).to.equal(["---", "disabled: true", "paths:", "  - src/**", "---", "Body"].join("\n"))
	})

	it("removes only the disabled and enabled:false lines when re-enabling", () => {
		const input = ["---", "# keep me", "enabled: false", "paths:", "  - src/**", "disabled: true", "---", "Body"].join("\n")
		const output = updateUserInstructionMarkdownDisabledState(input, true)
		expect(output).to.equal(["---", "# keep me", "paths:", "  - src/**", "---", "Body"].join("\n"))
	})

	it("does not touch a nested disabled key", () => {
		const input = ["---", "meta:", "  disabled: true", "---", "Body"].join("\n")
		const output = updateUserInstructionMarkdownDisabledState(input, false)
		expect(output).to.equal(["---", "meta:", "  disabled: true", "disabled: true", "---", "Body"].join("\n"))
		expect(parseYamlFrontmatter(output).data.disabled).to.equal(true)
	})

	it("preserves CRLF line endings", () => {
		const input = "---\r\npaths:\r\n  - src/**\r\n---\r\nBody\r\n"
		const output = updateUserInstructionMarkdownDisabledState(input, false)
		expect(output).to.equal("---\r\npaths:\r\n  - src/**\r\ndisabled: true\r\n---\r\nBody\r\n")
		expect(updateUserInstructionMarkdownDisabledState("Body\r\n", false)).to.equal("---\r\ndisabled: true\r\n---\r\nBody\r\n")
	})

	it("preserves a UTF-8 BOM", () => {
		const input = "﻿Follow this rule"
		const disabled = updateUserInstructionMarkdownDisabledState(input, false)
		expect(disabled).to.equal("﻿---\ndisabled: true\n---\nFollow this rule")
		expect(updateUserInstructionMarkdownDisabledState(disabled, true)).to.equal(input)
	})

	it("is a no-op when the document already has the requested state", () => {
		const disabled = ["---", "disabled: true", "---", "Body"].join("\n")
		expect(updateUserInstructionMarkdownDisabledState(disabled, false)).to.equal(disabled)
		expect(updateUserInstructionMarkdownDisabledState("Body", true)).to.equal("Body")
	})

	it("replaces a multi-line disabled value together with its continuation lines", () => {
		const input = ["---", "disabled: |", "  multi", "  line", "paths:", "  - src/**", "---", "Body"].join("\n")
		expect(updateUserInstructionMarkdownDisabledState(input, false)).to.equal(
			["---", "disabled: true", "paths:", "  - src/**", "---", "Body"].join("\n"),
		)
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
			["---", "paths:", "  - src/**", "---", "Body"].join("\n"),
		)
	})
})
