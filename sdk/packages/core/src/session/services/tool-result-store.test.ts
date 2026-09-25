import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("recoverable external tool results", () => {
	it.each([
		"mcp__github__get_diff",
		"connector_search",
		"custom_tool",
	])("saves the full %s response and exposes a readable path", async (name) => {
		const store = new ToolResultStore("session_1", directory);
		const block = result(`begin\n${"重要な情報".repeat(2000)}\nend`, name);
		const messages = history(block);
		const builder = new MessageBuilder({
			maxToolResultChars: 500,
			storeToolResult: (value) => store.save(value),
		});
		const prepared = await builder.buildForApi(messages);
		const path = join(directory, "session_1", "tools", "call_1.result.txt");
		expect(output(prepared).content).toContain(path);
		expect(output(prepared).content).toContain("truncated");
		expect(await readFile(path, "utf8")).toBe(block.content);
		expect(output(messages)).toEqual(block);
		const roundTrip = agentMessagesToMessages(
			messagesToAgentMessages(prepared),
		);
		expect(JSON.stringify(roundTrip)).toContain(path);
		expect(await builder.buildForApi(messages)).toEqual(prepared);
		// Resuming with a new builder retains the same file and provider prefix.
		const resumed = new MessageBuilder({
			maxToolResultChars: 500,
			storeToolResult: (value) =>
				new ToolResultStore("session_1", directory).save(value),
		});
		expect(await resumed.buildForApi(messages)).toEqual(prepared);
	});

	it("preserves structured results and native media while recovering aggregate truncation", async () => {
		const store = new ToolResultStore("session_1", directory);
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
		const path = join(directory, "session_1", "tools", "call_1.result.txt");
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
		const store = new ToolResultStore("session_1", directory);
		const builder = new MessageBuilder({
			maxToolResultChars: 5000,
			maxTotalTextBytes: 2000,
			storeToolResult: (value) => store.save(value),
		});
		const block = result("x".repeat(30_000));
		expect(output(await builder.buildForApi(history(block)))).toEqual(block);
	});

	it("handles unnamed imported results and error responses", async () => {
		const store = new ToolResultStore("session_1", directory);
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
		expect(
			await readFile(
				join(directory, "session_1", "tools", "call_1.result.txt"),
				"utf8",
			),
		).toBe(block.content);
	});

	it("uses the configured session history directory", async () => {
		vi.stubEnv("CLINE_SESSION_DATA_DIR", directory);
		const path = await new ToolResultStore("session_1").save(result("full"));
		expect(path).toBe(
			join(directory, "session_1", "tools", "call_1.result.txt"),
		);
	});

	it("encodes unsafe call IDs without collisions or leftover temporary files", async () => {
		const store = new ToolResultStore("session_1", directory);
		const ids = ["../../outside", "a/b", "a%2Fb", "a\\b"];
		const paths = await Promise.all(
			ids.map((id) => store.save(result(id, "external", id))),
		);
		expect(new Set(paths).size).toBe(ids.length);
		for (let i = 0; i < paths.length; i++) {
			expect(paths[i]).toBe(
				join(
					directory,
					"session_1",
					"tools",
					`${encodeURIComponent(ids[i])}.result.txt`,
				),
			);
			expect(await readFile(paths[i], "utf8")).toBe(ids[i]);
		}
		expect(await readdir(join(directory, "session_1", "tools"))).toHaveLength(
			ids.length,
		);
		expect(() => new ToolResultStore("../outside", directory)).toThrow(
			"Invalid session ID",
		);
	});
});
