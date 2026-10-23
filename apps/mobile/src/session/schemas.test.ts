import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CONSUMED_HUB_EVENTS,
	parseAskQuestionCapabilityRequest,
	parseHubEvent,
	parseModelCatalogReply,
	parsePendingApprovals,
	parseSessionCreateReply,
	parseSessionListReply,
	parseSessionMessagesReply,
	parseSessionRecordReply,
} from "./schemas";

describe("parseAskQuestionCapabilityRequest", () => {
	it("preserves repeated model-supplied options like desktop", () => {
		expect(
			parseAskQuestionCapabilityRequest(
				{
					requestId: "capreq_1",
					targetClientId: "mobile_1",
					capabilityName: "tool_executor.askQuestion",
					payload: { args: ["Choose", ["Same", "Same"]] },
				},
				"mobile_1",
			),
		).toMatchObject({
			status: "ok",
			question: { options: ["Same", "Same"] },
		});
	});
});

function envelope(
	event: string,
	payload?: Record<string, unknown>,
): HubEventEnvelope {
	return {
		version: "v1",
		event: event as HubEventEnvelope["event"],
		eventId: "evt_1",
		sessionId: "ses_1",
		payload,
	};
}

describe("parseHubEvent", () => {
	it("uses receipt time only when an approval has no producer timestamp", () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(4321);
		try {
			const parsed = parseHubEvent(
				envelope("approval.requested", {
					approvalId: "ap_1",
					sessionId: "ses_1",
					agentId: "ag_1",
					conversationId: "cv_1",
					iteration: 1,
					toolCallId: "tc_1",
					toolName: "bash",
					inputJson: "{}",
					policy: {},
				}),
			);
			expect(parsed).toMatchObject({
				status: "ok",
				event: { payload: { createdAt: 4321 } },
			});
		} finally {
			clock.mockRestore();
		}
	});

	it("accepts every consumed event with a well-formed payload", () => {
		const samples: Record<string, Record<string, unknown> | undefined> = {
			"run.started": undefined,
			"assistant.delta": { text: "hi" },
			"assistant.media": {
				media: {
					id: "generated-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
			},
			"assistant.finished": { text: "hi" },
			"reasoning.delta": { text: "think", redacted: false },
			"reasoning.finished": { reasoning: "think" },
			"tool.started": { toolCallId: "tc_1", toolName: "bash", input: { a: 1 } },
			"tool.updated": { toolCallId: "tc_1", output: "partial" },
			"tool.finished": { toolCallId: "tc_1", toolName: "bash", output: "hi" },
			"usage.updated": {
				delta: { inputTokens: 1, outputTokens: 2 },
				totals: { inputTokens: 1, outputTokens: 2, totalCost: 0.5 },
			},
			"run.completed": { reason: "completed" },
			"run.aborted": { reason: "aborted" },
			"run.failed": { reason: "error" },
			"approval.requested": {
				approvalId: "ap_1",
				sessionId: "ses_1",
				agentId: "ag_1",
				conversationId: "cv_1",
				iteration: 1,
				toolCallId: "tc_1",
				toolName: "bash",
				inputJson: "{}",
				policy: { autoApprove: false },
				createdAt: 7,
			},
			"approval.resolved": { approvalId: "ap_1", approved: true },
			"session.pending_prompts": {
				sessionId: "ses_1",
				prompts: [
					{
						id: "pp_1",
						prompt: "and then run the tests",
						delivery: "queue",
						attachmentCount: 0,
					},
				],
			},
			"session.pending_prompt_submitted": {
				sessionId: "ses_1",
				prompt: {
					id: "pp_1",
					prompt: "and then run the tests",
					delivery: "queue",
					attachmentCount: 0,
				},
			},

			"session.updated": {
				session: {
					sessionId: "ses_1",
					status: "idle",
					provider: "anthropic",
					model: "claude-opus-5",
				},
			},
		};
		expect(Object.keys(samples).sort()).toEqual(
			[...CONSUMED_HUB_EVENTS].sort(),
		);
		for (const [name, payload] of Object.entries(samples)) {
			const result = parseHubEvent(envelope(name, payload));
			expect(result.status, `${name}: ${JSON.stringify(result)}`).toBe("ok");
		}
	});

	it("reports known-but-unconsumed hub events as ignored", () => {
		expect(
			parseHubEvent(envelope("iteration.started", { iteration: 1 })),
		).toEqual({ status: "ignored", event: "iteration.started" });
		expect(parseHubEvent(envelope("session.attached")).status).toBe("ignored");
	});

	it("reports event names outside the protocol as unknown", () => {
		expect(parseHubEvent(envelope("assistant.telepathy"))).toEqual({
			status: "unknown",
			event: "assistant.telepathy",
		});
	});

	it("reports malformed payloads as invalid without throwing", () => {
		const missingText = parseHubEvent(envelope("assistant.delta", {}));
		expect(missingText.status).toBe("invalid");
		const wrongType = parseHubEvent(
			envelope("tool.started", { toolCallId: 7 }),
		);
		expect(wrongType.status).toBe("invalid");
		const badApproval = parseHubEvent(
			envelope("approval.resolved", { approvalId: "ap_1", approved: "yes" }),
		);
		expect(badApproval.status).toBe("invalid");
		if (badApproval.status !== "invalid") {
			throw new Error("expected invalid");
		}
		expect(badApproval.detail).toMatch(/approved/);
	});

	it("keeps optional fields optional the way the hub actually sends them", () => {
		// The hook branch of the projector publishes tool events with only a name.
		const hookTool = parseHubEvent(
			envelope("tool.started", { toolName: "bash" }),
		);
		expect(hookTool.status).toBe("ok");
		// `assistant.finished` carries no text when the turn produced none.
		expect(parseHubEvent(envelope("assistant.finished", {})).status).toBe("ok");
		// `run.started` is published with no payload at all.
		expect(parseHubEvent(envelope("run.started")).status).toBe("ok");
	});
});

