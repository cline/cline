import type { AgentMessage, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	FIXTURE_STEPS,
	type FixtureStep,
	recordFixtureSession,
} from "./replay.fixtures";
import { describeLiveModelRequest } from "./replay-request";
import {
	createSessionReplaySource,
	SessionReplayMismatchError,
	type SessionReplayModelResponse,
	type SessionReplayServedModelResponse,
} from "./replay-source";

function live(request: AgentModelRequest, model = "fake-model") {
	return describeLiveModelRequest(request, { model });
}

function served(
	response: SessionReplayModelResponse,
): SessionReplayServedModelResponse {
	if (response.status !== "served") {
		throw new Error(`expected a served response, got: ${response.reason}`);
	}
	return response;
}

function withSystemPrompt(
	request: AgentModelRequest | undefined,
	systemPrompt: string,
): AgentModelRequest {
	if (!request) throw new Error("missing request");
	return { ...request, systemPrompt };
}

describe("SessionReplaySource model responses", () => {
	it("serves exact matches in callIndex order with the recorded stream", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		expect(session.sent).toHaveLength(3);
		for (const [index, request] of session.sent.entries()) {
			const snapshot = live(request);
			expect(snapshot.matchKey).toBe(session.requests[index]?.request.matchKey);
			const response = served(source.nextModelResponse({ request: snapshot }));
			expect(response).toMatchObject({
				match: "exact",
				iteration: index + 1,
				divergences: [],
			});
			expect(response.record.callIndex).toBe(index);
			expect(response.events[0]?.event).toEqual({
				type: "text-delta",
				text: FIXTURE_STEPS[index]?.text,
			});
		}
		expect(source.remaining().modelCalls).toEqual([]);
	});

	it("consumes repeated keys across retries in callIndex order", async () => {
		const steps: FixtureStep[] = [
			{ ...FIXTURE_STEPS[0], text: "Listing files.", failedAttempts: 2 },
			{ text: "Done." },
		];
		const session = await recordFixtureSession(steps);
		expect(session.requests.map((record) => record.response.outcome)).toEqual([
			"error",
			"error",
			"completed",
			"completed",
		]);
		const source = createSessionReplaySource(session);
		const first = live(session.sent[0] as AgentModelRequest);
		const answers = [0, 1, 2].map(
			() => served(source.nextModelResponse({ request: first })).record,
		);
		expect(
			answers.map((record) => [
				record.callIndex,
				record.attempt,
				record.response.outcome,
			]),
		).toEqual([
			[0, 0, "error"],
			[1, 1, "error"],
			[2, 2, "completed"],
		]);
		const next = served(
			source.nextModelResponse({
				request: live(session.sent[3] as AgentModelRequest),
			}),
		);
		expect(next.match).toBe("exact");
		expect(next.record.callIndex).toBe(3);
	});

	it("serves a structurally equal request whose fields are reordered", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		source.nextModelResponse({
			request: live(session.sent[0] as AgentModelRequest),
		});
		const second = session.sent[1] as AgentModelRequest;
		const reordered: AgentModelRequest = {
			...second,
			messages: second.messages.map((message): AgentMessage => {
				if (message.role !== "assistant") return message;
				return {
					...message,
					content: message.content.map((part) =>
						part.type === "tool-call"
							? {
									input: part.input,
									toolName: part.toolName,
									toolCallId: part.toolCallId,
									type: part.type,
								}
							: part,
					),
				};
			}),
		};
		const snapshot = live(reordered);
		expect(snapshot.matchKey).not.toBe(session.requests[1]?.request.matchKey);
		const response = served(source.nextModelResponse({ request: snapshot }));
		expect(response).toMatchObject({ match: "equivalent", divergences: [] });
		expect(response.record.callIndex).toBe(1);
	});

	it("fails strict replay on a request mismatch, naming the iteration and the first difference", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		const changed = live(
			withSystemPrompt(session.sent[0], "You are a changed test agent."),
		);
		let error: unknown;
		try {
			source.nextModelResponse({ request: changed });
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(SessionReplayMismatchError);
		const mismatch = error as SessionReplayMismatchError;
		expect(mismatch.iteration).toBe(1);
		expect(mismatch.callIndex).toBe(0);
		expect(mismatch.divergences.map((divergence) => divergence.kind)).toEqual([
			"request-system-prompt",
		]);
		expect(mismatch.message).toContain(
			"Replay request does not match the recording at iteration 1 (model call 0",
		);
		expect(mismatch.message).toContain(
			"system prompt differs at line 1, column 11",
		);
		expect(mismatch.message).toContain("- recorded");
		expect(mismatch.message).toContain("You are a test agent.");
		expect(mismatch.message).toContain("You are a changed test agent.");
		// A refused request consumes nothing.
		expect(
			served(
				source.nextModelResponse({
					request: live(session.sent[0] as AgentModelRequest),
				}),
			).record.callIndex,
		).toBe(0);
	});

	it("fails strict replay when only the model id differs", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		expect(() =>
			source.nextModelResponse({
				request: live(session.sent[0] as AgentModelRequest, "other-model"),
			}),
		).toThrow(
			/request-model · model differs: recorded fake-model, live other-model/,
		);
	});

	it("falls back by callIndex in lenient mode and reports the diff", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session, {
			strictness: "lenient",
		});
		const response = served(
			source.nextModelResponse({
				request: live(withSystemPrompt(session.sent[0], "Changed.")),
			}),
		);
		expect(response.match).toBe("call-index");
		expect(response.record.callIndex).toBe(0);
		expect(response.divergences).toMatchObject([
			{ kind: "request-system-prompt", iteration: 1, counted: true },
		]);
		const explicit = served(
			source.nextModelResponse({
				request: live(withSystemPrompt(session.sent[2], "Changed.")),
				position: { callIndex: 2 },
			}),
		);
		expect(explicit.record.callIndex).toBe(2);
	});

	it("falls back by run, iteration and attempt", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session, {
			strictness: "lenient",
		});
		const response = served(
			source.nextModelResponse({
				request: live(withSystemPrompt(session.sent[1], "Changed.")),
				position: { runId: "run_live_elsewhere", iteration: 2, attempt: 0 },
			}),
		);
		expect(response.match).toBe("position");
		expect(response.record.callIndex).toBe(1);
		expect(source.remaining().modelCalls).toEqual([0, 2]);
	});

	it("reports misses: thrown in strict mode, returned in lenient mode", async () => {
		const session = await recordFixtureSession([{ text: "Hi." }]);
		const request = live(session.sent[0] as AgentModelRequest);
		const strict = createSessionReplaySource(session);
		strict.nextModelResponse({ request });
		expect(() => strict.nextModelResponse({ request })).toThrow(
			/all 1 recorded model calls of session sess_replay were already served/,
		);
		const lenient = createSessionReplaySource(session, {
			strictness: "lenient",
		});
		lenient.nextModelResponse({ request });
		expect(lenient.nextModelResponse({ request })).toEqual({
			status: "missing",
			reason:
				"all 1 recorded model calls of session sess_replay were already served",
		});
	});
});

