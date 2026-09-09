import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sharedSessionArtifactPath } from "../paths";
import { readSessionMessages } from "./messages";
import {
	preserveMistakeToolResults,
	readMistakeToolResults,
} from "./mistake-tool-results";

describe("mistake recovery tool results", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "mistake-results-"));
		vi.stubEnv("CLINE_SESSION_DATA_DIR", root);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	});
	const result = {
		messageId: "assistant-1",
		toolCallId: "call-1",
		toolName: "editor",
		output: { error: "old_text is required" },
		isError: true,
	};
	function read(
		sessionId = "session-1",
		messageId = "assistant-1",
		canonical = false,
	) {
		const messages: unknown[] = [
			{
				id: messageId,
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call-1",
						name: "editor",
						input: { path: "a.txt" },
					},
				],
			},
		];
		if (canonical)
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: "canonical result",
						is_error: false,
					},
				],
			});
		return readSessionMessages(
			{ liveSessions: new Map([[sessionId, { messages }]]) } as Parameters<
				typeof readSessionMessages
			>[0],
			sessionId,
		) as Promise<Array<{ content: string; meta: { hookEventName: string } }>>;
	}
	it("fills only the exact missing result and preserves canonical history", async () => {
		preserveMistakeToolResults("session-1", [result]);
		const [recovered] = await read();
		expect(recovered.meta.hookEventName).toBe("history_tool_result");
		expect(JSON.parse(recovered.content)).toMatchObject({
			input: { path: "a.txt" },
			result: { error: "old_text is required" },
			isError: true,
		});
		const [canonical] = await read("session-1", "assistant-1", true);
		expect(JSON.parse(canonical.content)).toMatchObject({
			result: "canonical result",
			isError: false,
		});
	});
	it("does not alter another session or a later reuse of the same tool id", async () => {
		preserveMistakeToolResults("session-1", [result]);
		for (const messages of [
			await read("other-session"),
			await read("session-1", "later-assistant"),
		]) {
			expect(messages[0].meta.hookEventName).toBe("history_tool_use");
			expect(JSON.parse(messages[0].content).result).toBeNull();
		}
	});

	it("prefers an actual result that arrives after the stopped-batch notice", async () => {
		preserveMistakeToolResults("session-1", [
			{ ...result, output: "No result available yet" },
		]);
		preserveMistakeToolResults("session-1", [result]);
		const [message] = await read();
		expect(JSON.parse(message.content).result).toEqual(result.output);
	});
	it("tolerates incomplete records without dropping valid results", () => {
		preserveMistakeToolResults("session-1", [result]);
		appendFileSync(
			sharedSessionArtifactPath("session-1", "desktop-mistake-tools.jsonl"),
			'\n{"incomplete":\nnull\n{}\n',
		);
		expect(readMistakeToolResults("session-1")).toEqual([result]);
	});
});
