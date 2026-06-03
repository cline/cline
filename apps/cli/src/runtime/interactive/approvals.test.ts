import type { ToolApprovalRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { Config } from "../../utils/types";
import { createInteractiveApprovalController } from "./approvals";

function makeConfig(autoApprove = true): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		defaultToolAutoApprove: autoApprove,
		toolPolicies: {
			"*": { autoApprove },
		},
		cwd: process.cwd(),
	};
}

function makeRequest(
	policy: ToolApprovalRequest["policy"],
): ToolApprovalRequest {
	return {
		sessionId: "session-1",
		agentId: "agent-1",
		conversationId: "conversation-1",
		iteration: 1,
		toolCallId: "tool-1",
		toolName: "read_file",
		input: {},
		policy,
	};
}

describe("createInteractiveApprovalController", () => {
	it("approves requests when global auto-approve is enabled", async () => {
		const controller = createInteractiveApprovalController(makeConfig(true));

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: undefined })),
		).resolves.toEqual({ approved: true });
	});

	it("uses the TUI approver when global auto-approve is disabled", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.tuiToolApprover.current = async () => ({
			approved: false,
			reason: "no",
		});

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: false })),
		).resolves.toEqual({ approved: false, reason: "no" });
	});

	it("denies approval-required requests when no TUI approver is available", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: false })),
		).resolves.toMatchObject({ approved: false });
	});

	it("updates live tool policies when interactive auto-approve changes", () => {
		const config = makeConfig(false);
		const controller = createInteractiveApprovalController(config);

		controller.setInteractiveAutoApprove(true);

		expect(controller.autoApproveAllRef.current).toBe(true);
		expect(config.defaultToolAutoApprove).toBe(false);
		expect(config.toolPolicies["*"]?.autoApprove).toBe(false);
	});
});
