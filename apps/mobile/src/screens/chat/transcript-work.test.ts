import { describe, expect, it } from "vitest";
import type { SessionMessageView } from "@/session";
import { buildTranscriptWork } from "./transcript-work";

describe("transcript work projection", () => {
	it("keeps unique row identities and chronological blocks around live media without mutating source", () => {
		const messages: SessionMessageView[] = [
			{
				id: "live",
				role: "assistant",
				origin: "live",
				blocks: [
					{ kind: "text", text: "Before" },
					{
						kind: "media",
						media: {
							id: "image",
							modality: "image",
							mediaType: "image/png",
							source: { type: "base64", data: "aA==" },
						},
					},
					{ kind: "text", text: "After" },
					{ kind: "reasoning", text: "Working", redacted: false },
				],
			},
		];
		const before = JSON.stringify(messages);
		const rows = buildTranscriptWork(messages, { runStatus: "running" });
		expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
		expect(rows.flatMap((row) => row.blocks)).toEqual(messages[0]!.blocks);
		expect(JSON.stringify(messages)).toBe(before);
	});
	it("does not invent work summaries for pure prose or an answerless trailing tool", () => {
		const messages: SessionMessageView[] = [
			{
				id: "a",
				role: "assistant",
				origin: "live",
				blocks: [
					{ kind: "text", text: "Checking" },
					{
						kind: "tool",
						toolCallId: "t",
						name: "read_file",
						state: "completed",
						output: "file",
					},
				],
			},
		];
		expect(
			buildTranscriptWork(messages, { runStatus: "completed" }).some(
				(row) => row.work,
			),
		).toBe(false);
		expect(
			buildTranscriptWork(
				[
					{
						...messages[0]!,
						blocks: [{ kind: "text", text: "A direct answer" }],
					},
				],
				{ runStatus: "completed" },
			).some((row) => row.work),
		).toBe(false);
	});
	it("does not fold reasoning or tools into an explicit runtime error deliverable", () => {
		const messages: SessionMessageView[] = [
			{
				id: "a",
				role: "assistant",
				origin: "live",
				blocks: [
					{ kind: "text", text: "Checking" },
					{
						kind: "tool",
						toolCallId: "t",
						name: "read_file",
						state: "completed",
					},
				],
			},
			{
				id: "error",
				role: "assistant",
				displayRole: "error",
				origin: "hydrated",
				blocks: [{ kind: "text", text: "Provider unavailable" }],
			},
		];
		const rows = buildTranscriptWork(messages, { runStatus: "failed" });
		expect(rows.some((row) => row.work)).toBe(false);
		expect(rows.at(-1)?.displayRole).toBe("error");
	});
});
