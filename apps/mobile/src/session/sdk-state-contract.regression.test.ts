import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionState,
	reduceSession,
	selectViewModel,
	type SessionState,
} from "./reducer";
import { parseSessionMessagesReply } from "./schemas";
let sequence = 0;
function event(
	state: SessionState,
	name: HubEventEnvelope["event"],
	payload: Record<string, unknown> = {},
	timestamp = ++sequence,
): SessionState {
	return reduceSession(state, {
		type: "event",
		envelope: {
			version: "v1",
			event: name,
			eventId: `sdk-contract-${++sequence}`,
			timestamp,
			payload,
		},
	});
}
const waitingTool = [
	{
		role: "assistant" as const,
		content: [
			{
				type: "tool_use" as const,
				id: "waiting",
				name: "run_command",
				input: { command: "slow build" },
			},
		],
	},
];
function hydrate(state: SessionState): SessionState {
	return reduceSession(reduceSession(state, { type: "hydrate_started" }), {
		type: "hydrated",
		messages: waitingTool,
		runStatus: "running",
	});
}
const tool = (state: SessionState) =>
	selectViewModel(state)
		.messages.flatMap((message) => message.blocks)
		.find((block) => block.kind === "tool");
describe("actual SDK persisted state contracts", () => {
	it("finishes a tool whose assistant-message was persisted before its result", () => {
		let state = hydrate(createSessionState());
		state = event(state, "tool.updated", {
			toolCallId: "waiting",
			update: { stream: "stdout", chunk: "building" },
		});
		expect(tool(state)).toMatchObject({ state: "running", output: "building" });
		state = event(state, "tool.finished", {
			toolCallId: "waiting",
			output: "built",
		});
		expect(tool(state)).toMatchObject({ state: "completed", output: "built" });
		expect(
			selectViewModel(state)
				.messages.flatMap((message) => message.blocks)
				.filter((block) => block.kind === "tool"),
		).toHaveLength(1);
	});
	it("keeps a known live result when a refreshed assistant-message still lacks its tool result", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		state = event(state, "run.started");
		state = event(state, "tool.started", {
			toolCallId: "waiting",
			toolName: "run_command",
		});
		state = event(state, "tool.finished", {
			toolCallId: "waiting",
			output: "built",
		});
		state = hydrate(state);
		expect(tool(state)).toMatchObject({ state: "completed", output: "built" });
	});
	it("keeps the active code segment and timer when a second input is only admitted to the queue", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		state = event(state, "run.started", {}, 1000);
		state = event(state, "assistant.delta", { text: "```ts\nconst a" });
		state = reduceSession(state, {
			type: "user_input",
			text: "next task",
			timestamp: 2000,
		});
		state = event(state, "run.started", {}, 2000);
		state = event(state, "assistant.delta", { text: " = 1;\n```" });
		state = reduceSession(state, { type: "send_queued", messageId: "u1" });
		const view = selectViewModel(state);
		expect(
			view.messages.filter((message) => message.role === "assistant"),
		).toHaveLength(1);
		expect(view.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "```ts\nconst a = 1;\n```" },
		]);
		expect(view.lastRun?.startedAt).toBe(1000);
	});
	it("projects the SDK ts field as the displayed message time", () => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "user",
					content: "saved ask",
					ts: 1761600000000,
					createdAt: 123,
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("Invalid SDK history");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(selectViewModel(state).messages[0]?.createdAt).toBe(1761600000000);
	});
	it("keeps metadata-only provider tool activity when no assistant text was produced", () => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "assistant",
					content: [],
					ts: 1761600000000,
					metadata: {
						modelToolActivities: [
							{
								toolCallId: "provider-search",
								toolName: "web_search",
								execution: "provider",
								input: { query: "SDK" },
								output: "result",
								isError: false,
							},
						],
					},
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("Invalid SDK history");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		expect(tool(state)).toMatchObject({
			toolCallId: "provider-search",
			name: "web_search",
			state: "completed",
			input: { query: "SDK" },
			output: "result",
		});
		expect(selectViewModel(state).messages[0]?.createdAt).toBe(1761600000000);
	});
	it("starts a separate assistant turn only when a queued prompt is actually submitted", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		state = event(state, "run.started", {}, 1000);
		state = event(state, "assistant.finished", { text: "first answer" });
		state = event(state, "run.started", {}, 2000);
		state = event(state, "run.completed", { snapshot: { status: "running" } });
		state = reduceSession(state, {
			type: "user_input",
			startsTurn: true,
			text: "submitted queued prompt",
			timestamp: 3000,
		});
		state = event(state, "assistant.delta", { text: "second answer" });
		const view = selectViewModel(state);
		expect(view.messages.map((message) => message.role)).toEqual([
			"assistant",
			"user",
			"assistant",
		]);
		expect(view.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "first answer" },
		]);
		expect(view.messages[2]?.blocks).toEqual([
			{ kind: "text", text: "second answer" },
		]);
		expect(view.lastRun?.startedAt).toBe(3000);
	});
	it("replays a queued submission after earlier buffered output instead of moving that output into the new turn", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = event(state, "run.started");
		state = event(state, "assistant.finished", { text: "first answer" });
		state = event(state, "run.completed", { snapshot: { status: "running" } });
		state = event(state, "session.pending_prompt_submitted", {
			prompt: {
				id: "queued-real",
				prompt: "next task",
				delivery: "queue",
				attachmentCount: 0,
			},
		});
		state = event(state, "assistant.delta", { text: "second answer" });
		state = reduceSession(state, {
			type: "hydrated",
			messages: [],
			runStatus: "running",
		});
		const messages = selectViewModel(state).messages;
		expect(messages.map((message) => message.role)).toEqual([
			"assistant",
			"user",
			"assistant",
		]);
		expect(messages[0]?.blocks).toEqual([
			{ kind: "text", text: "first answer" },
		]);
		expect(messages[2]?.blocks).toEqual([
			{ kind: "text", text: "second answer" },
		]);
	});
});

