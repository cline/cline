import type { Message } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "./message-builder";

describe("MessageBuilder", () => {
	it("inserts an error tool result before a follow-up prompt when a prior tool call is missing a result", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "inspect the repo" }],
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I will inspect it.",
					},
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: ["session resume"] },
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "please continue" }],
			},
		];

		const result = builder.buildForApi(messages);

		expect(result).toHaveLength(3);
		expect(result[2]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool_1",
					content: [
						{
							type: "text",
							text: "Tool execution was interrupted before a result was produced. Tool: search_codebase.",
						},
					],
					is_error: true,
				},
				{ type: "text", text: "please continue" },
			],
		});
		expect(messages).toHaveLength(3);
	});

	it("fills only missing tool results after existing results for the same assistant turn", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "read",
						input: { path: "/tmp/a.txt" },
					},
					{
						type: "tool_use",
						id: "tool_2",
						name: "bash",
						input: { command: "pwd" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: "contents",
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		];

		const result = builder.buildForApi(messages);

		expect(result).toHaveLength(2);
		const toolResultMessage = result[1];
		expect(Array.isArray(toolResultMessage.content)).toBe(true);
		if (!Array.isArray(toolResultMessage.content)) {
			throw new Error("expected array content");
		}
		expect(toolResultMessage.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "tool_1",
				content: "contents",
			},
			{
				type: "tool_result",
				tool_use_id: "tool_2",
				content: [
					{
						type: "text",
						text: "Tool execution was interrupted before a result was produced. Tool: bash.",
					},
				],
				is_error: true,
			},
			{ type: "text", text: "continue" },
		]);
	});

	it("does not rewrite synthetic read-tool error results as outdated file content", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "read",
						input: { path: "/tmp/a.txt" },
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[1]?.content;
		expect(Array.isArray(content)).toBe(true);
		const block = Array.isArray(content) ? content[0] : undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(block.content).toEqual([
			{
				type: "text",
				text: "Tool execution was interrupted before a result was produced. Tool: read.",
			},
		]);
		expect(block.is_error).toBe(true);
	});

	it("truncates search_codebase tool results before provider requests", () => {
		const builder = new MessageBuilder(100);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "needle" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: "a".repeat(250),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[1].content;
		expect(Array.isArray(content)).toBe(true);
		const block = Array.isArray(content) ? content[0] : undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(block.content.length).toBeLessThanOrEqual(100);
		expect(block.content).toContain("...[truncated");
	});

	it("applies an aggregate text budget across targeted tool results", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			20_000,
		);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "first" },
					},
					{
						type: "tool_use",
						id: "tool_2",
						name: "search_codebase",
						input: { queries: "second" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: "a".repeat(15_000),
					},
					{
						type: "tool_result",
						tool_use_id: "tool_2",
						content: "b".repeat(15_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const totalBytes = result.reduce((sum, message) => {
			if (typeof message.content === "string") {
				return sum + Buffer.byteLength(message.content, "utf8");
			}
			return (
				sum +
				message.content.reduce((inner, block) => {
					if (block.type !== "tool_result") {
						return inner;
					}
					return (
						inner +
						(typeof block.content === "string"
							? Buffer.byteLength(block.content, "utf8")
							: 0)
					);
				}, 0)
			);
		}, 0);

		expect(totalBytes).toBeLessThanOrEqual(20_000);
		expect(JSON.stringify(result)).toContain("provider request budget");
	});

	it("applies the aggregate budget using UTF-8 byte size", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			12_000,
		);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "emoji" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: "🙂".repeat(5_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;

		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(typeof block.content).toBe("string");
		if (typeof block.content !== "string") {
			throw new Error("expected string content");
		}
		expect(Buffer.byteLength(block.content, "utf8")).toBeLessThanOrEqual(
			12_000,
		);
		expect(block.content).toContain("provider request budget");
	});

	it("does not mutate original nested tool result content when applying aggregate budget", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			10_000,
		);
		const originalText = "a".repeat(15_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "first" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: [{ type: "text", text: originalText }],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const originalBlock = Array.isArray(messages[1].content)
			? messages[1].content[0]
			: undefined;
		const resultBlock = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;

		expect(originalBlock?.type).toBe("tool_result");
		expect(resultBlock?.type).toBe("tool_result");
		if (originalBlock?.type !== "tool_result") {
			throw new Error("expected original tool_result");
		}
		if (resultBlock?.type !== "tool_result") {
			throw new Error("expected result tool_result");
		}
		expect(originalBlock.content).toEqual([
			{ type: "text", text: originalText },
		]);
		expect(resultBlock.content).not.toBe(originalBlock.content);
		expect(resultBlock.content).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("provider request budget"),
			}),
		]);
	});

	// CLINE-2183: editor / apply_patch / fetch_web_content / skills were not
	// in the original TARGET_TOOL_NAMES allowlist, so their tool_results
	// bypassed both per-block truncation and the aggregate text budget.
	// A coding-heavy turn could push the outbound request past a model's
	// context window even with compaction enabled.
	it("truncates editor tool results above the per-block limit (CLINE-2183)", () => {
		const builder = new MessageBuilder(100);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "editor",
						input: { path: "/tmp/example.ts", new_text: "x" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						content: "z".repeat(250),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[1].content;
		expect(Array.isArray(content)).toBe(true);
		const block = Array.isArray(content) ? content[0] : undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(
			typeof block.content === "string" ? block.content.length : 0,
		).toBeLessThanOrEqual(100);
		expect(block.content).toContain("...[truncated");
	});

	it("applies the aggregate text budget across editor / apply_patch / fetch_web_content / skills tool results (CLINE-2183)", () => {
		// 1 MB total budget against ~6 MB of input across the four newly
		// covered tools. Use the default TARGET_TOOL_NAMES (omit the
		// second constructor arg) to exercise the constant change itself.
		const builder = new MessageBuilder(50_000, undefined, 1_000_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_editor",
						name: "editor",
						input: { path: "/tmp/a.ts" },
					},
					{
						type: "tool_use",
						id: "tool_patch",
						name: "apply_patch",
						input: { input: "*** Begin Patch" },
					},
					{
						type: "tool_use",
						id: "tool_fetch",
						name: "fetch_web_content",
						input: { requests: [] },
					},
					{
						type: "tool_use",
						id: "tool_skills",
						name: "skills",
						input: { skill: "noop" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_editor",
						content: "e".repeat(1_500_000),
					},
					{
						type: "tool_result",
						tool_use_id: "tool_patch",
						content: "p".repeat(1_500_000),
					},
					{
						type: "tool_result",
						tool_use_id: "tool_fetch",
						content: "f".repeat(1_500_000),
					},
					{
						type: "tool_result",
						tool_use_id: "tool_skills",
						content: "s".repeat(1_500_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const totalBytes = result.reduce((sum, message) => {
			if (typeof message.content === "string") {
				return sum + Buffer.byteLength(message.content, "utf8");
			}
			return (
				sum +
				message.content.reduce((inner, block) => {
					if (block.type !== "tool_result") {
						return inner;
					}
					return (
						inner +
						(typeof block.content === "string"
							? Buffer.byteLength(block.content, "utf8")
							: 0)
					);
				}, 0)
			);
		}, 0);

		// Either path is acceptable: the per-block truncator
		// (`...[truncated N chars]...`) or the aggregate-budget
		// truncator (`...[truncated N chars to fit provider request
		// budget]...`) must have fired and pulled the request well
		// below the configured 1 MB budget. Before CLINE-2183 neither
		// fired for these tools and totalBytes was ~6 MB.
		expect(totalBytes).toBeLessThanOrEqual(1_000_000);
		expect(JSON.stringify(result)).toContain("...[truncated");
	});

	// CLINE-2191 (Layer A): widen MessageBuilder.collectTruncationCandidates
	// beyond tool_result content so user text, assistant text, thinking
	// blocks, and top-level file blocks also participate in the aggregate
	// budget. Also tie the budget to the model's actual maxInputTokens.
	it("truncates user text blocks under the aggregate budget (CLINE-2191)", () => {
		const builder = new MessageBuilder(50_000, undefined, 500_000);
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "x".repeat(5_000_000) }],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		expect(block?.type).toBe("text");
		if (block?.type !== "text") throw new Error("expected text");
		expect(Buffer.byteLength(block.text, "utf8")).toBeLessThanOrEqual(500_000);
		expect(block.text).toContain("provider request budget");
	});

	it("truncates assistant text and thinking blocks under the aggregate budget (CLINE-2191)", () => {
		const builder = new MessageBuilder(50_000, undefined, 250_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "t".repeat(1_000_000) },
					{ type: "text", text: "a".repeat(2_000_000) },
				],
			},
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);
		expect(serialized.length).toBeLessThan(1_000_000);
		expect(serialized).toContain("provider request budget");
		// Both blocks got reduced; neither is the full 2 MB / 1 MB original.
		const content = result[0].content as Array<{ type: string }>;
		const thinking = content.find((b) => b.type === "thinking") as unknown as
			| { thinking: string }
			| undefined;
		const text = content.find((b) => b.type === "text") as unknown as
			| { text: string }
			| undefined;
		if (!thinking || !text) throw new Error("expected both blocks present");
		expect(thinking.thinking.length).toBeLessThan(1_000_000);
		expect(text.text.length).toBeLessThan(2_000_000);
	});

	it("truncates top-level file blocks under the aggregate budget (CLINE-2191)", () => {
		const builder = new MessageBuilder(50_000, undefined, 200_000);
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{
						type: "file",
						path: "/tmp/large.ts",
						content: "y".repeat(4_000_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		expect(block?.type).toBe("file");
		if (block?.type !== "file") throw new Error("expected file");
		// Per-block max (50_000) brings it well under the 200_000 cap.
		expect(Buffer.byteLength(block.content, "utf8")).toBeLessThanOrEqual(
			50_000,
		);
	});

	it("skips tool_use input bodies (CLINE-2191, deferred to Layer B)", () => {
		// Document the intentional deferral: tool_use.input is structured
		// JSON; Layer B will own the structural truncator that avoids
		// corrupting tool_use_id or breaking the JSON shape. Layer A
		// leaves tool_use blocks untouched even when they exceed budget.
		const huge = "z".repeat(4_000_000);
		const builder = new MessageBuilder(50_000, undefined, 100_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_huge",
						name: "editor",
						input: { body: huge },
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		expect(block?.type).toBe("tool_use");
		if (block?.type !== "tool_use") throw new Error("expected tool_use");
		// Input body is unchanged. Layer B will own this.
		expect((block.input as { body: string }).body).toBe(huge);
		expect(block.id).toBe("tool_huge");
	});

	it("derives the aggregate budget from maxInputTokens when provided (CLINE-2191)", () => {
		// 100_000 tokens * 3 chars/token = 300_000 byte budget.
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "p".repeat(2_000_000) }],
			},
		];

		const result = builder.buildForApi(messages, { maxInputTokens: 100_000 });
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (block?.type !== "text") throw new Error("expected text");
		expect(Buffer.byteLength(block.text, "utf8")).toBeLessThanOrEqual(300_000);
		expect(block.text).toContain("...[truncated");
	});

	it("falls back to the constructor default budget when maxInputTokens is absent (CLINE-2191)", () => {
		const builder = new MessageBuilder(50_000, undefined, 250_000);
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "q".repeat(4_000_000) }],
			},
		];

		// No maxInputTokens passed → ctor's 250_000 byte budget applies.
		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (block?.type !== "text") throw new Error("expected text");
		expect(Buffer.byteLength(block.text, "utf8")).toBeLessThanOrEqual(250_000);
	});

	it("produces deterministic output for equal-byte-length candidates (CLINE-2191)", () => {
		// Two candidates of identical byte length. The sort tiebreaker
		// (insertion order) ensures the same input always truncates the
		// same one first, so the output is byte-identical across runs.
		const longA = "a".repeat(500_000);
		const longB = "b".repeat(500_000);
		const build = () => {
			const builder = new MessageBuilder(50_000, undefined, 200_000);
			return builder.buildForApi([
				{
					role: "user",
					content: [
						{ type: "text", text: longA },
						{ type: "text", text: longB },
					],
				},
			]);
		};

		const first = JSON.stringify(build());
		const second = JSON.stringify(build());
		expect(first).toBe(second);
	});

	// CLINE-2192 (Layer B): absolute hard guarantee. These tests use
	// maxInputTokens so MessageBuilder must enforce maxInputTokens * 3
	// bytes after Layer A.
	it("truncates tool_use.input string values without corrupting JSON or tool_use_id (CLINE-2192)", () => {
		const notice = vi.fn();
		const telemetry = { capture: vi.fn() };
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "editor",
						input: { body: "x".repeat(1_000_000), nested: { keep: true } },
					},
				],
			},
		];

		const result = builder.buildForApi(messages, {
			maxInputTokens: 50_000,
			emitStatusNotice: notice,
			telemetry: telemetry as never,
			sessionId: "session-1",
			provider: "openrouter",
			modelId: "anthropic/claude-opus-4.7",
		});
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (block?.type !== "tool_use") throw new Error("expected tool_use");

		expect(block.id).toBe("tool_1");
		expect(block.name).toBe("editor");
		expect((block.input.nested as { keep: boolean }).keep).toBe(true);
		expect((block.input.body as string).length).toBeLessThan(1_000_000);
		expect(
			Buffer.byteLength(JSON.stringify(result), "utf8"),
		).toBeLessThanOrEqual(150_000);
		expect(JSON.parse(JSON.stringify(block.input))).toEqual(block.input);
		expect(notice).toHaveBeenCalledWith(
			"compacted to fit context window",
			expect.objectContaining({ kind: "emergency_truncation" }),
		);
		expect(telemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "task.emergency_truncation",
				properties: expect.objectContaining({ ulid: "session-1" }),
			}),
		);
	});

	it("enforces the hard byte budget when Layer A's floor would otherwise keep too many small blocks (CLINE-2192)", () => {
		const builder = new MessageBuilder();
		const content = Array.from({ length: 200 }, (_, i) => ({
			type: "text" as const,
			text: `${i}:` + "x".repeat(300),
		}));

		const result = builder.buildForApi(
			[{ role: "user", content }],
			{ maxInputTokens: 2_000 }, // 6 KB budget
		);
		const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
		const payloadBytes = (result[0].content as typeof content).reduce(
			(total, block) => total + Buffer.byteLength(block.text, "utf8"),
			0,
		);
		expect(serializedBytes).toBeLessThanOrEqual(6_000);
		expect(payloadBytes).toBeLessThanOrEqual(6_000);
	});

	it("produces deterministic Layer B output for adversarial inputs (CLINE-2192)", () => {
		const make = () =>
			new MessageBuilder().buildForApi(
				[
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "deterministic",
								name: "editor",
								input: { a: "a".repeat(100_000), b: "b".repeat(100_000) },
							},
						],
					},
				],
				{ maxInputTokens: 5_000 },
			);

		expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
	});

	it("does not emit emergency_truncation when Layer A alone suffices (CLINE-2192)", () => {
		const notice = vi.fn();
		const telemetry = { capture: vi.fn() };
		new MessageBuilder().buildForApi(
			[
				{
					role: "user",
					content: [{ type: "text", text: "x".repeat(20_000) }],
				},
			],
			{
				maxInputTokens: 10_000,
				emitStatusNotice: notice,
				telemetry: telemetry as never,
			},
		);

		expect(notice).not.toHaveBeenCalled();
		expect(telemetry.capture).not.toHaveBeenCalled();
	});
});
