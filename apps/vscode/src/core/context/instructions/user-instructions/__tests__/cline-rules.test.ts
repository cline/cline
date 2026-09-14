import { afterEach, describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { reconcileRuleTogglesWithFrontmatter, resolveWritableRuleFile, setRuleDisabledInFrontmatter } from "../cline-rules"
import { parseYamlFrontmatter } from "../frontmatter"

const temporaryDirectories: string[] = []

async function makeTempDir(): Promise<string> {
	// realpath: on macOS os.tmpdir() is itself a symlink (/var -> /private/var).
	const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-write-test-")))
	temporaryDirectories.push(dir)
	return dir
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("setRuleDisabledInFrontmatter", () => {
	it("round-trips a rule document inside an allowed root", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "project-rule.md")
		await fs.writeFile(rulePath, "Follow this rule")

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal(true)
		const disabled = parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8"))
		expect(disabled.data.disabled).to.equal(true)
		expect(disabled.body).to.equal("Follow this rule")

		expect(await setRuleDisabledInFrontmatter(rulePath, true, [rulesDir])).to.equal(true)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal("Follow this rule")
	})

	it("accepts the legacy single .clinerules file as its own root", async () => {
		const workspace = await makeTempDir()
		const rulePath = path.join(workspace, ".clinerules")
		await fs.writeFile(rulePath, "Single-file rules")

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulePath])).to.equal(true)
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).to.equal(true)
	})

	it("skips files the SDK loader does not read", async () => {
		const rulesDir = await makeTempDir()
		const jsonPath = path.join(rulesDir, "settings.json")
		await fs.writeFile(jsonPath, '{"a":1}')

		expect(await setRuleDisabledInFrontmatter(jsonPath, false, [rulesDir])).to.equal(false)
		expect(await fs.readFile(jsonPath, "utf-8")).to.equal('{"a":1}')
	})

	it("skips paths outside the allowed roots, including through symlinks", async () => {
		const rulesDir = await makeTempDir()
		const elsewhere = await makeTempDir()
		const targetPath = path.join(elsewhere, "not-a-rule.md")
		await fs.writeFile(targetPath, "Do not touch")
		const linkPath = path.join(rulesDir, "linked.md")
		await fs.symlink(targetPath, linkPath)

		expect(await setRuleDisabledInFrontmatter(targetPath, false, [rulesDir])).to.equal(false)
		expect(await setRuleDisabledInFrontmatter(linkPath, false, [rulesDir])).to.equal(false)
		expect(await resolveWritableRuleFile(linkPath, [rulesDir])).to.equal(null)
		expect(await fs.readFile(targetPath, "utf-8")).to.equal("Do not touch")
	})

	it("rejects relative and missing paths", async () => {
		const rulesDir = await makeTempDir()
		expect(await setRuleDisabledInFrontmatter("relative.md", false, [rulesDir])).to.equal(false)
		expect(await setRuleDisabledInFrontmatter(path.join(rulesDir, "missing.md"), false, [rulesDir])).to.equal(false)
	})
})

describe("reconcileRuleTogglesWithFrontmatter", () => {
	it("writes disabled frontmatter for toggles that were persisted before the file was synced", async () => {
		const rulesDir = await makeTempDir()
		const offPath = path.join(rulesDir, "off.md")
		const onPath = path.join(rulesDir, "on.md")
		await fs.writeFile(offPath, "Was toggled off in state only")
		await fs.writeFile(onPath, "Still on")

		const toggles = await reconcileRuleTogglesWithFrontmatter({ [offPath]: false, [onPath]: true }, [rulesDir])

		expect(toggles).to.deep.equal({ [offPath]: false, [onPath]: true })
		expect(parseYamlFrontmatter(await fs.readFile(offPath, "utf-8")).data.disabled).to.equal(true)
		expect(await fs.readFile(onPath, "utf-8")).to.equal("Still on")
	})

	it("lets frontmatter that disables a rule win over a stale enabled toggle", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "hand-edited.md")
		const content = "---\ndisabled: true\n---\nDisabled by hand"
		await fs.writeFile(rulePath, content)

		const toggles = await reconcileRuleTogglesWithFrontmatter({ [rulePath]: true }, [rulesDir])

		expect(toggles[rulePath]).to.equal(false)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal(content)
	})

	it("ignores files outside the allowed roots and non-rule files", async () => {
		const rulesDir = await makeTempDir()
		const elsewhere = await makeTempDir()
		const outside = path.join(elsewhere, "outside.md")
		const json = path.join(rulesDir, "data.json")
		await fs.writeFile(outside, "Outside")
		await fs.writeFile(json, "{}")

		const toggles = await reconcileRuleTogglesWithFrontmatter({ [outside]: false, [json]: false }, [rulesDir])

		expect(toggles).to.deep.equal({ [outside]: false, [json]: false })
		expect(await fs.readFile(outside, "utf-8")).to.equal("Outside")
		expect(await fs.readFile(json, "utf-8")).to.equal("{}")
	})
})
