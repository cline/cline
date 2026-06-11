import type { Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./message-builder";

const SMALL_CONTENT = (v: number) => `export const x = ${v};\n`.repeat(40); // ~1KB
const LARGE_CONTENT = (v: number) => `export const x = ${v};\n`.repeat(4_000); // ~80KB

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
		// First build: t1 is outdated (~80KB reclaimable > 64KB threshold),
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
		const builder = new MessageBuilder(undefined, undefined, undefined, 1_500);
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
		const builder = new MessageBuilder(undefined, undefined, undefined, 2_000);
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

	it("rewrites eagerly when threshold is 0 (legacy behavior)", () => {
		const builder = new MessageBuilder(undefined, undefined, undefined, 0);
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
