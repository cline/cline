import { AgentRuntime } from "@cline/agents";
import type { AgentModel, ToolPolicy } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createUxVerifierTool } from "./ux-verification";

const context = { agentId: "lead", iteration: 1 };
const check = {
	id: "dialog",
	steps: ["Click Open"],
	expected: "Dialog is visible",
};

describe("UX verifier delegation", () => {
	it.each([
		{ task: "", checklist: [check] },
		{ task: "Inspect the app", checklist: [] },
		{ task: "Inspect the app", checklist: [check, check] },
		{ task: "Inspect the app", checklist: [{ ...check, steps: [] }] },
	])("rejects invalid checklists before starting a worker", async (input) => {
		const execute = vi.fn();
		expect(
			await createUxVerifierTool({ name: "spawn_agent", execute }).execute(
				input,
				context,
			),
		).toHaveProperty("error");
		expect(execute).not.toHaveBeenCalled();
	});

	it("does not delegate an already cancelled request", async () => {
		const execute = vi.fn();
		const controller = new AbortController();
		controller.abort();
		await expect(
			createUxVerifierTool({ name: "spawn_agent", execute }).execute(
				{ task: "Inspect the app", checklist: [check] },
				{ ...context, signal: controller.signal },
			),
		).rejects.toThrow();
		expect(execute).not.toHaveBeenCalled();
	});

	it.each<{
		name: string;
		policies: Record<string, ToolPolicy>;
		approved: boolean | undefined;
		requests: number;
		executions: number;
	}>([
		{
			name: "spawn requires approval",
			policies: {
				"*": { autoApprove: true },
				spawn_agent: { autoApprove: false },
			},
			approved: false,
			requests: 1,
			executions: 0,
		},
		{
			name: "verifier cannot relax spawn approval",
			policies: {
				"*": { autoApprove: true },
				spawn_agent: { autoApprove: false },
				ux_verifier: { autoApprove: true },
			},
			approved: false,
			requests: 1,
			executions: 0,
		},
		{
			name: "stricter verifier policy is preserved",
			policies: {
				"*": { autoApprove: true },
				spawn_agent: { autoApprove: true },
				ux_verifier: { autoApprove: false },
			},
			approved: false,
			requests: 1,
			executions: 0,
		},
		{
			name: "wildcard spawn approval is inherited",
			policies: {
				"*": { autoApprove: false },
				ux_verifier: { autoApprove: true },
			},
			approved: false,
			requests: 1,
			executions: 0,
		},
		{
			name: "missing approval callback does not start a child",
			policies: {
				"*": { autoApprove: true },
				spawn_agent: { autoApprove: false },
			},
			approved: undefined,
			requests: 0,
			executions: 0,
		},
		{
			name: "approved delegation runs once",
			policies: {
				"*": { autoApprove: true },
				spawn_agent: { autoApprove: false },
				ux_verifier: { autoApprove: false },
			},
			approved: true,
			requests: 1,
			executions: 1,
		},
		{
			name: "explicit auto-approvals override the wildcard",
			policies: {
				"*": { autoApprove: false },
				spawn_agent: { autoApprove: true },
				ux_verifier: { autoApprove: true },
			},
			approved: false,
			requests: 0,
			executions: 1,
		},
		{
			name: "disabled spawning cannot run through a directly registered verifier",
			policies: { "*": { autoApprove: true }, spawn_agent: { enabled: false } },
			approved: true,
			requests: 0,
			executions: 0,
		},
	])("protects UX delegation: $name", async ({
		policies,
		approved,
		requests,
		executions,
	}) => {
		const execute = vi.fn(async () => ({ text: "worker observations" }));
		const requestToolApproval = vi.fn(async () => ({
			approved: approved === true,
		}));
		const originalPolicies = structuredClone(policies);
		let turns = 0;
		const model: AgentModel = {
			async *stream() {
				if (turns++ === 0) {
					yield {
						type: "tool-call-delta",
						toolCallId: "verify",
						toolName: "ux_verifier",
						inputText: JSON.stringify({
							task: "Verify app",
							checklist: [
								{ id: "dialog", steps: ["Open"], expected: "Visible" },
							],
						}),
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "finish", reason: "stop" };
				}
			},
		};
		const runtime = new AgentRuntime({
			agentId: "lead",
			model,
			tools: [createUxVerifierTool({ name: "spawn_agent", execute })],
			toolPolicies: policies,
			requestToolApproval:
				approved === undefined ? undefined : requestToolApproval,
		});
		await runtime.run("Check the UI");
		expect(requestToolApproval).toHaveBeenCalledTimes(requests);
		expect(execute).toHaveBeenCalledTimes(executions);
		if (requests)
			expect(requestToolApproval).toHaveBeenCalledWith(
				expect.objectContaining({
					toolName: "ux_verifier",
					policy: expect.objectContaining({ autoApprove: false }),
				}),
			);
		expect(policies).toEqual(originalPolicies);
	});
});
