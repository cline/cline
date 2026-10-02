import { describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Controller } from "@/core/controller"
import { refreshClineRulesToggles } from "../cline-rules"

/**
 * Minimal Controller stub: refreshClineRulesToggles only touches the
 * stateManager toggle accessors.
 */
function makeControllerStub(initial: {
	globalClineRulesToggles?: Record<string, boolean>
	localClineRulesToggles?: Record<string, boolean>
}) {
	const globalState = new Map<string, unknown>([["globalClineRulesToggles", initial.globalClineRulesToggles ?? {}]])
	const workspaceState = new Map<string, unknown>([["localClineRulesToggles", initial.localClineRulesToggles ?? {}]])
	const controller = {
		stateManager: {
			getGlobalSettingsKey: (key: string) => globalState.get(key) ?? {},
			getWorkspaceStateKey: (key: string) => workspaceState.get(key) ?? {},
			setGlobalState: (key: string, value: unknown) => globalState.set(key, value),
			setWorkspaceState: (key: string, value: unknown) => workspaceState.set(key, value),
		},
	}
	return controller as unknown as Controller
}

describe("refreshClineRulesToggles workspace layouts", () => {
	it("discovers rules in both .clinerules and .cline/rules", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-layouts-"))
		try {
			const legacyDir = path.join(workspace, ".clinerules")
			const clineRulesDir = path.join(workspace, ".cline", "rules")
			await fs.mkdir(legacyDir, { recursive: true })
			await fs.mkdir(clineRulesDir, { recursive: true })
			await fs.writeFile(path.join(legacyDir, "legacy-rule.md"), "Legacy layout rule")
			await fs.writeFile(path.join(clineRulesDir, "new-rule.md"), "New layout rule")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshClineRulesToggles(controller, workspace)

			expect(localToggles).to.have.property(path.join(legacyDir, "legacy-rule.md"), true)
			expect(localToggles).to.have.property(path.join(clineRulesDir, "new-rule.md"), true)
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("discovers .cline/rules rules when no .clinerules directory exists", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-newonly-"))
		try {
			const clineRulesDir = path.join(workspace, ".cline", "rules")
			await fs.mkdir(clineRulesDir, { recursive: true })
			await fs.writeFile(path.join(clineRulesDir, "only-rule.md"), "Only .cline/rules layout")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshClineRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[path.join(clineRulesDir, "only-rule.md")]: true,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("preserves disabled toggles per layout and prunes deleted files", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-toggles-"))
		try {
			const legacyDir = path.join(workspace, ".clinerules")
			const clineRulesDir = path.join(workspace, ".cline", "rules")
			await fs.mkdir(legacyDir, { recursive: true })
			await fs.mkdir(clineRulesDir, { recursive: true })
			const legacyRule = path.join(legacyDir, "a.md")
			const newRule = path.join(clineRulesDir, "b.md")
			await fs.writeFile(legacyRule, "A")
			await fs.writeFile(newRule, "B")

			const controller = makeControllerStub({
				localClineRulesToggles: {
					[legacyRule]: false,
					[newRule]: false,
					[path.join(clineRulesDir, "deleted.md")]: true,
				},
			})
			const { localToggles } = await refreshClineRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[legacyRule]: false,
				[newRule]: false,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("still excludes .clinerules workflows/hooks/skills sub-directories", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-excl-"))
		try {
			const legacyDir = path.join(workspace, ".clinerules")
			await fs.mkdir(path.join(legacyDir, "workflows"), { recursive: true })
			await fs.mkdir(path.join(legacyDir, "hooks"), { recursive: true })
			await fs.writeFile(path.join(legacyDir, "rule.md"), "Rule")
			await fs.writeFile(path.join(legacyDir, "workflows", "flow.md"), "Workflow")
			await fs.writeFile(path.join(legacyDir, "hooks", "hook.sh"), "#!/bin/sh")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshClineRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[path.join(legacyDir, "rule.md")]: true,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})
})
