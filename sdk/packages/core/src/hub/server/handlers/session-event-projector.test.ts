import type { AgentEvent, HubEventEnvelope } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { CoreSessionEvent } from "../../../types/events";
import type { HubTransportContext } from "./context";
import { buildHubEvent } from "./context";
import { projectSessionEvent } from "./session-event-projector";

/** Minimal ctx fixture that records every envelope handed to `publish`. */
function captureContext() {
	const published: HubEventEnvelope[] = [];
	const ctx = {
		publish: (event: HubEventEnvelope) => published.push(event),
		buildEvent: buildHubEvent,
	} as unknown as HubTransportContext;
	return { published, ctx };
}

function agentEvent(
	event: AgentEvent,
	overrides: { teamRole?: "lead" | "teammate"; teamAgentId?: string } = {},
): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: "sess-root",
			event,
			...(overrides.teamRole ? { teamRole: overrides.teamRole } : {}),
			...(overrides.teamAgentId ? { teamAgentId: overrides.teamAgentId } : {}),
		},
	};
}

describe("projectSessionEvent agent identity", () => {
	it("attaches a teammate identity block to assistant.delta", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent(
				{ type: "content_start", contentType: "text", text: "from teammate" },
				{ teamRole: "teammate", teamAgentId: "worker-a" },
			),
		);

		const [delta] = published;
		expect(delta.event).toBe("assistant.delta");
		expect(delta.sessionId).toBe("sess-root");
		expect(delta.payload).toEqual(
			expect.objectContaining({
				text: "from teammate",
				agent: expect.objectContaining({
					kind: "teammate",
					teamRole: "teammate",
					teamAgentId: "worker-a",
				}),
			}),
		);
	});

	it("keeps lead content tagged as lead (no parent agent id)", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent(
				{ type: "content_start", contentType: "text", text: "from lead" },
				{ teamRole: "lead" },
			),
		);

		expect(published[0].payload).toEqual(
			expect.objectContaining({
				agent: expect.objectContaining({
					kind: "lead",
					teamRole: "lead",
					teamAgentId: undefined,
				}),
			}),
		);
	});

	it("tags a parent agent as a subagent when no team role is set", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent({
				type: "content_start",
				contentType: "text",
				text: "from subagent",
				parentAgentId: "lead-agent",
			}),
		);

		expect(published[0].payload).toEqual(
			expect.objectContaining({
				agent: expect.objectContaining({
					kind: "subagent",
					parentAgentId: "lead-agent",
					teamRole: undefined,
				}),
			}),
		);
	});

	it("attaches identity to tool lifecycle events, not just text", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent(
				{
					type: "content_start",
					contentType: "tool",
					toolCallId: "call-1",
					toolName: "run_commands",
				},
				{ teamRole: "teammate", teamAgentId: "worker-b" },
			),
		);
		await projectSessionEvent(
			ctx,
			agentEvent(
				{
					type: "content_end",
					contentType: "tool",
					toolCallId: "call-1",
					toolName: "run_commands",
				},
				{ teamRole: "teammate", teamAgentId: "worker-b" },
			),
		);

		const events = published.map((e) => e.event);
		expect(events).toEqual(["tool.started", "tool.finished"]);
		for (const envelope of published) {
			expect(envelope.payload).toEqual(
				expect.objectContaining({
					agent: expect.objectContaining({
						kind: "teammate",
						teamRole: "teammate",
						teamAgentId: "worker-b",
					}),
				}),
			);
		}
	});

	it("omits team fields for non-team content (backwards compatible shape)", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent({ type: "content_start", contentType: "text", text: "plain" }),
		);

		const agent = published[0].payload?.agent as Record<string, unknown>;
		expect(agent.kind).toBe("lead");
		expect(agent.teamRole).toBeUndefined();
		expect(agent.teamAgentId).toBeUndefined();
	});

	it("attaches a teammate identity block to agent.done (the completion message)", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent(
				{
					type: "done",
					reason: "completed",
					text: "Teammate finished: wrote the tests.",
					iterations: 4,
				},
				{ teamRole: "teammate", teamAgentId: "worker-a" },
			),
		);

		const [done] = published;
		expect(done.event).toBe("agent.done");
		expect(done.payload).toEqual(
			expect.objectContaining({
				text: "Teammate finished: wrote the tests.",
				agent: expect.objectContaining({
					kind: "teammate",
					teamRole: "teammate",
					teamAgentId: "worker-a",
				}),
			}),
		);
	});

	it("tags the lead's agent.done without a teammate id", async () => {
		const { published, ctx } = captureContext();
		await projectSessionEvent(
			ctx,
			agentEvent(
				{
					type: "done",
					reason: "completed",
					text: "All done.",
					iterations: 2,
				},
				{ teamRole: "lead" },
			),
		);

		expect(published[0].payload).toEqual(
			expect.objectContaining({
				agent: expect.objectContaining({
					kind: "lead",
					teamRole: "lead",
					teamAgentId: undefined,
				}),
			}),
		);
	});
});
