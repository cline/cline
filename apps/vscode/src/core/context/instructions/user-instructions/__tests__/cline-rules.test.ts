import { afterEach, describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Controller } from "@/core/controller"
import {
	refreshClineRulesToggles,
	resolveWritableRuleFile,
	setRuleDisabledInFrontmatter,
	syncRuleTogglesFromFrontmatter,
} from "../cline-rules"
import { parseYamlFrontmatter, readSdkEnabledState } from "../frontmatter"

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

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal("written")
		const disabled = parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8"))
		expect(disabled.data.disabled).to.equal(true)
		expect(disabled.body).to.equal("Follow this rule")

		expect(await setRuleDisabledInFrontmatter(rulePath, true, [rulesDir])).to.equal("written")
		expect(await fs.readFile(rulePath, "utf-8")).to.equal("Follow this rule")
	})

	it("accepts the legacy single .clinerules file as its own root", async () => {
		const workspace = await makeTempDir()
		const rulePath = path.join(workspace, ".clinerules")
		await fs.writeFile(rulePath, "Single-file rules")

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulePath])).to.equal("written")
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).to.equal(true)
	})

	it("skips files the SDK loader does not read", async () => {
		const rulesDir = await makeTempDir()
		const jsonPath = path.join(rulesDir, "settings.json")
		await fs.writeFile(jsonPath, '{"a":1}')

		expect(await setRuleDisabledInFrontmatter(jsonPath, false, [rulesDir])).to.equal("skipped")
		expect(await fs.readFile(jsonPath, "utf-8")).to.equal('{"a":1}')
	})

	it("skips paths outside the allowed roots, including through symlinks", async () => {
		const rulesDir = await makeTempDir()
		const elsewhere = await makeTempDir()
		const targetPath = path.join(elsewhere, "not-a-rule.md")
		await fs.writeFile(targetPath, "Do not touch")
		const linkPath = path.join(rulesDir, "linked.md")
		await fs.symlink(targetPath, linkPath)

		expect(await setRuleDisabledInFrontmatter(targetPath, false, [rulesDir])).to.equal("skipped")
		expect(await setRuleDisabledInFrontmatter(linkPath, false, [rulesDir])).to.equal("skipped")
		expect(await resolveWritableRuleFile(linkPath, [rulesDir])).to.equal(null)
		expect(await fs.readFile(targetPath, "utf-8")).to.equal("Do not touch")
	})

	it("skips files nested below a rules root, which the SDK loader never reads", async () => {
		const rulesDir = await makeTempDir()
		const nestedPath = path.join(rulesDir, "nested", "deep.md")
		await fs.mkdir(path.dirname(nestedPath), { recursive: true })
		await fs.writeFile(nestedPath, "Nested")

		expect(await setRuleDisabledInFrontmatter(nestedPath, false, [rulesDir])).to.equal("skipped")
		expect(await fs.readFile(nestedPath, "utf-8")).to.equal("Nested")
	})

	it("reports a failure when the rule file cannot be written", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "read-only.md")
		await fs.writeFile(rulePath, "Locked rule")
		await fs.chmod(rulePath, 0o444)
		try {
			expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal("failed")
			expect(await fs.readFile(rulePath, "utf-8")).to.equal("Locked rule")
		} finally {
			await fs.chmod(rulePath, 0o644)
		}
	})

	it("reports a failure when malformed frontmatter prevents a safe edit", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "broken.md")
		const content = "---\npaths: [invalid\n---\nBody"
		await fs.writeFile(rulePath, content)

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal("failed")
		expect(await fs.readFile(rulePath, "utf-8")).to.equal(content)
	})

	it("reports success without writing when the file already carries the requested state", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "already-off.md")
		const content = "---\ndisabled: true\n---\nBody"
		await fs.writeFile(rulePath, content)
		const before = (await fs.stat(rulePath)).mtimeMs

		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal("written")
		expect((await fs.stat(rulePath)).mtimeMs).to.equal(before)
	})

	it("rejects relative and missing paths", async () => {
		const rulesDir = await makeTempDir()
		expect(await setRuleDisabledInFrontmatter("relative.md", false, [rulesDir])).to.equal("skipped")
		expect(await setRuleDisabledInFrontmatter(path.join(rulesDir, "missing.md"), false, [rulesDir])).to.equal("skipped")
	})
})

