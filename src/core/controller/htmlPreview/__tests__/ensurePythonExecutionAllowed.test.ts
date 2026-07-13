import { expect } from "chai"
import { type PythonExecutionPrompt, resolvePythonExecutionPermission } from "../ensurePythonExecutionAllowed"

describe("HTML Preview Python execution policy", () => {
	function policy(overrides: Partial<Parameters<typeof resolvePythonExecutionPermission>[0]> = {}, decision = true) {
		const prompts: PythonExecutionPrompt[] = []
		const approvedWorkspaceKeys = new Set<string>()
		return {
			prompts,
			approvedWorkspaceKeys,
			input: {
				workspaceTrusted: true,
				mode: "prompt" as const,
				workspaceKey: "file:///synthetic-workspace",
				approvedWorkspaceKeys,
				requestDecision: async (prompt: PythonExecutionPrompt) => {
					prompts.push(prompt)
					return decision
				},
				...overrides,
			},
		}
	}

	it("denies Python in an untrusted workspace before evaluating the configured mode", async () => {
		const test = policy({ workspaceTrusted: false, mode: "always" })
		expect(await resolvePythonExecutionPermission(test.input)).to.be.false
		expect(test.prompts).to.deep.equal(["manage-workspace-trust"])
	})

	it("enforces never and always without prompting", async () => {
		const never = policy({ mode: "never" })
		expect(await resolvePythonExecutionPermission(never.input)).to.be.false
		expect(never.prompts).to.be.empty

		const always = policy({ mode: "always" }, false)
		expect(await resolvePythonExecutionPermission(always.input)).to.be.true
		expect(always.prompts).to.be.empty
	})

	it("accepts and caches an explicit prompt approval for the workspace", async () => {
		const test = policy()
		expect(await resolvePythonExecutionPermission(test.input)).to.be.true
		expect(await resolvePythonExecutionPermission(test.input)).to.be.true
		expect(test.prompts).to.deep.equal(["python-execution"])
		expect(test.approvedWorkspaceKeys.has(test.input.workspaceKey)).to.be.true
	})

	it("rejects a prompt denial without caching approval", async () => {
		const test = policy({}, false)
		expect(await resolvePythonExecutionPermission(test.input)).to.be.false
		expect(await resolvePythonExecutionPermission(test.input)).to.be.false
		expect(test.prompts).to.deep.equal(["python-execution", "python-execution"])
		expect(test.approvedWorkspaceKeys).to.be.empty
	})
})