describe("SessionReplaySource tool results and decisions", () => {
	it("serves tool results by toolCallId with iteration, seq and environment", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		expect(source.toolEnvironment("call_ls")).toEqual({
			version: 1,
			commands: { cwd: "/w" },
		});
		const result = source.toolResult("call_ls");
		expect(result).toMatchObject({
			toolCallId: "call_ls",
			toolName: "run_commands",
			content: "notes.txt",
			isError: false,
			iteration: 1,
			environment: { version: 1, commands: { cwd: "/w" } },
		});
		expect(typeof result?.seq).toBe("number");
		expect(source.toolEnvironment("call_ls")).toEqual({
			version: 1,
			commands: { cwd: "/w" },
		});
		expect(source.remaining().toolResults).toEqual(["call_read"]);
		expect(() => source.toolResult("call_ls")).toThrow(
			/Tool call call_ls has no further recorded result \(its recorded result at iteration 1 was already served\)/,
		);
		expect(() => source.toolResult("call_missing")).toThrow(
			/No recorded result for tool call call_missing in session sess_replay/,
		);
		const lenient = createSessionReplaySource(session, {
			strictness: "lenient",
		});
		expect(lenient.toolResult("call_missing")).toBeUndefined();
	});

	it("serves results for a reused tool call id in recorded order", async () => {
		const call = { id: "call_submit", name: "run_commands", input: {} };
		const session = await recordFixtureSession([
			{
				text: "Try.",
				toolCalls: [{ ...call, result: "first", isError: true }],
			},
			{ text: "Again.", toolCalls: [{ ...call, result: "second" }] },
			{ text: "Done." },
		]);
		const source = createSessionReplaySource(session);
		expect(source.toolResult("call_submit")).toMatchObject({
			content: "first",
			isError: true,
			iteration: 1,
		});
		expect(source.toolResult("call_submit")).toMatchObject({
			content: "second",
			isError: false,
			iteration: 2,
		});
	});

	it("returns decisions due before each model call by seq", async () => {
		const session = await recordFixtureSession();
		const source = createSessionReplaySource(session);
		expect(
			source.decisionsDue({ callIndex: 0 }).map((event) => event.name),
		).toEqual(["prompt_delivered"]);
		expect(source.decisionsDue({ callIndex: 0 })).toEqual([]);
		const due = source.decisionsDue({ callIndex: 1 });
		expect(due.map((event) => [event.name, event.toolCallId])).toEqual([
			["approval_resolved", "call_ls"],
		]);
		expect(source.remaining().decisions).toBe(0);
	});
});

