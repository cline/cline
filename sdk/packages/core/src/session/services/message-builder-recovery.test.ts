import type { ImageContent, Message, ToolResultContent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./message-builder";

function history(
	content: ToolResultContent["content"],
	name = "gmail_fetch_emails",
): Message[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool_use", id: "call", name, input: {} }],
		},
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "call", name, content }],
		},
	];
}
function result(messages: Message[]): ToolResultContent {
	for (const message of messages)
		if (Array.isArray(message.content))
			for (const block of message.content)
				if (block.type === "tool_result") return block;
	throw new Error("Missing tool result");
}

describe("synchronous model-only recovery", () => {
	it("keeps buildForApi synchronous and preserves canonical history", () => {
		const full = "original response\n".repeat(1000);
		const messages = history(full);
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			getToolResultRecovery: () => ({
				uri: "cline://cache/session/result.result.txt",
			}),
		});
		const prepared = builder.buildForApi(messages);
		expect(prepared).not.toBeInstanceOf(Promise);
		expect(JSON.stringify(result(prepared))).toContain(
			"cline://cache/session/result.result.txt",
		);
		expect(JSON.stringify(result(prepared))).not.toContain(full);
		expect(result(messages).content).toBe(full);
	});

	it("bounds structured results made of many small fields without a live cache URI", () => {
		const rows = Array.from({ length: 300 }, (_, id) => ({
			id,
			title: "small item",
		}));
		const messages = history(rows as unknown as ToolResultContent["content"]);
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			getToolResultRecovery: () => ({}),
		});
		const content = result(builder.buildForApi(messages)).content as Array<{
			text?: string;
		}>;
		expect(
			content.reduce((chars, entry) => chars + (entry.text?.length ?? 0), 0),
		).toBeLessThanOrEqual(500);
		expect(result(messages).content).toBe(rows);
	});

	it("preserves native images with oversized text", () => {
		const image: ImageContent = {
			type: "image",
			data: "aGVsbG8=",
			mediaType: "image/png",
		};
		const messages = history([
			{ type: "text", text: "x".repeat(10000) },
			image,
		]);
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			getToolResultRecovery: () => ({
				uri: "cline://cache/session/result.result.txt",
			}),
		});
		expect(result(builder.buildForApi(messages)).content).toContainEqual(image);
		expect(result(messages).content).toContainEqual(image);
	});

	it("leaves tools without a recovery policy on the original projection", () => {
		const rows = [{ query: "run", result: "x".repeat(10000), success: true }];
		const messages = history(
			rows as unknown as ToolResultContent["content"],
			"team_list_runs",
		);
		const builder = new MessageBuilder({ maxToolResultChars: 500 });
		expect(result(builder.buildForApi(messages)).content).toMatchObject([
			{ query: "run", success: true },
		]);
	});

	it.each([
		40, 1000,
	])("keeps an expired result bounded by a %i-byte aggregate budget", (maxTotalTextBytes) => {
		const messages = history("x".repeat(500000));
		const builder = new MessageBuilder({
			maxTotalTextBytes,
			getToolResultRecovery: () => ({}),
		});
		const content = result(builder.buildForApi(messages)).content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((entry) => entry.type === "text")
						.map((entry) => entry.text)
						.join("");
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(maxTotalTextBytes);
		expect(text).not.toContain("cline://cache/");
		expect(result(messages).content).toHaveLength(500000);
	});

	it("protects generated instructions within the aggregate budget", () => {
		const uri = "cline://cache/session/result.result.txt";
		const builder = new MessageBuilder({
			maxToolResultChars: 1000,
			maxTotalTextBytes: 1000,
			getToolResultRecovery: () => ({ uri }),
		});
		const prepared = builder.buildForApi(history("x".repeat(10000)));
		expect(JSON.stringify(result(prepared))).toContain(uri);
		const entries = result(prepared).content as Array<{ text?: string }>;
		expect(
			entries.some((entry) => entry.text?.includes("provider request budget")),
		).toBe(true);
		expect(
			entries.reduce(
				(bytes, entry) => bytes + Buffer.byteLength(entry.text ?? ""),
				0,
			),
		).toBeLessThanOrEqual(1000);
	});
});
