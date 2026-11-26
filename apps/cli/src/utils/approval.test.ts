import type { ToolApprovalRequest } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getActiveCliSession: vi.fn(() => undefined),
	requestDesktopToolApproval: vi.fn(
		async (
			_request: ToolApprovalRequest,
			options?: { approvalDir?: string; sessionId?: string },
		) => {
			if (!options?.approvalDir || !options.sessionId) {
				return {
					approved: false,
					reason: "Desktop tool approval IPC is not configured",
				};
			}
			return { approved: true };
		},
	),
}));

vi.mock("@cline/core", () => ({
	requestDesktopToolApproval: mocks.requestDesktopToolApproval,
}));

vi.mock("./output", () => ({
	c: { dim: "", green: "", reset: "", yellow: "" },
	getActiveCliSession: mocks.getActiveCliSession,
	write: vi.fn(),
}));

import { requestToolApproval } from "./approval";

const request: ToolApprovalRequest = {
	sessionId: "session-from-request",
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 0,
	toolCallId: "tool-call-1",
	toolName: "execute_command",
	input: { command: "pwd" },
	policy: { autoApprove: false },
};

describe("requestToolApproval", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
	});

	it("routes a first-turn desktop approval with the request session ID", async () => {
		vi.stubEnv("CLINE_TOOL_APPROVAL_MODE", "desktop");
		vi.stubEnv("CLINE_TOOL_APPROVAL_DIR", "/tmp/cline-approvals");

		await expect(requestToolApproval(request)).resolves.toEqual({
			approved: true,
		});

		expect(mocks.getActiveCliSession).not.toHaveBeenCalled();
		expect(mocks.requestDesktopToolApproval).toHaveBeenCalledWith(request, {
			approvalDir: "/tmp/cline-approvals",
			sessionId: request.sessionId,
		});
	});
});
