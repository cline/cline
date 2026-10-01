import { afterEach, describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import {
	readGlobalRuleAuthority,
	reconcileRuleTogglesWithFrontmatter,
	recordGlobalRuleAuthority,
	refreshClineRulesToggles,
	resolveWritableRuleFile,
	setRuleDisabledInFrontmatter,
} from "../cline-rules"
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

describe("reconcileRuleTogglesWithFrontmatter", () => {
	it("writes disabled frontmatter for toggles that were persisted before the file was synced", async () => {
		const rulesDir = await makeTempDir()
		const offPath = path.join(rulesDir, "off.md")
		const onPath = path.join(rulesDir, "on.md")
		await fs.writeFile(offPath, "Was toggled off in state only")
		await fs.writeFile(onPath, "Still on")

		const { toggles, authoritative } = await reconcileRuleTogglesWithFrontmatter({ [offPath]: false, [onPath]: true }, [
			rulesDir,
		])

		expect(toggles).to.deep.equal({ [offPath]: false, [onPath]: true })
		expect(authoritative).to.deep.equal({ [offPath]: true, [onPath]: true })
		expect(parseYamlFrontmatter(await fs.readFile(offPath, "utf-8")).data.disabled).to.equal(true)
		expect(await fs.readFile(onPath, "utf-8")).to.equal("Still on")
	})

	it("lets frontmatter that disables a rule win over a stale enabled toggle", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "hand-edited.md")
		const content = "---\ndisabled: true\n---\nDisabled by hand"
		await fs.writeFile(rulePath, content)

		const { toggles } = await reconcileRuleTogglesWithFrontmatter({ [rulePath]: true }, [rulesDir])

		expect(toggles[rulePath]).to.equal(false)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal(content)
	})

	it("follows the file when a user re-enables a rule by removing disabled from it", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "hand-enabled.md")
		await fs.writeFile(rulePath, "Re-enabled by hand")

		const { toggles } = await reconcileRuleTogglesWithFrontmatter({ [rulePath]: false }, [rulesDir], { [rulePath]: true })

		expect(toggles[rulePath]).to.equal(true)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal("Re-enabled by hand")
	})

	it("matches the SDK precedence: disabled: false beats enabled: false", async () => {
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "both-flags.md")
		await fs.writeFile(rulePath, "---\ndisabled: false\nenabled: false\n---\nInjected by the SDK")

		const { toggles } = await reconcileRuleTogglesWithFrontmatter({ [rulePath]: false }, [rulesDir], { [rulePath]: true })

		expect(toggles[rulePath]).to.equal(true)
	})

	it("ignores files outside the allowed roots and non-rule files", async () => {
		const rulesDir = await makeTempDir()
		const elsewhere = await makeTempDir()
		const outside = path.join(elsewhere, "outside.md")
		const json = path.join(rulesDir, "data.json")
		await fs.writeFile(outside, "Outside")
		await fs.writeFile(json, "{}")

		const { toggles } = await reconcileRuleTogglesWithFrontmatter({ [outside]: false, [json]: false }, [rulesDir])

		expect(toggles).to.deep.equal({ [outside]: false, [json]: false })
		expect(await fs.readFile(outside, "utf-8")).to.equal("Outside")
		expect(await fs.readFile(json, "utf-8")).to.equal("{}")
	})
})

