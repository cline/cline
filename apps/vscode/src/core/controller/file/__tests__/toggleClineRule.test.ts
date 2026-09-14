import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { RuleScope, ToggleClineRuleRequest } from "@shared/proto/cline/file"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { parseYamlFrontmatter } from "@/core/context/instructions/user-instructions/frontmatter"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { toggleClineRule } from "../toggleClineRule"

let sandbox: sinon.SinonSandbox
let workspace: string

beforeEach(async () => {
	sandbox = sinon.createSandbox()
	workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cline-toggle-rule-test-")))
	await fs.mkdir(path.join(workspace, ".clinerules"), { recursive: true })
	setVscodeHostProviderMock()
	// A fresh array per call: getCwd() consumes the array it receives with shift().
	sandbox.stub(HostProvider, "workspace").get(() => ({
		getWorkspacePaths: async () => ({ paths: [workspace] }),
	}))
})

afterEach(async () => {
	sandbox.restore()
	HostProvider.reset()
	await fs.rm(workspace, { recursive: true, force: true })
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
	it("persists a workspace rule toggle in both extension state and the rule file the SDK reads", async () => {
		const rulePath = path.join(workspace, ".clinerules", "project-rule.md")
		await fs.writeFile(rulePath, "Follow this rule")
		const { controller, localToggles } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(localToggles[rulePath]).toBe(false)
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).toBe(true)

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: true }),
		)

		expect(localToggles[rulePath]).toBe(true)
		expect(await fs.readFile(rulePath, "utf-8")).toBe("Follow this rule")
	})

	it("updates state but leaves the file alone when the path is outside the workspace .clinerules", async () => {
		const rulePath = path.join(workspace, "README.md")
		await fs.writeFile(rulePath, "Not a rule")
		const { controller, localToggles } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(localToggles[rulePath]).toBe(false)
		expect(await fs.readFile(rulePath, "utf-8")).toBe("Not a rule")
	})

	it("does not write frontmatter into non-rule files that happen to live in .clinerules", async () => {
		const rulePath = path.join(workspace, ".clinerules", "notes.json")
		await fs.writeFile(rulePath, "{}")
		const { controller } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(await fs.readFile(rulePath, "utf-8")).toBe("{}")
	})
})
