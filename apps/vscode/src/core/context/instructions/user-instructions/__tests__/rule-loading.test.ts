import { describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getRuleFilesTotalContentWithMetadata, setRuleDisabledInFrontmatter } from "../rule-helpers"

describe("rule loading with paths frontmatter", () => {
	it("filters rules by evaluationContext.paths", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "universal.md"), "Always on")
			await fs.writeFile(path.join(rulesDir, "scoped.md"), `---\npaths:\n  - "src/**"\n---\n\nOnly for src`)

			const files = ["universal.md", "scoped.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "universal.md")]: true,
				[path.join(rulesDir, "scoped.md")]: true,
			}

			const res1 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})
			expect(res1.content).to.contain("universal.md")
			expect(res1.content).to.contain("scoped.md")
			expect(res1.content).to.not.contain("paths:")
			expect(res1.activatedConditionalRules.map((r) => r.name)).to.include("global:scoped.md")

			const res2 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["docs/readme.md"] },
			})
			expect(res2.content).to.contain("universal.md")
			expect(res2.content).to.not.contain("scoped.md")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("treats invalid YAML frontmatter as fail-open and preserves the raw frontmatter for the LLM", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			// Intentionally invalid YAML (unquoted '*' is a YAML alias indicator)
			await fs.writeFile(
				path.join(rulesDir, "invalid.md"),
				`---\npaths: *\n---\n\nInvalid YAML, but should still be included`,
			)

			const files = ["invalid.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "invalid.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			// Fail-open: included even though frontmatter cannot be parsed.
			expect(res.content).to.contain("invalid.md")
			// Preserve raw frontmatter fence/content for the LLM.
			expect(res.content).to.contain("---")
			expect(res.content).to.contain("paths:")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("treats paths: [] as match-nothing (fail-closed)", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "scoped-empty.md"), `---\npaths: []\n---\n\nShould never activate`)

			const files = ["scoped-empty.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "scoped-empty.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			expect(res.content).to.not.contain("scoped-empty.md")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("keeps activatedConditionalRules order stable (matches input file order)", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "a.md"), `---\npaths:\n  - "src/**"\n---\n\nA`)
			await fs.writeFile(path.join(rulesDir, "b.md"), `---\npaths:\n  - "src/**"\n---\n\nB`)
			await fs.writeFile(path.join(rulesDir, "c.md"), `---\npaths:\n  - "src/**"\n---\n\nC`)

			const files = ["a.md", "b.md", "c.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "a.md")]: true,
				[path.join(rulesDir, "b.md")]: true,
				[path.join(rulesDir, "c.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			expect(res.activatedConditionalRules.map((r) => r.name)).to.deep.equal(files.map((f) => `global:${f}`))
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})

// Regression tests for https://github.com/cline/cline/issues/13695: toggling a
// rule OFF must be persisted to the rule file's frontmatter, since the SDK
// builds the system prompt from files on disk and ignores extension toggle state.
describe("setRuleDisabledInFrontmatter", () => {
	it("writes disabled: true when disabling a plain markdown rule with no frontmatter", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulePath = path.join(tmp, "memory-bank.md")
			await fs.writeFile(rulePath, "Always remember the memory bank")

			const ok = await setRuleDisabledInFrontmatter(rulePath, false)

			expect(ok).to.be.true
			const written = await fs.readFile(rulePath, "utf8")
			expect(written).to.equal("---\ndisabled: true\n---\nAlways remember the memory bank")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("removes the disabled flag when re-enabling, restoring the original content", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulePath = path.join(tmp, "rule.md")
			await fs.writeFile(rulePath, "---\ndisabled: true\n---\nRule body")

			const ok = await setRuleDisabledInFrontmatter(rulePath, true)

			expect(ok).to.be.true
			expect(await fs.readFile(rulePath, "utf8")).to.equal("Rule body")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("supports the legacy single-file .clinerules", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulePath = path.join(tmp, ".clinerules")
			await fs.writeFile(rulePath, "Legacy rules")

			const ok = await setRuleDisabledInFrontmatter(rulePath, false)

			expect(ok).to.be.true
			expect(await fs.readFile(rulePath, "utf8")).to.contain("disabled: true")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("does not touch files the SDK does not load as rules", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulePath = path.join(tmp, "rules.json")
			await fs.writeFile(rulePath, `{"not": "markdown"}`)

			const ok = await setRuleDisabledInFrontmatter(rulePath, false)

			expect(ok).to.be.false
			expect(await fs.readFile(rulePath, "utf8")).to.equal(`{"not": "markdown"}`)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("returns false when the rule file does not exist", async () => {
		const ok = await setRuleDisabledInFrontmatter(path.join(os.tmpdir(), "does-not-exist.md"), false)
		expect(ok).to.be.false
	})
})
