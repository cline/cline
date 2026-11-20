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
	// Long enough that a whole-file read hits the tool's own window cap.
	let readme: string;
	// Fits the tool's window but is well over the tool-result cap.
	let notes: string;

	beforeAll(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "read-files-cap-"));
		readme = path.join(dir, "README.md");
		notes = path.join(dir, "IMPLEMENTATION.md");
		await fs.writeFile(
			readme,
			Array.from({ length: 751 }, (_, index) =>
				index % 20 === 0
					? `## Section ${index / 20}`
					: `Line ${index + 1}: prose describing phase ${index % 7} of the project in some detail.`,
			).join("\n"),
		);
		await fs.writeFile(
			notes,
			Array.from(
				{ length: 600 },
				(_, index) => `Step ${index + 1}: implementation notes for this step.`,
			).join("\n"),
		);
	});

	afterAll(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	type ReadRequest = { path: string; start_line?: number; end_line?: number };

	/**
	 * Runs one `read_files` call and pairs each entry the tool returned with
	 * what the provider request carries for it.
	 */
	async function readThroughBuilder(
		files: ReadRequest[],
	): Promise<Array<{ returned: string; sent: string }>> {
		const input = { files };
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
		return output.map((entry, index) => ({
			returned: String(entry.result),
			sent: String(sent[index].result),
		}));
	}

	it.each([
		{
			label: "a whole-file read the tool capped with a footer",
			range: {},
			footer: true,
		},
		{
			label: "a ranged read that fits the tool's window",
			range: { start_line: 55, end_line: 400 },
			footer: false,
		},
		{
			label: "a short ranged read just over the tool-result cap",
			range: { start_line: 110, end_line: 230 },
			footer: false,
		},
	])("sends $label as the tool returned it", async ({ range, footer }) => {
		const [{ returned, sent }] = await readThroughBuilder([
			{ path: readme, ...range },
		]);

		// Every case is longer than the tool-result cap, so the old cut would show.
		expect(returned.length).toBeGreaterThan(DEFAULT_MAX_TOOL_RESULT_CHARS);
		expect(returned.includes("[Showing lines")).toBe(footer);
		expect(sent).toBe(returned);
	});

	it("sends every file of a batched read whole", async () => {
		const results = await readThroughBuilder([
			{ path: readme },
			{ path: notes },
		]);

		expect(results).toHaveLength(2);
		for (const { returned, sent } of results) {
			expect(returned.length).toBeGreaterThan(DEFAULT_MAX_TOOL_RESULT_CHARS);
			expect(sent).toBe(returned);
		}
	});
});
