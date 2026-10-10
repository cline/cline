import type { ImageContent, Message, ToolResultContent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createReadFilesTool } from "../../extensions/tools/definitions";
import type { ReadFileRequest } from "../../extensions/tools/schemas";
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
	it.each([
		"structured",
		"serialized",
	])("keeps colliding display labels independent in %s read results", async (format) => {
		const cases: ReadFileRequest[][] = [
			[{ path: "/tmp/foo@6000" }, { path: "/tmp/foo" }],
			[{ path: "/tmp/foo@6000" }, { path: "/tmp/foo", start_offset: 6000 }],
			[
				{ path: "/tmp/foo:1-2" },
				{ path: "/tmp/foo", start_line: 1, end_line: 2 },
			],
		];
		for (const requests of cases) {
			const messages: Message[] = [];
			const context = { agentId: "agent", iteration: 1 };
			const builder = new MessageBuilder({ minOutdatedRewriteBytes: 0 });
			for (const [index, request] of [...requests, requests[0]].entries()) {
				const tool = createReadFilesTool(async () => `record-content-${index}`);
				const input = { files: [request] };
				const output = await tool.execute(input, context);
				messages.push(
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: `record-${index}`,
								name: "read_files",
								input,
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: `record-${index}`,
								name: "read_files",
								content: (format === "serialized"
									? JSON.stringify(output)
									: output) as ToolResultContent["content"],
							},
						],
					},
				);
				const prepared = JSON.stringify(builder.buildForApi(messages));
				if (index === 1) {
					expect(prepared).toContain("record-content-0");
					expect(prepared).toContain("record-content-1");
				} else if (index === 2) {
					expect(prepared).not.toContain("record-content-0");
					expect(prepared).toContain("record-content-1");
					expect(prepared).toContain("record-content-2");
				}
			}
		}
	});
	it("keeps distinct offset pages and only replaces repeated pages as outdated", () => {
		const messages: Message[] = [0, 1000, 0].flatMap(
			(offset, index): Message[] => [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: `page-${index}`,
							name: "read_files",
							input: {
								files: [
									{
										path: "/tmp/minified.js",
										start_offset: offset,
									},
								],
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: `page-${index}`,
							name: "read_files",
							content: JSON.stringify([
								{
									path: "/tmp/minified.js",
									start_offset: offset,
									query: `/tmp/minified.js@${offset}`,
									success: true,
									result: `page-content-${index}`,
								},
							]),
						},
					],
				},
			],
		);
		const prepared = JSON.stringify(
			new MessageBuilder({ minOutdatedRewriteBytes: 0 }).buildForApi(messages),
		);
		expect(prepared).not.toContain("page-content-0");
		expect(prepared).toContain("page-content-1");
		expect(prepared).toContain("page-content-2");
	});
	it("keeps offset pages read after a default read but invalidates them after a newer full read", () => {
		const messages: Message[] = [null, 0, 1000].flatMap(
			(offset, index): Message[] => [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: `read-${index}`,
							name: "read_files",
							input: {
								files: [
									{
										path: "/tmp/minified.js",
										...(offset == null ? {} : { start_offset: offset }),
									},
								],
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: `read-${index}`,
							name: "read_files",
							content: JSON.stringify([
								{
									path: "/tmp/minified.js",
									start_offset: offset,
									query:
										offset == null
											? "/tmp/minified.js"
											: `/tmp/minified.js@${offset}`,
									success: true,
									result: `read-content-${index}`,
								},
							]),
						},
					],
				},
			],
		);
		const builder = new MessageBuilder({ minOutdatedRewriteBytes: 0 });
		const first = JSON.stringify(builder.buildForApi(messages));
		expect(first).toContain("read-content-1");
		expect(first).toContain("read-content-2");
		messages.push(
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "latest",
						name: "read_files",
						input: { files: [{ path: "/tmp/minified.js" }] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "latest",
						name: "read_files",
						content: JSON.stringify([
							{
								path: "/tmp/minified.js",
								query: "/tmp/minified.js",
								success: true,
								result: "latest-file",
							},
						]),
					},
				],
			},
		);
		const latest = JSON.stringify(builder.buildForApi(messages));
		expect(latest).not.toContain("read-content-1");
		expect(latest).not.toContain("read-content-2");
		expect(latest).toContain("latest-file");
	});
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