describe("parseSessionMessagesReply", () => {
	it("parses string and block content", () => {
		const result = parseSessionMessagesReply({
			sessionId: "ses_1",
			messages: [
				{ role: "user", content: "hello" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "hmm" },
						{ type: "text", text: "hi" },
						{
							type: "media",
							media: {
								id: "generated-1",
								modality: "image",
								mediaType: "image/png",
								source: { type: "base64", data: "aGVsbG8=" },
							},
						},
						{ type: "tool_use", id: "tc_1", name: "bash", input: { a: 1 } },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tc_1",
							name: "bash",
							content: "done",
						},
					],
				},
			],
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.messages).toHaveLength(3);
		expect(result.messages[1]?.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "media",
					media: expect.objectContaining({ id: "generated-1" }),
				}),
			]),
		);
	});

	it("tolerates unknown content block types", () => {
		const result = parseSessionMessagesReply({
			messages: [{ role: "assistant", content: [{ type: "video", url: "x" }] }],
		});
		expect(result.status).toBe("ok");
	});

	it("flags a structurally malformed reply instead of throwing", () => {
		// Only the *envelope* is all-or-nothing: without an array of messages there is
		// no transcript to salvage.
		expect(parseSessionMessagesReply(undefined).status).toBe("invalid");
		expect(parseSessionMessagesReply({ messages: "nope" }).status).toBe(
			"invalid",
		);
		expect(parseSessionMessagesReply({}).status).toBe("invalid");
	});

	it("skips a malformed entry instead of blanking the whole transcript", () => {
		// One bad content block used to cost the entire transcript, which also reset
		// the optimistic-send baseline. Entries are parsed one at a time, like
		// `parsePendingApprovals`.
		const result = parseSessionMessagesReply({
			messages: [
				{ role: "user", content: "kept one" },
				{ role: "system", content: "unsupported role" },
				{ role: "assistant", content: [{ type: "text" }] },
				{ role: "assistant", content: "kept two" },
			],
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.messages).toHaveLength(2);
		expect(result.invalidCount).toBe(2);
	});

	it("reports no skipped entries for a clean reply", () => {
		const result = parseSessionMessagesReply({
			messages: [{ role: "user", content: "hello" }],
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.invalidCount).toBe(0);
	});
});

describe("parsePendingApprovals", () => {
	const approval = {
		approvalId: "ap_1",
		sessionId: "ses_1",
		agentId: "ag_1",
		conversationId: "cv_1",
		iteration: 1,
		toolCallId: "tc_1",
		toolName: "bash",
		inputJson: "{}",
		policy: { autoApprove: false },
		createdAt: 7,
	};

	it("keeps well-formed entries and counts the rest", () => {
		const result = parsePendingApprovals([approval, { approvalId: "ap_2" }, 3]);
		expect(result.approvals.map((entry) => entry.approvalId)).toEqual(["ap_1"]);
		expect(result.invalidCount).toBe(2);
	});

	it("treats a non-array as zero approvals", () => {
		expect(parsePendingApprovals(undefined)).toEqual({
			approvals: [],
			invalidCount: 0,
		});
	});

	it("keeps the optional expiresAt the hub now sends", () => {
		const result = parsePendingApprovals([{ ...approval, expiresAt: 900 }]);
		expect(result.invalidCount).toBe(0);
		expect(result.approvals[0]?.expiresAt).toBe(900);
	});

	it("rejects a row whose expiresAt is not an epoch number", () => {
		const result = parsePendingApprovals([{ ...approval, expiresAt: "soon" }]);
		expect(result.approvals).toEqual([]);
		expect(result.invalidCount).toBe(1);
	});
});

describe("approval.resolved expiry fields", () => {
	it("accepts the expired flag and its reason", () => {
		const parsed = parseHubEvent(
			envelope("approval.resolved", {
				approvalId: "ap_1",
				approved: false,
				expired: true,
				reason: "approval_timeout",
			}),
		);
		expect(parsed.status).toBe("ok");
		if (parsed.status !== "ok" || parsed.event.name !== "approval.resolved") {
			throw new Error("expected a parsed approval.resolved");
		}
		expect(parsed.event.payload.expired).toBe(true);
		expect(parsed.event.payload.reason).toBe("approval_timeout");
	});

	it("rejects a non-boolean expired flag", () => {
		const parsed = parseHubEvent(
			envelope("approval.resolved", {
				approvalId: "ap_1",
				approved: false,
				expired: "yes",
			}),
		);
		expect(parsed.status).toBe("invalid");
	});
});

