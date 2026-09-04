import { describe, expect, it } from "vitest";
import { resolveDashboardHandoffKey } from "../index";

describe("github PR dashboard plugin", () => {
	it("uses runtime identifiers for pending handoff keys without a shared default", () => {
		expect(
			resolveDashboardHandoffKey({
				agentId: "agent-1",
				conversationId: "conversation-1",
				runId: "run-1",
			}),
		).toBe("run-1");
		expect(
			resolveDashboardHandoffKey({
				agentId: "agent-1",
				conversationId: "conversation-1",
			}),
		).toBe("conversation-1");
		expect(resolveDashboardHandoffKey({ agentId: "agent-1" })).toBe("agent-1");
	});
});
