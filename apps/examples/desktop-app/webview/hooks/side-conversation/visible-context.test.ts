import { SideVisibleContextSchema } from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { buildToolPayloadString } from "../chat-session/helpers";
import { captureVisibleSideContext } from "./visible-context";

const row = (
	id: string,
	role: ChatMessage["role"],
	content: string,
): ChatMessage => ({ id, role, content, sessionId: "parent", createdAt: 1 });

describe("visible side context", () => {
	it("never falls back to raw media when a structured tool observation exceeds projection limits", () => {
		let checked = 0;
		for (const depth of [1000, 3000, 5000]) {
			const output: unknown = JSON.parse(
				`{"nested":${"[".repeat(depth)}null${"]".repeat(depth)},"media":{"type":"image","data":"NESTED_IMAGE","mediaType":"image/png"}}`,
			);
			let content: string;
			try {
				content = buildToolPayloadString({
					toolName: "deep_report",
					input: {},
					output,
				});
			} catch (error) {
				// Only exercise observations the engine can actually produce.
				if (error instanceof RangeError) continue;
				throw error;
			}
			const capture = captureVisibleSideContext({
				messages: [
					row("current", "user", "Parent goal remains"),
					{
						...row("deep", "tool", content),
						meta: {
							hookEventName: "tool_call_end",
							toolOutput: "ordinary streamed text",
						},
					},
					row("later", "assistant", "Later fact remains"),
				],
				sessionId: "parent",
				environmentId: "local",
				queuedIds: new Set(),
				unconfirmedIds: new Set(),
			});
			const deep = capture.excerpts.find(
				(excerpt) => excerpt.messageId === "deep",
			);
			expect(deep).toBeDefined();
			const omitted = deep?.text.includes("content omitted");
			if (omitted) {
				expect(deep?.omittedBytes).toBeGreaterThan(0);
				expect(deep?.text).not.toContain("ordinary streamed text");
			} else {
				// A safely formatted observation keeps its ordinary streamed text.
				expect(deep?.text).toContain("[media omitted]");
				expect(deep?.text).toContain("ordinary streamed text");
			}
			expect(deep?.text).not.toContain("NESTED_IMAGE");
			expect(capture.excerpts.map((entry) => entry.text).join("\n")).toContain(
				"Parent goal remains",
			);
			expect(capture.excerpts.map((entry) => entry.text).join("\n")).toContain(
				"Later fact remains",
			);
			expect(SideVisibleContextSchema.safeParse(capture).success).toBe(true);
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it.each([
		8, 200,
	])("reads only retained content once the excerpt cap is reached (%i messages)", (count) => {
		let reads = 0;
		const capture = captureVisibleSideContext({
			messages: [
				row("current", "user", "current question"),
				...Array.from(
					{ length: count },
					(_, index): ChatMessage => ({
						...row(`answer-${index}`, "assistant", ""),
						get content() {
							reads++;
							return `answer ${index}`;
						},
					}),
				),
			],
			sessionId: "parent",
			environmentId: "local",
			queuedIds: new Set(),
			unconfirmedIds: new Set(),
		});
		expect(reads).toBe(Math.min(count, 11));
		expect(capture.excerpts.at(-1)?.text).toBe(`answer ${count - 1}`);
		expect(capture.excerpts[0].text).toBe("current question");
		expect(capture.omittedExcerptCount).toBe(Math.max(0, count - 11));
		expect(SideVisibleContextSchema.safeParse(capture).success).toBe(true);
	});

	it("captures only the current source run, excludes queued identities and labels uncertain submission", () => {
		const capture = captureVisibleSideContext({
			messages: [
				row("old", "user", "old request"),
				row("old-answer", "assistant", "old answer"),
				row("current", "user", "Review synthetic PR 42"),
				row("answer", "assistant", "Adding bounded retries"),
				row("queued", "user", "not run yet"),
				{ ...row("other", "assistant", "OTHER_SESSION"), sessionId: "other" },
				{ ...row("reasoning", "assistant", ""), reasoning: "HIDDEN_REASONING" },
			],
			sessionId: "parent",
			environmentId: "local",
			queuedIds: new Set(["queued"]),
			unconfirmedIds: new Set(["current"]),
		});
		expect(capture.excerpts.map((entry) => entry.text)).toEqual([
			"Review synthetic PR 42",
			"Adding bounded retries",
		]);
		expect(capture.excerpts[0].submission).toBe("unconfirmed");
		expect(JSON.stringify(capture)).not.toMatch(
			/OTHER_SESSION|HIDDEN_REASONING|not run yet|old request/,
		);
		expect(SideVisibleContextSchema.safeParse(capture).success).toBe(true);
	});

	it("bounds serialized Unicode and tool evidence while removing typed media and cache handles", () => {
		const messages = [
			row("current", "user", "current question"),
			...Array.from({ length: 30 }, (_, index) => ({
				...row(
					`tool-${index}`,
					"tool",
					JSON.stringify({
						result: [
							{
								type: "text",
								text: `HEAD-${index} ${"😀語".repeat(5000)} TAIL-${index}`,
							},
							{ type: "image", data: "SECRET_IMAGE" },
							{ type: "thinking", thinking: "SECRET_THOUGHT" },
							{ type: "text", text: "cline://cache/parent/file" },
						],
					}),
				),
				meta: { toolCallId: `call-${index}`, hookEventName: "tool_call_end" },
			})),
		];
		const capture = captureVisibleSideContext({
			messages,
			sessionId: "parent",
			environmentId: "local",
			queuedIds: new Set(),
			unconfirmedIds: new Set(),
		});
		expect(SideVisibleContextSchema.safeParse(capture).success).toBe(true);
		expect(capture.excerpts[0].text).toBe("current question");
		expect(JSON.stringify(capture)).toContain("HEAD-29");
		expect(JSON.stringify(capture)).toContain("TAIL-29");
		expect(JSON.stringify(capture)).not.toMatch(
			/SECRET_IMAGE|SECRET_THOUGHT|cline:\/\/cache|�/,
		);
		expect(capture.omittedExcerptCount).toBeGreaterThan(0);
	});
});

it("retains a current request even when JSON escaping expands control characters", () => {
	const capture = captureVisibleSideContext({
		messages: [
			row("current", "user", "question " + "\u0001".repeat(20000) + " end"),
		],
		sessionId: "parent",
		environmentId: "local",
		queuedIds: new Set(),
		unconfirmedIds: new Set(),
	});
	expect(SideVisibleContextSchema.safeParse(capture).success).toBe(true);
	expect(capture.excerpts[0]?.text).toContain("question");
	expect(capture.excerpts[0]?.text).toContain("end");
	expect(capture.excerpts[0]?.omittedBytes).toBeGreaterThan(0);
});
