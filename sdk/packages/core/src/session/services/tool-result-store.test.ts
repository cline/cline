import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
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

describe("recorded external tool results", () => {
	it.each([
		"mcp__github__get_diff",
		"connector_search",
		"custom_tool",
	])("records a preview and file path once for %s", async (name) => {
		const store = new ToolResultStore(directory);
		const save = vi.fn((value: ToolResultContent) => store.save(value));
		const builder = new MessageBuilder({ maxToolResultChars: 500 });
		const original = result("important records\n".repeat(2000), name);
		const recorded = await builder.prepareExternalToolResult(original, save);
		const messages = history(recorded);
		const path = recoveryPath(messages);
		expect(await readFile(path, "utf8")).toBe(original.content);
		expect(JSON.stringify(recorded)).toContain("truncated");
		const resumed = agentMessagesToMessages(
			messagesToAgentMessages(JSON.parse(JSON.stringify(messages))),
		);
		const resumedBuilder = new MessageBuilder({
			maxToolResultChars: 500,
			maxTotalTextBytes: 10_000,
		});
		for (let i = 0; i < 3; i++) {
			expect(output(await builder.buildForApi(messages))).toEqual(recorded);
			expect(output(await resumedBuilder.buildForApi(resumed))).toEqual(
				recorded,
			);
		}
		expect(save).toHaveBeenCalledTimes(1);
		expect(await readFile(path, "utf8")).toBe(original.content);
	});
	it("bounds many small structured fields and preserves native media", async () => {
		const store = new ToolResultStore(directory);
		const builder = new MessageBuilder({ maxToolResultChars: 500 });
		const image = { type: "image", mediaType: "image/png", data: "aGVsbG8=" };
		const original = result([
			...Array.from({ length: 1000 }, () => ({ value: "small field" })),
			image,
		] as unknown as ToolResultContent["content"]);
		const recorded = await builder.prepareExternalToolResult(
			original,
			(value) => store.save(value),
		);
		expect(recorded.content).toContainEqual(image);
		expect(JSON.stringify(recorded.content).length).toBeLessThan(1500);
		expect(
			JSON.parse(await readFile(recoveryPath(history(recorded)), "utf8")),
		).toEqual(original.content);
	});
	it("does not store short responses or alter default tool results at ingestion", async () => {
		const builder = new MessageBuilder({ maxToolResultChars: 100 });
		const save = vi.fn();
		for (const block of [
			result("short"),
			result("x".repeat(1000), "run_commands"),
		]) {
			expect(await builder.prepareExternalToolResult(block, save)).toBe(block);
		}
		expect(save).not.toHaveBeenCalled();
	});
	it("continues with a bounded preview when saving fails and respects aggregate overflow", async () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 8000,
			maxTotalTextBytes: 1000,
		});
		const warning = vi.fn();
		const recorded = await builder.prepareExternalToolResult(
			result("x".repeat(500_000)),
			async () => {
				throw new Error("disk full");
			},
			warning,
		);
		expect(warning).toHaveBeenCalledOnce();
		expect(JSON.stringify(recorded)).not.toContain("Full result saved");
		expect(JSON.stringify(recorded).length).toBeLessThan(8500);
		const original = JSON.stringify(recorded);
		const prepared = output(await builder.buildForApi(history(recorded)));
		const textBytes =
			typeof prepared.content === "string"
				? Buffer.byteLength(prepared.content)
				: prepared.content.reduce(
						(total, entry) =>
							total +
							(entry.type === "text" ? Buffer.byteLength(entry.text) : 0),
						0,
					);
		expect(textBytes).toBeLessThanOrEqual(1000);
		expect(JSON.stringify(recorded)).toBe(original);
	});
	it("keeps saved paths while reducing only provider copies under aggregate pressure", async () => {
		const store = new ToolResultStore(directory);
		const builder = new MessageBuilder({
			maxToolResultChars: 8000,
			maxTotalTextBytes: 1000,
		});
		const full = result("x".repeat(500_000));
		const recorded = await builder.prepareExternalToolResult(full, (value) =>
			store.save(value),
		);
		const path = recoveryPath(history(recorded));
		const prepared = output(await builder.buildForApi(history(recorded)));
		expect(JSON.stringify(prepared.content)).toContain(path);
		const textBytes =
			typeof prepared.content === "string"
				? Buffer.byteLength(prepared.content)
				: prepared.content.reduce(
						(total, entry) =>
							total +
							(entry.type === "text" ? Buffer.byteLength(entry.text) : 0),
						0,
					);
		expect(textBytes).toBeLessThanOrEqual(1000);
		expect(await readFile(path, "utf8")).toBe(full.content);
		expect(JSON.stringify(recorded.content).length).toBeGreaterThan(1000);
	});

	it("resolves relative storage roots before publishing durable paths", async () => {
		const store = new ToolResultStore(relative(process.cwd(), directory));
		const originalCwd = process.cwd();
		try {
			process.chdir(directory);
			const path = await store.save(result("full response"));
			expect(isAbsolute(path)).toBe(true);
			expect(path.startsWith(directory)).toBe(true);
			process.chdir(originalCwd);
			expect(await readFile(path, "utf8")).toBe("full response");
		} finally {
			process.chdir(originalCwd);
		}
	});
	it("preserves recovery paths through small caps, aggregate pressure, and history round trips", async () => {
		const store = new ToolResultStore(
			join(directory, "long-directory-name-".repeat(6)),
		);
		const builder = new MessageBuilder({
			maxToolResultChars: 96,
			maxTotalTextBytes: 128,
		});
		const recorded = await builder.prepareExternalToolResult(
			result("x".repeat(5000)),
			(value) => store.save(value),
		);
		const path = recoveryPath(history(recorded));
		expect(path.length).toBeGreaterThan(96);
		const restored = agentMessagesToMessages(
			messagesToAgentMessages(JSON.parse(JSON.stringify(history(recorded)))),
		);
		const prepared = await builder.buildForApi(restored);
		expect(recoveryPath(prepared)).toBe(path);
		expect(await readFile(recoveryPath(prepared), "utf8")).toBe(
			"x".repeat(5000),
		);
	});
	it("does not exempt ordinary tool text that resembles a recovery notice", async () => {
		const builder = new MessageBuilder({ maxToolResultChars: 96 });
		const text = `Full result saved to /${"x".repeat(500)} for search.`;
		const prepared = output(
			await builder.buildForApi(history(result([{ type: "text", text }]))),
		);
		expect(JSON.stringify(prepared.content)).not.toContain(text);
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