describe("SessionReplaySource by call index", () => {
	it("serves the transcript's model calls in order when the session has no request records", async () => {
		const recorded = await recordFixtureSession();
		const imported = {
			transcript: {
				...recorded.transcript,
				messages: recorded.transcript.messages.map((message, index) =>
					message.role === "assistant"
						? {
								...message,
								metrics: { inputTokens: 10 * index, outputTokens: 2 },
							}
						: message,
				),
			},
			events: [],
			requests: [],
			blobs: new Map(),
		};
		const source = createSessionReplaySource(imported);
		expect(source.mode).toBe("call-index");
		const unrelated = live({
			...(recorded.sent[0] as AgentModelRequest),
			systemPrompt: "A different system prompt.",
		});
		const responses = [0, 1, 2].map((index) =>
			served(
				source.nextModelResponse({
					request:
						index === 1
							? live(recorded.sent[1] as AgentModelRequest)
							: unrelated,
				}),
			),
		);
		expect(
			responses.map((response) => [
				response.match,
				response.iteration,
				response.record.callIndex,
				response.record.response.messageId,
				response.divergences,
			]),
		).toEqual([
			["call-index", 1, 0, "assistant_1", []],
			["call-index", 2, 1, "assistant_2", []],
			["call-index", 3, 2, "assistant_3", []],
		]);
		expect(responses[0]?.events.map((event) => event.event)).toEqual([
			{ type: "text-delta", text: "Listing files." },
			{
				type: "tool-call-delta",
				toolCallId: "call_ls",
				toolName: "run_commands",
				input: { commands: ["ls"] },
			},
			{ type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
			{ type: "finish", reason: "tool-calls" },
		]);
		expect(responses[2]?.record.response.finishReason).toBe("stop");
		expect(source.toolResult("call_read")).toMatchObject({
			toolName: "read_files",
			content: "remember the milk",
			iteration: 2,
		});
		expect(() => source.nextModelResponse({ request: unrelated })).toThrow(
			/all 3 recorded model calls of session sess_replay were already served/,
		);
	});

	it("serves the record at the live call index", async () => {
		const recorded = await recordFixtureSession();
		const source = createSessionReplaySource(
			{ ...recorded, requests: [], blobs: new Map() },
			{ strictness: "lenient" },
		);
		const request = live(recorded.sent[0] as AgentModelRequest);
		expect(
			served(source.nextModelResponse({ request, position: { callIndex: 2 } }))
				.record.response.messageId,
		).toBe("assistant_3");
		expect(source.remaining().modelCalls).toEqual([0, 1]);
		expect(
			source.nextModelResponse({ request, position: { callIndex: 2 } }),
		).toMatchObject({ status: "missing" });
	});

	it("serves a recording in call order without comparing requests when asked to", async () => {
		const recorded = await recordFixtureSession();
		const byKey = createSessionReplaySource(recorded);
		expect(byKey.mode).toBe("match-key");
		const source = createSessionReplaySource(recorded, { mode: "call-index" });
		const changed = live(
			withSystemPrompt(recorded.sent[0], "A different system prompt."),
		);
		const response = served(source.nextModelResponse({ request: changed }));
		expect(response).toMatchObject({ match: "call-index", divergences: [] });
		expect(response.record).toBe(
			recorded.requests.find((record) => record.callIndex === 0),
		);
		expect(() => byKey.nextModelResponse({ request: changed })).toThrow(
			SessionReplayMismatchError,
		);
	});
});