describe("native question chronology after hydration", () => {
	function firstCompletedTurn() {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [],
		});
		state = reduceSession(state, {
			type: "user_input",
			text: "IOS_FIXED_1131",
		});
		state = event(state, "run.started");
		state = event(state, "reasoning.delta", {
			text: "Reasoning omitted by older persisted history",
		});
		state = event(state, "reasoning.finished", {
			reasoning: "Reasoning omitted by older persisted history",
		});
		state = event(state, "assistant.finished", { text: "First response" });
		return event(state, "run.completed");
	}
	it("places an answer after its pending user prompt when hydration removed the empty current assistant row", () => {
		let state = firstCompletedTurn();
		state = reduceSession(state, { type: "user_input", text: "ask-question" });
		state = event(state, "run.started");
		state = reduceSession(state, {
			type: "question_requested",
			question: {
				requestId: "question-32",
				question: "Which response?",
				options: ["Yes", "No"],
			},
		});
		state = reduceSession(reduceSession(state, { type: "hydrate_started" }), {
			type: "hydrated",
			runStatus: "running",
			messages: [
				{ role: "user", content: "IOS_FIXED_1131" },
				{ role: "assistant", content: "First response" },
			],
		});
		state = reduceSession(state, {
			type: "question_resolved",
			requestId: "question-32",
		});
		state = event(state, "assistant.delta", { text: "Selected answer" });
		state = event(state, "assistant.finished", { text: "Selected answer" });
		const messages = selectViewModel(state).messages;
		const promptIndex = messages.findIndex(
			(message) =>
				message.role === "user" &&
				message.blocks.some(
					(block) => block.kind === "text" && block.text === "ask-question",
				),
		);
		const answerIndex = messages.findIndex((message) =>
			message.blocks.some(
				(block) => block.kind === "text" && block.text === "Selected answer",
			),
		);
		expect(promptIndex).toBeGreaterThanOrEqual(0);
		expect(answerIndex).toBeGreaterThan(promptIndex);
	});
	it("starts a new immediate answer after its user even if session.updated running preceded run.started", () => {
		let state = firstCompletedTurn();
		state = reduceSession(state, {
			type: "user_input",
			text: "second immediate ask",
		});
		state = event(state, "session.updated", {
			session: { sessionId: "sdk-contract", status: "running" },
		});
		state = event(state, "run.started");
		state = event(state, "assistant.delta", {
			text: "Second immediate answer",
		});
		const messages = selectViewModel(state).messages;
		const promptIndex = messages.findIndex(
			(message) =>
				message.role === "user" &&
				message.blocks.some(
					(block) =>
						block.kind === "text" && block.text === "second immediate ask",
				),
		);
		const answerIndex = messages.findIndex((message) =>
			message.blocks.some(
				(block) =>
					block.kind === "text" && block.text === "Second immediate answer",
			),
		);
		expect(answerIndex).toBeGreaterThan(promptIndex);
	});
});