describe("syncRuleTogglesFromFrontmatter", () => {
	it("shows a toggle saved before the fix as on and leaves its file untouched", async () => {
		const rulesDir = await makeTempDir()
		const offPath = path.join(rulesDir, "off.md")
		const onPath = path.join(rulesDir, "on.md")
		await fs.writeFile(offPath, "Was toggled off in state only")
		await fs.writeFile(onPath, "Still on")

		const toggles = await syncRuleTogglesFromFrontmatter({ [offPath]: false, [onPath]: true }, [rulesDir])

		expect(toggles).to.deep.equal({ [offPath]: true, [onPath]: true })
		expect(await fs.readFile(offPath, "utf-8")).to.equal("Was toggled off in state only")
	})

	it("shows a rule as off when its frontmatter disables it", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "hand-edited.md")
		const content = "---\ndisabled: true\n---\nDisabled by hand"
		await fs.writeFile(rulePath, content)

		const toggles = await syncRuleTogglesFromFrontmatter({ [rulePath]: true }, [rulesDir])

		expect(toggles[rulePath]).to.equal(false)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal(content)
	})

	it("matches the SDK precedence: disabled: false beats enabled: false", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "both-flags.md")
		await fs.writeFile(rulePath, "---\ndisabled: false\nenabled: false\n---\nInjected by the SDK")

		const toggles = await syncRuleTogglesFromFrontmatter({ [rulePath]: false }, [rulesDir])

		expect(toggles[rulePath]).to.equal(true)
	})

	it("shows a rule the SDK cannot load as off, whatever the stored toggle says", async () => {
		const rulesDir = await makeTempDir()
		const malformed = path.join(rulesDir, "malformed.md")
		const emptyBody = path.join(rulesDir, "empty-body.md")
		const nonBoolean = path.join(rulesDir, "non-boolean.md")
		await fs.writeFile(malformed, "---\npaths: [invalid\n---\nBody")
		await fs.writeFile(emptyBody, "---\nname: x\n---\n")
		await fs.writeFile(nonBoolean, "---\ndisabled: [true]\n---\nBody")

		const toggles = await syncRuleTogglesFromFrontmatter({ [malformed]: true, [emptyBody]: true, [nonBoolean]: true }, [
			rulesDir,
		])

		expect(toggles).to.deep.equal({ [malformed]: false, [emptyBody]: false, [nonBoolean]: false })
	})

	it("shows a rule with non-mapping frontmatter as on, since the SDK loads it", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "divider.md")
		await fs.writeFile(rulePath, "---\nJust a divider line\n---\nBody")

		const toggles = await syncRuleTogglesFromFrontmatter({ [rulePath]: false }, [rulesDir])

		expect(toggles[rulePath]).to.equal(true)
		expect(await setRuleDisabledInFrontmatter(rulePath, false, [rulesDir])).to.equal("written")
		expect(readSdkEnabledState(await fs.readFile(rulePath, "utf-8"))).to.equal(false)
	})

	it("keeps the stored toggle for files it cannot read as rules", async () => {
		const rulesDir = await makeTempDir()
		const elsewhere = await makeTempDir()
		const outside = path.join(elsewhere, "outside.md")
		const json = path.join(rulesDir, "data.json")
		const broken = path.join(rulesDir, "broken.md")
		await fs.writeFile(outside, "Outside")
		await fs.writeFile(json, "{}")
		await fs.writeFile(broken, "---\npaths: [invalid\n---\nBody")

		const toggles = await syncRuleTogglesFromFrontmatter({ [outside]: false, [json]: false, [broken]: false }, [rulesDir])

		expect(toggles).to.deep.equal({ [outside]: false, [json]: false, [broken]: false })
	})
})

describe("refreshClineRulesToggles", () => {
	it("derives workspace toggles from the rule files", async () => {
		const workspace = await makeTempDir()
		const offPath = path.join(workspace, ".clinerules", "off.md")
		const stalePath = path.join(workspace, ".clinerules", "stale.md")
		await fs.mkdir(path.dirname(offPath), { recursive: true })
		await fs.writeFile(offPath, "---\ndisabled: true\n---\nOff")
		await fs.writeFile(stalePath, "Toggled off before the fix")
		const workspaceState = new Map<string, unknown>([["localClineRulesToggles", { [stalePath]: false }]])
		const controller = {
			stateManager: {
				getGlobalSettingsKey: () => ({}),
				getWorkspaceStateKey: (key: string) => workspaceState.get(key) ?? {},
				setGlobalState: () => undefined,
				setWorkspaceState: (key: string, value: unknown) => workspaceState.set(key, value),
			},
		} as unknown as Controller

		const { localToggles } = await refreshClineRulesToggles(controller, workspace)

		expect(localToggles).to.deep.equal({ [offPath]: false, [stalePath]: true })
		expect(await fs.readFile(stalePath, "utf-8")).to.equal("Toggled off before the fix")
	})
})