describe("refreshClineRulesToggles back-fill", () => {
	function makeController(localToggles: Record<string, boolean>, localAuthoritative: Record<string, boolean> = {}) {
		const globalState = new Map<string, unknown>([["globalClineRulesToggles", {}]])
		const workspaceState = new Map<string, unknown>([
			["localClineRulesToggles", localToggles],
			["localClineRulesFrontmatterAuthoritative", localAuthoritative],
		])
		return {
			controller: {
				stateManager: {
					getGlobalSettingsKey: (key: string) => globalState.get(key) ?? {},
					getGlobalStateKey: (key: string) => globalState.get(key) ?? {},
					getWorkspaceStateKey: (key: string) => workspaceState.get(key) ?? {},
					setGlobalState: (key: string, value: unknown) => globalState.set(key, value),
					setWorkspaceState: (key: string, value: unknown) => workspaceState.set(key, value),
				},
			} as unknown as Controller,
			workspaceState,
		}
	}

	async function makeRule(workspace: string, name: string, content: string): Promise<string> {
		const rulePath = path.join(workspace, ".clinerules", name)
		await fs.mkdir(path.dirname(rulePath), { recursive: true })
		await fs.writeFile(rulePath, content)
		return rulePath
	}

	it("writes pre-existing off toggles into the files once, then lets the files win", async () => {
		const workspace = await makeTempDir()
		const rulePath = await makeRule(workspace, "old-toggle.md", "Toggled off before the fix")

		const first = makeController({ [rulePath]: false })
		const firstResult = await refreshClineRulesToggles(first.controller, workspace)
		expect(firstResult.localToggles[rulePath]).to.equal(false)
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).to.equal(true)
		const authoritative = first.workspaceState.get("localClineRulesFrontmatterAuthoritative") as Record<string, boolean>
		expect(authoritative).to.deep.equal({ [rulePath]: true })

		// The user re-enables the rule by editing the file: no back-fill any more.
		await fs.writeFile(rulePath, "Re-enabled by hand")
		const second = makeController({ [rulePath]: false }, authoritative)
		const secondResult = await refreshClineRulesToggles(second.controller, workspace)
		expect(secondResult.localToggles[rulePath]).to.equal(true)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal("Re-enabled by hand")
	})

	it("retries only the rule whose back-fill failed, leaving a rule re-enabled by hand alone", async () => {
		const workspace = await makeTempDir()
		const lockedPath = await makeRule(workspace, "locked.md", "Locked during the upgrade")
		const editedPath = await makeRule(workspace, "edited.md", "Will be re-enabled by hand")
		await fs.chmod(lockedPath, 0o444)

		let authoritative: Record<string, boolean>
		try {
			const first = makeController({ [lockedPath]: false, [editedPath]: false })
			const firstResult = await refreshClineRulesToggles(first.controller, workspace)
			expect(firstResult.localToggles).to.deep.equal({ [lockedPath]: false, [editedPath]: false })
			authoritative = first.workspaceState.get("localClineRulesFrontmatterAuthoritative") as Record<string, boolean>
			expect(authoritative).to.deep.equal({ [editedPath]: true })
		} finally {
			await fs.chmod(lockedPath, 0o644)
		}

		await fs.writeFile(editedPath, "Will be re-enabled by hand")
		const second = makeController({ [lockedPath]: false, [editedPath]: false }, authoritative)
		const secondResult = await refreshClineRulesToggles(second.controller, workspace)

		expect(secondResult.localToggles).to.deep.equal({ [lockedPath]: false, [editedPath]: true })
		expect(parseYamlFrontmatter(await fs.readFile(lockedPath, "utf-8")).data.disabled).to.equal(true)
		expect(await fs.readFile(editedPath, "utf-8")).to.equal("Will be re-enabled by hand")
		expect(second.workspaceState.get("localClineRulesFrontmatterAuthoritative")).to.deep.equal({
			[lockedPath]: true,
			[editedPath]: true,
		})
	})

	it("drops rules that no longer exist from the authoritative set", async () => {
		const workspace = await makeTempDir()
		const rulePath = await makeRule(workspace, "kept.md", "Kept")
		const gonePath = path.join(workspace, ".clinerules", "gone.md")

		const { controller, workspaceState } = makeController({ [rulePath]: true }, { [rulePath]: true, [gonePath]: true })
		await refreshClineRulesToggles(controller, workspace)

		expect(workspaceState.get("localClineRulesFrontmatterAuthoritative")).to.deep.equal({ [rulePath]: true })
	})
})

describe("global rule authority file", () => {
	let globalStorage: string

	afterEach(() => {
		HostProvider.reset()
	})

	async function useGlobalStorage(): Promise<void> {
		globalStorage = await makeTempDir()
		setVscodeHostProviderMock({ globalStorageFsPath: globalStorage })
	}

	it("merges records from separate windows instead of overwriting them", async () => {
		await useGlobalStorage()
		const rulesDir = await makeTempDir()
		const first = path.join(rulesDir, "first.md")
		const second = path.join(rulesDir, "second.md")
		await fs.writeFile(first, "First")
		await fs.writeFile(second, "Second")

		await recordGlobalRuleAuthority([first])
		await recordGlobalRuleAuthority([second])

		expect(await readGlobalRuleAuthority()).to.deep.equal({ [first]: true, [second]: true })
	})

	it("drops records whose rule file no longer exists", async () => {
		await useGlobalStorage()
		const rulesDir = await makeTempDir()
		const kept = path.join(rulesDir, "kept.md")
		const gone = path.join(rulesDir, "gone.md")
		await fs.writeFile(kept, "Kept")
		await fs.writeFile(gone, "Gone")
		await recordGlobalRuleAuthority([kept, gone])

		await fs.rm(gone)
		await recordGlobalRuleAuthority([])

		expect(await readGlobalRuleAuthority()).to.deep.equal({ [kept]: true })
	})

	it("treats a missing or corrupt file as no records", async () => {
		await useGlobalStorage()
		expect(await readGlobalRuleAuthority()).to.deep.equal({})
		await fs.mkdir(path.join(globalStorage, "settings"), { recursive: true })
		await fs.writeFile(path.join(globalStorage, "settings", "cline-rules-frontmatter-authority.json"), "{not json")
		expect(await readGlobalRuleAuthority()).to.deep.equal({})
	})

	it("keeps a stale window from re-disabling a global rule the user re-enabled by hand", async () => {
		await useGlobalStorage()
		const rulesDir = await makeTempDir()
		const rulePath = path.join(rulesDir, "global-rule.md")
		await fs.writeFile(rulePath, "Toggled off before the fix")

		// Window A back-fills the rule and records it.
		const windowA = await reconcileRuleTogglesWithFrontmatter(
			{ [rulePath]: false },
			[rulesDir],
			await readGlobalRuleAuthority(),
		)
		await recordGlobalRuleAuthority(Object.keys(windowA.authoritative))
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).to.equal(true)

		// The user re-enables the rule by editing the file.
		await fs.writeFile(rulePath, "Re-enabled by hand")

		// Window B still has the old off toggle cached, but reads the records from disk.
		const windowB = await reconcileRuleTogglesWithFrontmatter(
			{ [rulePath]: false },
			[rulesDir],
			await readGlobalRuleAuthority(),
		)

		expect(windowB.toggles[rulePath]).to.equal(true)
		expect(await fs.readFile(rulePath, "utf-8")).to.equal("Re-enabled by hand")
	})
})
