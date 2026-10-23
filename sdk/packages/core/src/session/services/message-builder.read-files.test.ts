import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Message, ToolResultContent } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReadFilesTool } from "../../extensions/tools/definitions";
import { createFileReadExecutor } from "../../extensions/tools/executors/file-read";
import type { ToolOperationResult } from "../../extensions/tools/types";
import {
	DEFAULT_MAX_TOOL_RESULT_CHARS,
	MessageBuilder,
} from "./message-builder";

/**
 * Drives the real `read_files` tool through `MessageBuilder` so the two
 * caps are exercised together: whatever the tool returns (and tells the
 * model it returned) must reach the provider request intact.
 */
describe("read_files results through MessageBuilder", () => {
	const tool = createReadFilesTool(createFileReadExecutor());
	const context = {
		agentId: "agent",
		conversationId: "conversation",
		iteration: 1,
	} as unknown as Parameters<typeof tool.execute>[1];
	let dir: string;
	let file: string;

	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "read-files-cap-"));
		file = path.join(dir, "README.md");
		const lines = Array.from({ length: 751 }, (_, index) =>
			index % 20 === 0
				? `## Section ${index / 20}`
				: `Line ${index + 1}: prose describing phase ${index % 7} of the project in some detail.`,
		);
		await fs.writeFile(file, lines.join("\n"));
	});

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	async function sentReadResult(
		range: { start_line?: number; end_line?: number } = {},
	): Promise<{ returned: string; sent: string }> {
		const input = { files: [{ path: file, ...range }] };
		const output = (await tool.execute(
			input as never,
			context,
		)) as ToolOperationResult[];
		const messages: Message[] = [
			{ role: "user", content: "read the docs" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call_read", name: "read_files", input },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_read",
						name: "read_files",
						content: output as unknown as ToolResultContent["content"],
					},
				],
			},
		];
		const built = new MessageBuilder().buildForApi(messages);
		const block = (built[2].content as ToolResultContent[])[0];
		const sent = (block.content as unknown as ToolOperationResult[])[0];
		return { returned: String(output[0].result), sent: String(sent.result) };
	}

	it("sends a whole-file read as the tool returned it", async () => {
		const { returned, sent } = await sentReadResult();
		expect(returned.length).toBeGreaterThan(40_000);
		expect(sent).toBe(returned);
	});

	it("sends a ranged read that fits the tool's cap without a cut", async () => {
		const { returned, sent } = await sentReadResult({
			start_line: 55,
			end_line: 400,
		});
		expect(returned).toContain("400 | Line 400:");
		expect(returned).not.toContain("[Showing lines");
		expect(sent).toBe(returned);
	});

	it("sends a short ranged read whole", async () => {
		const { returned, sent } = await sentReadResult({
			start_line: 110,
			end_line: 230,
		});
		expect(sent).toBe(returned);
	});

	it("sends every file of a batched read whole", async () => {
		const second = path.join(dir, "IMPLEMENTATION.md");
		await fs.writeFile(
			second,
			Array.from(
				{ length: 600 },
				(_, index) => `Step ${index + 1}: implementation notes for this step.`,
			).join("\n"),
		);
		const input = { files: [{ path: file }, { path: second }] };
		const output = (await tool.execute(
			input as never,
			context,
		)) as ToolOperationResult[];
		const messages: Message[] = [
			{ role: "user", content: "read the docs" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "call_read", name: "read_files", input },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_read",
						name: "read_files",
						content: output as unknown as ToolResultContent["content"],
					},
				],
			},
		];
		const built = new MessageBuilder().buildForApi(messages);
		const block = (built[2].content as ToolResultContent[])[0];
		const sent = block.content as unknown as ToolOperationResult[];

		expect(output).toHaveLength(2);
		for (const [index, entry] of output.entries()) {
			expect(String(entry.result).length).toBeGreaterThan(
				DEFAULT_MAX_TOOL_RESULT_CHARS,
			);
			expect(sent[index].result).toBe(entry.result);
		}
	});
});