describe("final hydration ordering contracts", () => {
	it("consumes a buffered submitted prompt already present in the returning snapshot once", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: [
				{ role: "user", content: "first" },
				{ role: "assistant", content: "first answer" },
			],
		});
		state = reduceSession(state, { type: "hydrate_started" });
		state = event(state, "session.pending_prompt_submitted", {
			prompt: {
				id: "p-next",
				prompt: "next",
				delivery: "queue",
				attachmentCount: 0,
			},
		});
		const messages = [
			{ role: "user" as const, content: "first" },
			{ role: "assistant" as const, content: "first answer" },
			{ role: "user" as const, content: "next" },
			{ role: "assistant" as const, content: "next answer" },
		];
		state = reduceSession(state, {
			type: "hydrated",
			messages,
			runStatus: "running",
		});
		state = reduceSession(reduceSession(state, { type: "hydrate_started" }), {
			type: "hydrated",
			messages,
			runStatus: "running",
		});
		expect(
			selectViewModel(state).messages.filter(
				(message) =>
					message.role === "user" &&
					message.blocks.some(
						(block) => block.kind === "text" && block.text === "next",
					),
			),
		).toHaveLength(1);
	});
	it("keeps the new streamed prefix when an unrelated earlier user turn contains that text", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = event(state, "assistant.delta", { text: "Let me" }, 3000);
		state = reduceSession(state, {
			type: "hydrated",
			runStatus: "running",
			messages: [
				{ role: "user", content: "old ask", ts: 1000 },
				{ role: "assistant", content: "Let me check the old file.", ts: 2000 },
				{ role: "user", content: "new ask", ts: 2500 },
			],
		});
		state = event(
			state,
			"assistant.delta",
			{ text: " inspect the new file." },
			3500,
		);
		expect(
			selectViewModel(state).messages.some((message) =>
				message.blocks.some(
					(block) =>
						block.kind === "text" &&
						block.text === "Let me inspect the new file.",
				),
			),
		).toBe(true);
	});
	it("keeps a newer repeated prefix even after the same current user already had an earlier persisted iteration", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = event(state, "assistant.delta", { text: "Let me" }, 3000);
		state = reduceSession(state, {
			type: "hydrated",
			runStatus: "running",
			messages: [
				{ role: "user", content: "current ask", ts: 1000 },
				{
					role: "assistant",
					content: "Let me check the first step.",
					ts: 2000,
				},
			],
		});
		state = event(
			state,
			"assistant.delta",
			{ text: " check the next step." },
			3500,
		);
		expect(
			selectViewModel(state).messages.some((message) =>
				message.blocks.some(
					(block) =>
						block.kind === "text" &&
						block.text === "Let me check the next step.",
				),
			),
		).toBe(true);
	});
	it("does reconcile a fragment when the same current iteration was persisted after that fragment streamed", () => {
		let state = reduceSession(createSessionState(), {
			type: "hydrate_started",
		});
		state = event(state, "assistant.delta", { text: "Let me" }, 2000);
		state = reduceSession(state, {
			type: "hydrated",
			runStatus: "running",
			messages: [
				{ role: "user", content: "current ask", ts: 1000 },
				{
					role: "assistant",
					content: "Let me check the current file.",
					ts: 3000,
				},
			],
		});
		expect(
			selectViewModel(state)
				.messages.flatMap((message) => message.blocks)
				.filter((block) => block.kind === "text" && block.text === "Let me"),
		).toHaveLength(0);
	});
});
