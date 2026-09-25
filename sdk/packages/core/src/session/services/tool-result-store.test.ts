import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Message, ToolResultContent } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	agentMessagesToMessages,
	messagesToAgentMessages,
} from "../../runtime/config/agent-message-codec";
import { MessageBuilder } from "./message-builder";
import { ToolResultStore } from "./tool-result-store";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "cline-tool-results-"));
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

function result(
	content: ToolResultContent["content"],
	name = "mcp__github__get_diff",
	id = "call_1",
): ToolResultContent {
	return { type: "tool_result", tool_use_id: id, name, content };
}
function history(block: ToolResultContent): Message[] {
	return [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: block.tool_use_id,
					name: block.name ?? "external",
					input: {},
				},
			],
		},
		{ role: "user", content: [block] },
	];
}
function output(messages: Message[]): ToolResultContent {
	const content = messages[1].content;
	if (!Array.isArray(content) || content[0].type !== "tool_result")
		throw new Error("Missing result");
	return content[0];
}

function recoveryPath(messages: Message[]): string {
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (block.type !== "tool_result" || !Array.isArray(block.content))
				continue;
			const notice = block.content.at(-1);
			if (notice?.type === "text") {
				const match = /^Full result saved to (.*) for search\.$/.exec(
					notice.text,
				);
				if (match) return match[1];
			}
		}
	}
	throw new Error("Missing recovery notice");
}

describe("recoverable external tool results", () => {
	it.each([
		"mcp__github__get_diff",
		"connector_search",
		"custom_tool",
	])("saves the full %s response and exposes a readable path", async (name) => {
		const store = new ToolResultStore(directory);
		const block = result(`begin\n${"重要な情報".repeat(2000)}\nend`, name);
		const messages = history(block);
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			storeToolResult: (value) => store.save(value),
		});
		const prepared = await builder.buildForApi(messages);
		const path = recoveryPath(prepared);
		expect(output(prepared).content).toContainEqual({
			type: "text",
			text: `Full result saved to ${path} for search.`,
		});
		expect(JSON.stringify(output(prepared).content)).toContain("truncated");
		expect(await readFile(path, "utf8")).toBe(block.content);
		expect(output(messages)).toEqual(block);
		const roundTrip = agentMessagesToMessages(
			messagesToAgentMessages(prepared),
		);
		expect(JSON.stringify(roundTrip)).toContain(path);
		expect(await builder.buildForApi(messages)).toEqual(prepared);
		// A resumed runtime uses a new temp namespace and regenerates the file.
		const resumedStore = new ToolResultStore(directory);
		const resumed = new MessageBuilder({
			maxToolResultChars: 500,
			storeToolResult: (value) => resumedStore.save(value),
		});
		const resumedPath = recoveryPath(await resumed.buildForApi(messages));
		expect(resumedPath).not.toBe(path);
		expect(await readFile(resumedPath, "utf8")).toBe(block.content);
	});

	it("preserves structured results and native media while recovering aggregate truncation", async () => {
		const store = new ToolResultStore(directory);
		const image = { type: "image", mediaType: "image/png", data: "aGVsbG8=" };
		const block = result([
			{
				query: "records",
				result: { data: "e".repeat(30_000), tail: "important" },
				success: true,
			},
			image,
		] as unknown as ToolResultContent["content"]);
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 10_000,
			storeToolResult: (value) => store.save(value),
		});
		const prepared = await builder.buildForApi(history(block));
		const path = recoveryPath(prepared);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual(block.content);
		expect(JSON.stringify(output(prepared).content)).toContain(
			"provider request budget",
		);
		expect(JSON.stringify(output(prepared).content)).toContain(path);
		expect(output(prepared).content).toContainEqual(image);
	});

	it("keeps short external results and default tools out of storage", async () => {
		const save = vi.fn();
		const builder = new MessageBuilder({
			maxToolResultChars: 100,
			storeToolResult: save,
		});
		expect(
			output(await builder.buildForApi(history(result("short")))).content,
		).toBe("short");
		expect(
			output(
				await builder.buildForApi(
					history(result("x".repeat(1000), "run_commands")),
				),
			).content,
		).toContain("truncated");
		expect(save).not.toHaveBeenCalled();
	});

	it("returns the complete result if storage fails, including under aggregate pressure", async () => {
		await writeFile(join(directory, "session_1"), "not a directory");
		const store = new ToolResultStore(join(directory, "session_1"));
		const builder = new MessageBuilder({
			maxToolResultChars: 5000,
			maxTotalTextBytes: 2000,
			storeToolResult: (value) => store.save(value),
		});
		const block = result("x".repeat(30_000));
		expect(output(await builder.buildForApi(history(block)))).toEqual(block);
	});

	it("handles unnamed imported results and error responses", async () => {
		const store = new ToolResultStore(directory);
		const block = {
			...result("error details".repeat(1000)),
			name: "",
			is_error: true,
		};
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			storeToolResult: (value) => store.save(value),
		});
		const prepared = await builder.buildForApi([
			{ role: "user", content: [block] },
		]);
		expect(JSON.stringify(prepared)).toContain("call_1.result.txt");
		expect(JSON.stringify(prepared)).toContain('"is_error":true');
		expect(await readFile(recoveryPath(prepared), "utf8")).toBe(block.content);
	});

	it("recreates files removed by temp cleanup and reuses the path for the same call", async () => {
		const store = new ToolResultStore(directory);
		const block = result("original".repeat(1000));
		const builder = new MessageBuilder({
			maxToolResultChars: 100,
			storeToolResult: (value) => store.save(value),
		});
		const first = await builder.buildForApi(history(block));
		const path = recoveryPath(first);
		await rm(dirname(path), { recursive: true, force: true });
		expect(await builder.buildForApi(history(block))).toEqual(first);
		expect(await readFile(path, "utf8")).toBe(block.content);
	});

	it("isolates runtimes and keeps repeated tool executions separate", async () => {
		const first = new ToolResultStore(directory);
		const second = new ToolResultStore(directory);
		const paths = await Promise.all([
			first.save(result("first", "external", "call_1")),
			first.save(result("second", "external", "call_2")),
			second.save(result("other runtime", "external", "call_1")),
		]);
		expect(new Set(paths).size).toBe(3);
		expect(dirname(paths[0])).toBe(dirname(paths[1]));
		expect(dirname(paths[0])).not.toBe(dirname(paths[2]));
	});

	it("retries a failed lazy directory allocation", async () => {
		const root = join(directory, "blocked");
		await writeFile(root, "not a directory");
		const store = new ToolResultStore(root);
		await expect(store.save(result("full"))).rejects.toThrow();
		await rm(root);
		await mkdir(root);
		expect(await readFile(await store.save(result("full")), "utf8")).toBe(
			"full",
		);
	});

	it("encodes unsafe call IDs without collisions or leftover temporary files", async () => {
		const store = new ToolResultStore(directory);
		const ids = ["../../outside", "a/b", "a%2Fb", "a\\b"];
		const paths = await Promise.all(
			ids.map((id) => store.save(result(id, "external", id))),
		);
		expect(new Set(paths).size).toBe(ids.length);
		for (let i = 0; i < paths.length; i++) {
			expect(paths[i]).toBe(
				join(dirname(paths[0]), `${encodeURIComponent(ids[i])}.result.txt`),
			);
			expect(await readFile(paths[i], "utf8")).toBe(ids[i]);
		}
		expect(await readdir(dirname(paths[0]))).toHaveLength(ids.length);
	});
});
