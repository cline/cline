import { afterEach, beforeEach, describe, it } from "bun:test"
import { resolveRulesConfigSearchPaths } from "@cline/shared/storage"
import { ClineRulesToggles } from "@shared/cline-rules"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Controller } from "@/core/controller"
import { localClineRulesScanDirectories, refreshLocalClineRulesToggles } from "../cline-rules"

function makeController(initialToggles: ClineRulesToggles = {}) {
	const state = { localClineRulesToggles: { ...initialToggles } }
	const controller = {
		stateManager: {
			getWorkspaceStateKey: (key: "localClineRulesToggles") => state[key],
			setWorkspaceState: (key: "localClineRulesToggles", value: ClineRulesToggles) => {
				state[key] = value
			},
		},
	}
	return controller as unknown as Controller
}

async function writeRule(workspacePath: string, relativePath: string, content = "Be concise.\n") {
	const filePath = path.join(workspacePath, relativePath)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content, "utf8")
	return filePath
}

describe("cline rules toggles", () => {
	let workspacePath: string

	beforeEach(async () => {
		workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
	})

	afterEach(async () => {
		await fs.rm(workspacePath, { recursive: true, force: true })
	})

	it("collects rules from both .clinerules and .cline/rules", async () => {
		const legacyRule = await writeRule(workspacePath, path.join(".clinerules", "legacy.md"))
		const clineDirRule = await writeRule(workspacePath, path.join(".cline", "rules", "modern.md"))

		const toggles = await refreshLocalClineRulesToggles(makeController(), workspacePath)

		expect(toggles).to.deep.equal({
			[legacyRule]: true,
			[clineDirRule]: true,
		})
	})

	it("keeps .cline/rules toggles when the legacy .clinerules directory does not exist", async () => {
		const clineDirRule = await writeRule(workspacePath, path.join(".cline", "rules", "modern.md"))

		const toggles = await refreshLocalClineRulesToggles(makeController({ [clineDirRule]: false }), workspacePath)

		expect(toggles).to.deep.equal({ [clineDirRule]: false })
	})

	it("does not reset a toggle the user disabled", async () => {
		const clineDirRule = await writeRule(workspacePath, path.join(".cline", "rules", "modern.md"))

		const toggles = await refreshLocalClineRulesToggles(makeController({ [clineDirRule]: false }), workspacePath)

		expect(toggles[clineDirRule]).to.equal(false)
	})

	it("prunes toggles for removed rules and keeps the rest", async () => {
		const legacyRule = await writeRule(workspacePath, path.join(".clinerules", "legacy.md"))
		const deletedRule = path.join(workspacePath, ".cline", "rules", "deleted.md")

		const toggles = await refreshLocalClineRulesToggles(
			makeController({ [legacyRule]: true, [deletedRule]: true }),
			workspacePath,
		)

		expect(toggles).to.deep.equal({ [legacyRule]: true })
	})

	it("clears all toggles when neither rule directory exists", async () => {
		const staleRule = path.join(workspacePath, ".clinerules", "stale.md")

		const toggles = await refreshLocalClineRulesToggles(makeController({ [staleRule]: true }), workspacePath)

		expect(toggles).to.deep.equal({})
	})

	it("still excludes workflows, hooks and skills nested under .clinerules", async () => {
		const rule = await writeRule(workspacePath, path.join(".clinerules", "keep.md"))
		await writeRule(workspacePath, path.join(".clinerules", "workflows", "workflow.md"))
		await writeRule(workspacePath, path.join(".clinerules", "hooks", "hook.md"))
		await writeRule(workspacePath, path.join(".clinerules", "skills", "skill.md"))

		const toggles = await refreshLocalClineRulesToggles(makeController(), workspacePath)

		expect(toggles).to.deep.equal({ [rule]: true })
	})

	it("collects a legacy .clinerules file and a .cline/rules directory together", async () => {
		const legacyFile = await writeRule(workspacePath, ".clinerules")
		const clineDirRule = await writeRule(workspacePath, path.join(".cline", "rules", "modern.md"))

		const toggles = await refreshLocalClineRulesToggles(makeController(), workspacePath)

		expect(toggles).to.deep.equal({
			[legacyFile]: true,
			[clineDirRule]: true,
		})
	})

	it("scans the same workspace roots the SDK resolves for a task", () => {
		const scanDirectories = localClineRulesScanDirectories(workspacePath).map((scan) => scan.directoryPath)
		const agentsRulesFile = path.join(workspacePath, "AGENTS.md")
		const sdkWorkspaceRoots = resolveRulesConfigSearchPaths(workspacePath).filter(
			(resolvedPath) => resolvedPath.startsWith(workspacePath) && resolvedPath !== agentsRulesFile,
		)

		expect(scanDirectories).to.deep.equal(sdkWorkspaceRoots)
	})
})
