import { describe, it } from "bun:test"
import { expect } from "chai"
import { parseDocument } from "yaml"
import {
	isFrontmatterDisabled,
	parseYamlFrontmatter,
	readSdkEnabledState,
	updateUserInstructionMarkdownDisabledState,
} from "../frontmatter"

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

const lines = (...parts: string[]) => parts.join("\n")

/** Every top-level value except the enablement flags, as the SDK parser reads it. */
function otherValues(content: string): Record<string, unknown> {
	const block = content.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ""
	const data = (parseDocument(block).toJS() ?? {}) as Record<string, unknown>
	const { disabled: _disabled, enabled: _enabled, ...rest } = data
	return rest
}

function bodyOf(content: string): string {
	return parseYamlFrontmatter(content).body
}

describe("updateUserInstructionMarkdownDisabledState preserves authored frontmatter", () => {
	it("keeps comments, key order, and quoting when disabling", () => {
		const input = lines("---", "# scope this rule", "paths:", "  - 'src/**'", 'name: "My rule"', "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, false)).to.equal(
			lines("---", "# scope this rule", "paths:", "  - 'src/**'", 'name: "My rule"', "disabled: true", "---", "Body"),
		)
	})

	it("sets an existing disabled value in place, keeping its comment", () => {
		const input = lines("---", "disabled: false # important explanation", "paths:", "  - src/**", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, false)).to.equal(
			lines("---", "disabled: true # important explanation", "paths:", "  - src/**", "---", "Body"),
		)
	})

	it("keeps a commented disabled entry on re-enable and only flips its value", () => {
		const input = lines("---", "disabled: true # important explanation", "paths:", "  - src/**", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
			lines("---", "disabled: false # important explanation", "paths:", "  - src/**", "---", "Body"),
		)
	})

	it("keeps a comment placed before a split value", () => {
		const input = lines("---", "disabled:", "  # why this is off", "  true", "name: x", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
			lines("---", "disabled:", "  # why this is off", "  false", "name: x", "---", "Body"),
		)
	})

	it("keeps an indented comment that follows an inline disabled value", () => {
		const input = lines("---", "disabled: true", "  # keep this note", "paths:", "  - src/**", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
			lines("---", "disabled: false", "  # keep this note", "paths:", "  - src/**", "---", "Body"),
		)
	})

	it("removes uncommented disabled and enabled: false entries when re-enabling", () => {
		const input = lines("---", "# keep me", "enabled: false", "paths:", "  - src/**", "disabled: true", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
			lines("---", "# keep me", "paths:", "  - src/**", "---", "Body"),
		)
	})

	it("removes a legacy enabled: false whose value is on the next line", () => {
		const input = lines("---", "disabled: true", "enabled:", "  false", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal("Body")
	})

	it("leaves matching text inside other values untouched", () => {
		const input = lines("---", 'description: "first', "  disabled: true", '  last"', "disabled: true", "---", "Body")
		const output = updateUserInstructionMarkdownDisabledState(input, true)
		expect(output).to.equal(lines("---", 'description: "first', "  disabled: true", '  last"', "---", "Body"))
		expect(otherValues(output)).to.deep.equal(otherValues(input))
	})

	it("refuses frontmatter the SDK parser rejects instead of editing it", () => {
		const input = lines("---", 'description: "first', "disabled: true", 'last"', "disabled: true", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(input)
		const duplicate = lines("---", "disabled: true", "disabled: false", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(duplicate, true)).to.equal(duplicate)
	})

	it("refuses a non-boolean flag, which makes the SDK reject the file", () => {
		const flow = lines("---", "disabled: [", "  true,", "]", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(flow, false)).to.equal(flow)
		expect(updateUserInstructionMarkdownDisabledState(flow, true)).to.equal(flow)
		const block = lines("---", "disabled: |", "  multi", "  line", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(block, false)).to.equal(block)
	})

	it("does not touch a nested disabled key", () => {
		const input = lines("---", "meta:", "  disabled: true", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(input, false)).to.equal(
			lines("---", "meta:", "  disabled: true", "disabled: true", "---", "Body"),
		)
	})

	it("recognizes quoted keys and uppercase booleans", () => {
		expect(updateUserInstructionMarkdownDisabledState(lines("---", '"disabled": true', "---", "Body"), true)).to.equal("Body")
		expect(
			updateUserInstructionMarkdownDisabledState(lines("---", "'disabled': false", "name: x", "---", "Body"), false),
		).to.equal(lines("---", "'disabled': true", "name: x", "---", "Body"))
		for (const spelling of ["False", "FALSE"]) {
			const input = lines("---", `enabled: ${spelling}`, "paths:", "  - src/**", "---", "Body")
			expect(updateUserInstructionMarkdownDisabledState(input, true)).to.equal(
				lines("---", "paths:", "  - src/**", "---", "Body"),
			)
		}
	})

	it("preserves CRLF line endings", () => {
		const input = "---\r\npaths:\r\n  - src/**\r\n---\r\nBody\r\n"
		const disabled = updateUserInstructionMarkdownDisabledState(input, false)
		expect(disabled).to.equal("---\r\npaths:\r\n  - src/**\r\ndisabled: true\r\n---\r\nBody\r\n")
		expect(updateUserInstructionMarkdownDisabledState(disabled, true)).to.equal(input)
		expect(updateUserInstructionMarkdownDisabledState("Body\r\n", false)).to.equal("---\r\ndisabled: true\r\n---\r\nBody\r\n")
	})

	it("preserves a UTF-8 BOM", () => {
		const input = "\uFEFFFollow this rule"
		const disabled = updateUserInstructionMarkdownDisabledState(input, false)
		expect(disabled).to.equal("\uFEFF---\ndisabled: true\n---\nFollow this rule")
		expect(updateUserInstructionMarkdownDisabledState(disabled, true)).to.equal(input)
	})

	it("is a no-op when the document already has the requested state", () => {
		const disabled = lines("---", "disabled: true", "---", "Body")
		expect(updateUserInstructionMarkdownDisabledState(disabled, false)).to.equal(disabled)
		expect(updateUserInstructionMarkdownDisabledState("Body", true)).to.equal("Body")
	})

	it("never changes another value or the body, in either direction", () => {
		const inputs = [
			lines(
				"---",
				"name: n",
				"description: |",
				"  disabled: true",
				"  enabled: false",
				"paths:",
				"  - src/**",
				"---",
				"Body",
			),
			lines("---", "# c", "disabled: false # keep", "tags: [a, b]", "---", "Body", "disabled: true"),
			lines("---", 'title: "x: y"', "enabled:", "  # legacy", "  false", "---", "", "Body"),
		]
		for (const input of inputs) {
			for (const enabled of [true, false]) {
				const output = updateUserInstructionMarkdownDisabledState(input, enabled)
				expect(otherValues(output), input).to.deep.equal(otherValues(input))
				expect(bodyOf(output), input).to.equal(bodyOf(input))
				expect(readSdkEnabledState(output), input).to.equal(enabled)
			}
		}
	})
})

describe("isFrontmatterDisabled", () => {
	it("uses the SDK precedence: a boolean disabled wins over enabled", () => {
		expect(isFrontmatterDisabled({ disabled: true })).to.equal(true)
		expect(isFrontmatterDisabled({ enabled: false })).to.equal(true)
		expect(isFrontmatterDisabled({ disabled: false, enabled: false })).to.equal(false)
		expect(isFrontmatterDisabled({ disabled: true, enabled: true })).to.equal(true)
		expect(isFrontmatterDisabled({})).to.equal(false)
	})
})