describe("parseSessionRecordReply", () => {
	it("maps every hub runtime status onto a run status", () => {
		const cases = {
			idle: "idle",
			running: "running",
			pending: "running",
			completed: "completed",
			aborted: "aborted",
			failed: "failed",
		} as const;
		for (const [hubStatus, runStatus] of Object.entries(cases)) {
			const parsed = parseSessionRecordReply({
				session: { sessionId: "ses_1", status: hubStatus },
			});
			expect(parsed.status, hubStatus).toBe("ok");
			if (parsed.status !== "ok") {
				throw new Error("expected ok");
			}
			expect(parsed.runStatus, hubStatus).toBe(runStatus);
			expect(parsed.sessionId).toBe("ses_1");
		}
	});

	it("leaves the run status unknown for a status this build does not know", () => {
		const parsed = parseSessionRecordReply({
			session: { sessionId: "ses_1", status: "compacting" },
		});
		expect(parsed).toEqual({ status: "ok", sessionId: "ses_1" });
	});

	it("reports a reply with no session record as invalid", () => {
		expect(parseSessionRecordReply({}).status).toBe("invalid");
		expect(parseSessionRecordReply(undefined).status).toBe("invalid");
	});
});

describe("session reply schemas", () => {
	it("parses session.list replies and ignores unusable rows", () => {
		const result = parseSessionListReply({
			sessions: [
				{ sessionId: "ses_1", updatedAt: 2, status: "idle" },
				{ sessionId: "ses_2", updatedAt: 1 },
				{ nope: true },
			],
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") {
			throw new Error("expected ok");
		}
		expect(result.sessions.map((entry) => entry.sessionId)).toEqual([
			"ses_1",
			"ses_2",
		]);
		expect(result.invalidCount).toBe(1);
	});

	it("parses session.create replies", () => {
		expect(
			parseSessionCreateReply({ session: { sessionId: "ses_9" } }),
		).toEqual({
			status: "ok",
			sessionId: "ses_9",
		});
		expect(parseSessionCreateReply({}).status).toBe("invalid");
	});
});

/**
 * The read half of model selection. Hub v1 could always SET a model
 * (`session.update_connection`) but offered nothing to read: `catalog.list` had
 * no handler and the record no typed model. These pin the shapes the picker
 * needs — including the metadata fallback, because every hub has always carried
 * `metadata.provider`/`metadata.model` even while the typed fields were missing.
 */
describe("session model readback", () => {
	it("reads the typed provider/model from a record reply", () => {
		const parsed = parseSessionRecordReply({
			session: {
				sessionId: "ses_1",
				status: "idle",
				provider: "anthropic",
				model: "claude-opus-5",
			},
		});
		expect(parsed.status).toBe("ok");
		if (parsed.status !== "ok") throw new Error("expected ok");
		expect(parsed.model).toEqual({
			providerId: "anthropic",
			modelId: "claude-opus-5",
		});
	});

	it("falls back to the metadata spelling an older hub sends", () => {
		const parsed = parseSessionRecordReply({
			session: {
				sessionId: "ses_1",
				metadata: { provider: "lmstudio", model: "qwen3-coder" },
			},
		});
		if (parsed.status !== "ok") throw new Error("expected ok");
		expect(parsed.model).toEqual({
			providerId: "lmstudio",
			modelId: "qwen3-coder",
		});
	});

	it("reports no model rather than an empty one", () => {
		const parsed = parseSessionRecordReply({
			session: { sessionId: "ses_1" },
		});
		if (parsed.status !== "ok") throw new Error("expected ok");
		expect(parsed.model).toBeUndefined();
	});
});

describe("parseModelCatalogReply", () => {
	it("parses a catalog", () => {
		const parsed = parseModelCatalogReply({
			providers: [
				{
					id: "anthropic",
					name: "Anthropic",
					enabled: true,
					defaultModelId: "claude-opus-5",
				},
			],
			modelsByProvider: {
				anthropic: [
					{
						id: "claude-opus-5",
						name: "Claude Opus 5",
						supportsThinking: true,
					},
				],
			},
		});
		expect(parsed.status).toBe("ok");
		if (parsed.status !== "ok") throw new Error("expected ok");
		expect(parsed.catalog.providers[0]?.id).toBe("anthropic");
		expect(parsed.catalog.modelsByProvider.anthropic).toHaveLength(1);
	});

	it("flags a malformed catalog instead of throwing", () => {
		expect(parseModelCatalogReply(undefined).status).toBe("invalid");
		expect(parseModelCatalogReply({ providers: "nope" }).status).toBe(
			"invalid",
		);
	});
});
