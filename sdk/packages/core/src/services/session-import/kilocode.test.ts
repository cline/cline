import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KilocodeImportAdapter } from "./kilocode";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function taskDir(
	tasksRoot: string,
	taskId: string,
	history: unknown[],
	metadata: Record<string, unknown> = {},
): string {
	const dir = join(tasksRoot, taskId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "api_conversation_history.json"),
		JSON.stringify(history),
	);
	writeFileSync(join(dir, "task_metadata.json"), JSON.stringify(metadata));
	return dir;
}

function fixture(): { tasksRoot: string; adapter: KilocodeImportAdapter } {
	const tasksRoot = mkdtempSync(join(tmpdir(), "kilocode-import-"));
	tempDirs.push(tasksRoot);
	return { tasksRoot, adapter: new KilocodeImportAdapter({ tasksDir: tasksRoot }) };
}

describe("KilocodeImportAdapter", () => {
	it("reports not installed when the tasks dir is absent", () => {
		const adapter = new KilocodeImportAdapter({
			tasksDir: join(tmpdir(), "does-not-exist-kilocode"),
		});
		expect(adapter.isInstalled()).toBe(false);
		expect(adapter.discover()).toEqual([]);
	});

	it("discovers and converts a task with text and paired tool calls", () => {
		const { tasksRoot, adapter } = fixture();
		taskDir(
			tasksRoot,
			"task-abc123",
			[
				{
					role: "user",
					ts: 1_760_000_000_000,
					content: [{ type: "text", text: "add a healthcheck route" }],
				},
				{
					role: "assistant",
					ts: 1_760_000_001_000,
					content: [
						{ type: "thinking", thinking: "check routes", signature: "sig" },
						{
							type: "tool_use",
							id: "toolu_1",
							name: "read_file",
							input: { path: "src/routes.ts" },
						},
					],
				},
				{
					role: "user",
					ts: 1_760_000_002_000,
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_1",
							content: "export const routes = []",
						},
					],
				},
				{
					role: "assistant",
					ts: 1_760_000_003_000,
					content: [{ type: "text", text: "Added the route." }],
				},
			],
			{ cwd: "/workspace/api", model: "claude-sonnet-4-5" },
		);

		expect(adapter.isInstalled()).toBe(true);
		const discovered = adapter.discover();
		expect(discovered).toHaveLength(1);
		expect(discovered[0].tool).toBe("kilocode");
		expect(discovered[0].sourceId).toBe("task-abc123");
		expect(discovered[0].cwd).toBe("/workspace/api");
		expect(discovered[0].messageCount).toBe(4);
		expect(discovered[0].title).toBe("add a healthcheck route");

		const converted = adapter.convert("task-abc123");
		expect(converted.provider).toBe("cline");
		expect(converted.model).toBe("claude-sonnet-4-5");
		expect(converted.cwd).toBe("/workspace/api");
		expect(converted.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);

		// thinking block is preserved as a block (sanitize strips the signature later).
		const firstAssistant = converted.messages[1];
		expect(
			(firstAssistant.content as Array<{ type: string }>).map((b) => b.type),
		).toEqual(["thinking", "tool_use"]);

		// tool_result is paired against the tool_use id.
		const toolResult = converted.messages[2];
		const resultBlock = (toolResult.content as Array<Record<string, unknown>>)[0];
		expect(resultBlock.type).toBe("tool_result");
		expect(resultBlock.tool_use_id).toBe("toolu_1");
		expect(resultBlock.content).toBe("export const routes = []");
	});

	it("throws when converting an unknown task", () => {
		const { adapter } = fixture();
		expect(() => adapter.convert("missing")).toThrow(/kilocode task missing/);
	});

	it("skips task folders without a conversation history", () => {
		const { tasksRoot, adapter } = fixture();
		const empty = join(tasksRoot, "task-empty");
		mkdirSync(empty, { recursive: true });
		expect(adapter.discover()).toEqual([]);
	});
});
