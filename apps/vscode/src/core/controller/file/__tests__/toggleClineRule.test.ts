import { afterEach, describe, expect, it } from "bun:test"
import { RuleScope, ToggleClineRuleRequest } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { parseYamlFrontmatter } from "@/core/context/instructions/user-instructions/frontmatter"
import { toggleClineRule } from "../toggleClineRule"

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function createController() {
	const globalToggles: Record<string, boolean> = {}
	const localToggles: Record<string, boolean> = {}
	const remoteToggles: Record<string, boolean> = {}

	return {
		controller: {
			stateManager: {
				getGlobalSettingsKey: () => globalToggles,
				getWorkspaceStateKey: () => localToggles,
				getGlobalStateKey: () => remoteToggles,
				setGlobalState: () => undefined,
				setWorkspaceState: () => undefined,
			},
		},
		localToggles,
	}
}

describe("toggleClineRule", () => {
	it("persists local rule state for the SDK loader", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cline-toggle-rule-test-"))
		temporaryDirectories.push(directory)
		const rulePath = path.join(directory, "project-rule.md")
		await fs.writeFile(rulePath, "Follow this rule")
		const { controller, localToggles } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(localToggles[rulePath]).toBe(false)
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).toBe(true)
	})
})
