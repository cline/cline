import type { Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessagesToMessages,
	messagesToAgentMessages,
} from "../../runtime/config/agent-message-codec";
import { MessageBuilder } from "./message-builder";

/** Mimics the runtime provider-request path, which rebuilds fresh Message
 * objects every request via the agent-message codec. */
function codecRoundTrip(messages: Message[]): Message[] {
	return agentMessagesToMessages(messagesToAgentMessages(messages));
}

const SMALL_CONTENT = (v: number) => `export const x = ${v};\n`.repeat(40); // ~1KB
const LARGE_CONTENT = (v: number) => `export const x = ${v};\n`.repeat(7_000); // ~140KB (> 128KB threshold)

function readToolUse(id: string, path = "src/a.ts"): Message {
	return {
		role: "assistant",
		content: [
			{ type: "text", text: `reading ${path} (${id})` },
			{
				type: "tool_use",
				id,
				name: "read_files",
				input: { files: [{ path }] },
			},
		],
	};
}

function readToolResult(
	id: string,
	content: string,
	path = "src/a.ts",
): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				name: "read_files",
				content: JSON.stringify([{ path, result: content }]),
			},
		],
	};
}

function serializedBlockAt(result: Message[], index: number): string {
	return JSON.stringify(result[index]);
}

describe("MessageBuilder outdated-read rewrite batching (prefix-cache stability)", () => {
	it("defers small outdated rewrites so request N stays a byte-stable prefix of request N+1", () => {
		const builder = new MessageBuilder();
		const base: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", SMALL_CONTENT(1)),
		];
		const reqA = builder.buildForApi(base);
		const firstResultA = serializedBlockAt(reqA, 2);
		expect(firstResultA).toContain("export const x = 1;");

		// Re-read the same file: ~1KB reclaimable, below the batch threshold.
		const withReread: Message[] = [
			...base,
			readToolUse("t2"),
			readToolResult("t2", SMALL_CONTENT(2)),
		];
		const reqB = builder.buildForApi(withReread);

		// The earlier read result must be byte-identical: no mid-transcript
		// mutation, so the provider prefix cache stays valid.
		expect(serializedBlockAt(reqB, 2)).toEqual(firstResultA);
		expect(serializedBlockAt(reqB, 2)).not.toContain("outdated");
	});

	it("commits batched rewrites once reclaimable bytes cross the threshold", () => {
		const builder = new MessageBuilder();
		const base: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		// First build: t1 is outdated (~140KB reclaimable > 128KB threshold),
		// so the rewrite commits immediately.
		const reqA = builder.buildForApi(base);
		expect(serializedBlockAt(reqA, 2)).toContain(
			"outdated - see the latest file content",
		);
		expect(serializedBlockAt(reqA, 2)).not.toContain("export const x = 1;");
		// Latest read is untouched.
		expect(serializedBlockAt(reqA, 4)).toContain("export const x = 2;");
	});

	it("keeps committed rewrites sticky across subsequent builds", () => {
		const builder = new MessageBuilder();
		const base: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		const reqA = builder.buildForApi(base);
		const rewrittenA = serializedBlockAt(reqA, 2);
		expect(rewrittenA).toContain("outdated");

		// Append unrelated activity; the committed rewrite must reproduce
		// byte-identically so the prefix remains stable.
		const extended: Message[] = [
			...base,
			{
				role: "assistant",
				content: [
					{ type: "text", text: "running tests" },
					{
						type: "tool_use",
						id: "t3",
						name: "bash",
						input: { command: "npm test" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t3",
						name: "bash",
						content: "tests passed",
					},
				],
			},
		];
		const reqB = builder.buildForApi(extended);
		expect(serializedBlockAt(reqB, 2)).toEqual(rewrittenA);
	});

	it("accumulates multiple small outdated reads and commits them together", () => {
		// Each stale read result is ~850 bytes. With a 1.5KB threshold, one
		// stale read stays pending; the second stale read pushes the batch
		// over and both rewrite at once.
		const builder = new MessageBuilder(
			undefined,
			undefined,
			undefined,
			undefined,
			1_500,
		);
		const messages: Message[] = [{ role: "user", content: "task" }];
		for (let i = 1; i <= 3; i++) {
			messages.push(readToolUse(`t${i}`));
			messages.push(readToolResult(`t${i}`, SMALL_CONTENT(i)));
			const result = builder.buildForApi([...messages]);
			const staleCount = result.filter((m) =>
				JSON.stringify(m).includes("outdated - see the latest file content"),
			).length;
			if (i < 3) {
				expect(staleCount).toBe(0); // pending, below threshold
			} else {
				expect(staleCount).toBe(2); // t1 + t2 committed together
			}
		}
	});

	it("counts multi-file read results per outdated locator, not per whole block", () => {
		// One read_files call returns files A, B, C (~850 bytes each entry).
		// Only A is later re-read, so the reclaimable amount is ~850 bytes —
		// NOT the ~2.5KB whole-block size. With a 2KB threshold, a whole-block
		// (over)count would commit immediately; correct per-locator attribution
		// must defer.
		const builder = new MessageBuilder(
			undefined,
			undefined,
			undefined,
			undefined,
			2_000,
		);
		const multiReadUse: Message = {
			role: "assistant",
			content: [
				{ type: "text", text: "reading three files" },
				{
					type: "tool_use",
					id: "t1",
					name: "read_files",
					input: {
						files: [
							{ path: "src/a.ts" },
							{ path: "src/b.ts" },
							{ path: "src/c.ts" },
						],
					},
				},
			],
		};
		const multiReadResult: Message = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					name: "read_files",
					content: JSON.stringify([
						{ path: "src/a.ts", result: SMALL_CONTENT(1) },
						{ path: "src/b.ts", result: SMALL_CONTENT(2) },
						{ path: "src/c.ts", result: SMALL_CONTENT(3) },
					]),
				},
			],
		};
		const messages: Message[] = [
			{ role: "user", content: "task" },
			multiReadUse,
			multiReadResult,
			readToolUse("t2", "src/a.ts"),
			readToolResult("t2", SMALL_CONTENT(4), "src/a.ts"),
		];
		const deferred = builder.buildForApi(messages);
		// Only ~850 bytes (entry A) is reclaimable: must stay below the 2KB
		// threshold and remain pending. Whole-block counting (~2.5KB) would
		// wrongly commit here.
		expect(JSON.stringify(deferred)).not.toContain("outdated");

		// Re-read B as well: reclaimable is now A+B (~1.7KB)... still below.
		const withB: Message[] = [
			...messages,
			readToolUse("t3", "src/b.ts"),
			readToolResult("t3", SMALL_CONTENT(5), "src/b.ts"),
		];
		expect(JSON.stringify(builder.buildForApi(withB))).not.toContain(
			"outdated",
		);

		// Re-read C too: A+B+C (~2.5KB) crosses the 2KB threshold; all three
		// stale entries in the multi-read result commit together.
		const withC: Message[] = [
			...withB,
			readToolUse("t4", "src/c.ts"),
			readToolResult("t4", SMALL_CONTENT(6), "src/c.ts"),
		];
		const committed = builder.buildForApi(withC);
		const multiBlock = JSON.stringify(committed[2]);
		expect(multiBlock).toContain("outdated - see the latest file content");
		expect(multiBlock).not.toContain("export const x = 1;");
		expect(multiBlock).not.toContain("export const x = 2;");
		expect(multiBlock).not.toContain("export const x = 3;");
	});

	it("never rewrites when the threshold is disabled via a huge value", () => {
		const builder = new MessageBuilder(
			undefined,
			undefined,
			undefined,
			undefined,
			Number.POSITIVE_INFINITY,
		);
		const messages: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		const result = builder.buildForApi(messages);
		expect(JSON.stringify(result)).not.toContain("outdated");
	});

	it("restores full content after history is rolled back past the re-read", () => {
		const builder = new MessageBuilder();
		const t1Only: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
		];
		const withReread: Message[] = [
			...t1Only,
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		const reqA = builder.buildForApi(withReread);
		expect(serializedBlockAt(reqA, 2)).toContain("outdated");

		// Same builder instance, history rolled back past the re-read.
		const reqB = builder.buildForApi(t1Only);
		expect(serializedBlockAt(reqB, 2)).not.toContain("outdated");
		expect(serializedBlockAt(reqB, 2)).toContain("export const x = 1;");
	});

	it("keeps batching state when the runtime rebuilds fresh message objects per request", () => {
		const builder = new MessageBuilder();
		const history: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1", "src/big.ts"),
			readToolResult("t1", LARGE_CONTENT(1), "src/big.ts"),
			readToolUse("t2", "src/big.ts"),
			readToolResult("t2", LARGE_CONTENT(2), "src/big.ts"),
		];
		// Request A: t1 (~80KB stale) crosses the threshold and commits.
		const reqA = builder.buildForApi(codecRoundTrip(history));
		expect(JSON.stringify(reqA[2])).toContain("outdated");

		// Request B: a ~1KB re-read makes t3 newly stale. The committed 80KB
		// must NOT be recounted as pending, so t3 stays deferred.
		history.push(
			readToolUse("t3", "src/small.ts"),
			readToolResult("t3", SMALL_CONTENT(1), "src/small.ts"),
			readToolUse("t4", "src/small.ts"),
			readToolResult("t4", SMALL_CONTENT(2), "src/small.ts"),
		);
		const reqB = builder.buildForApi(codecRoundTrip(history));
		expect(JSON.stringify(reqB[2])).toContain("outdated"); // t1 sticky
		expect(JSON.stringify(reqB[6])).not.toContain("outdated"); // t3 deferred
		expect(JSON.stringify(reqB[6])).toContain("export const x = 1;");
	});

	it("restores full content after rollback even with fresh message objects", () => {
		const builder = new MessageBuilder();
		const t1Only: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
		];
		const withReread: Message[] = [
			...t1Only,
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		const reqA = builder.buildForApi(codecRoundTrip(withReread));
		expect(JSON.stringify(reqA[2])).toContain("outdated");

		const reqB = builder.buildForApi(codecRoundTrip(t1Only));
		expect(JSON.stringify(reqB[2])).not.toContain("outdated");
		expect(JSON.stringify(reqB[2])).toContain("export const x = 1;");
	});

	it("keeps committed rewrites applied when compaction drops the paired tool_use", () => {
		const builder = new MessageBuilder();
		const withReread: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", LARGE_CONTENT(1)),
			readToolUse("t2"),
			readToolResult("t2", LARGE_CONTENT(2)),
		];
		const reqA = builder.buildForApi(codecRoundTrip(withReread));
		const rewrittenA = JSON.stringify(reqA[2]);
		expect(rewrittenA).toContain("outdated");

		// Compaction drops t1's tool_use but keeps the stale result, and the
		// runtime delivers fresh objects so the name index rebuilds without
		// t1. The rewrite must stay applied (via tool_result.name) so the
		// suffix after the orphaned block is not mutated back to full content.
		const compacted: Message[] = [
			withReread[0],
			{
				role: "assistant",
				content: [{ type: "text", text: "reading src/a.ts (t1)" }],
			},
			...withReread.slice(2),
		];
		const reqB = builder.buildForApi(codecRoundTrip(compacted));
		expect(JSON.stringify(reqB[2])).toContain("outdated");
		expect(JSON.stringify(reqB[2])).not.toContain("export const x = 1;");
	});

	it("counts stale image payload bytes toward the batch threshold", () => {
		const builder = new MessageBuilder(
			undefined,
			undefined,
			undefined,
			undefined,
			2_000,
		);
		const imageReadResult: Message = {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					name: "read_files",
					content: [
						{
							type: "text",
							text: JSON.stringify([
								{ path: "img/shot.png", result: "Successfully read image" },
							]),
						},
						{ type: "image", data: "A".repeat(4_000), mediaType: "image/png" },
					],
				},
			],
		};
		const messages: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1", "img/shot.png"),
			imageReadResult,
			readToolUse("t2", "img/shot.png"),
			readToolResult("t2", SMALL_CONTENT(1), "img/shot.png"),
		];
		// Text marker alone is ~70 bytes — below the 2KB threshold. The 4KB
		// base64 payload must count, committing the batch.
		const result = builder.buildForApi(messages);
		const block = JSON.stringify(result[2]);
		expect(block).toContain("outdated");
		expect(block).not.toContain("AAAA");
	});

	it("rewrites eagerly when threshold is 0 (legacy behavior)", () => {
		const builder = new MessageBuilder(
			undefined,
			undefined,
			undefined,
			undefined,
			0,
		);
		const messages: Message[] = [
			{ role: "user", content: "task" },
			readToolUse("t1"),
			readToolResult("t1", SMALL_CONTENT(1)),
			readToolUse("t2"),
			readToolResult("t2", SMALL_CONTENT(2)),
		];
		const result = builder.buildForApi(messages);
		expect(serializedBlockAt(result, 2)).toContain("outdated");
	});
});
