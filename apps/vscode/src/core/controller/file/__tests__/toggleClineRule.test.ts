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
	const localToggles: Record<string, boolean> = {}
	const globalState = new Map<string, unknown>([
		["globalClineRulesToggles", {}],
		["remoteRulesToggles", {}],
		["clineRulesFrontmatterAuthoritative", {}],
	])
	const workspaceState = new Map<string, unknown>([
		["localClineRulesToggles", localToggles],
		["localClineRulesFrontmatterAuthoritative", {}],
	])

	return {
		controller: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => globalState.get(key) ?? {},
				getWorkspaceStateKey: (key: string) => workspaceState.get(key) ?? {},
				getGlobalStateKey: (key: string) => globalState.get(key) ?? {},
				setGlobalState: (key: string, value: unknown) => globalState.set(key, value),
				setWorkspaceState: (key: string, value: unknown) => workspaceState.set(key, value),
			},
		},
		localToggles,
		workspaceState,
	}
}

describe("toggleClineRule", () => {
	it("persists a workspace rule toggle in both extension state and the rule file the SDK reads", async () => {
		const rulePath = path.join(workspace, ".clinerules", "project-rule.md")
		await fs.writeFile(rulePath, "Follow this rule")
		const { controller, localToggles, workspaceState } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(localToggles[rulePath]).toBe(false)
		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).toBe(true)
		expect(workspaceState.get("localClineRulesFrontmatterAuthoritative")).toEqual({ [rulePath]: true })

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: true }),
		)

		expect(localToggles[rulePath]).toBe(true)
		expect(await fs.readFile(rulePath, "utf-8")).toBe("Follow this rule")
	})

	it("also writes rules under the .cline/rules layout", async () => {
		const rulePath = path.join(workspace, ".cline", "rules", "new-layout.md")
		await fs.mkdir(path.dirname(rulePath), { recursive: true })
		await fs.writeFile(rulePath, "New layout rule")
		const { controller } = createController()

		await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(parseYamlFrontmatter(await fs.readFile(rulePath, "utf-8")).data.disabled).toBe(true)
	})

	it("updates state but leaves the file alone when the path is outside the workspace rule directories", async () => {
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

	it("reverts the state toggle when the rule file cannot be written", async () => {
		const rulePath = path.join(workspace, ".clinerules", "read-only.md")
		await fs.writeFile(rulePath, "Locked rule")
		await fs.chmod(rulePath, 0o444)
		const { controller, localToggles, workspaceState } = createController()
		try {
			const response = await toggleClineRule(
				controller as never,
				ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
			)

			expect(localToggles[rulePath]).toBe(true)
			expect(response.localClineRulesToggles?.toggles[rulePath]).toBe(true)
			expect(await fs.readFile(rulePath, "utf-8")).toBe("Locked rule")
			expect(workspaceState.get("localClineRulesFrontmatterAuthoritative")).toEqual({})
		} finally {
			await fs.chmod(rulePath, 0o644)
		}
	})

	it("reverts the state toggle when malformed frontmatter prevents a safe edit", async () => {
		const rulePath = path.join(workspace, ".clinerules", "broken.md")
		const content = "---\npaths: [invalid\n---\nBody"
		await fs.writeFile(rulePath, content)
		const { controller, localToggles } = createController()

		const response = await toggleClineRule(
			controller as never,
			ToggleClineRuleRequest.create({ scope: RuleScope.LOCAL, rulePath, enabled: false }),
		)

		expect(localToggles[rulePath]).toBe(true)
		expect(response.localClineRulesToggles?.toggles[rulePath]).toBe(true)
		expect(await fs.readFile(rulePath, "utf-8")).toBe(content)
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
