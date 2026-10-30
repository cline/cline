import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { SideVisibleContextSchema } from "../../../shared/side-conversation";
import { captureVisibleSideContext } from "./visible-context";

const row = (
	id: string,
	role: ChatMessage["role"],
	content: string,
): ChatMessage => ({ id, role, content, sessionId: "parent", createdAt: 1 });

describe("visible side context", () => {
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
