import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBuiltinCodingTools } from "./index";

const context = { agentId: "test", iteration: 1 };

describe("portable built-in coding tools", () => {
	it("preserves the Core default model-facing names", async () => {
		const root = await mkdtemp(join(tmpdir(), "cline-tools-"));
		const tools = createBuiltinCodingTools({ workspaceRoot: root });
		expect(tools.map((tool) => tool.name)).toEqual([
			"read_files",
			"search_codebase",
			"run_commands",
			"editor",
			"fetch_web_content",
			"submit_and_exit",
		]);
	});

	it("edits and reads only inside the workspace", async () => {
		const root = await mkdtemp(join(tmpdir(), "cline-tools-"));
		const tools = createBuiltinCodingTools({
			workspaceRoot: root,
			enabledToolNames: ["editor", "read_files"],
		});
		const editor = tools.find((tool) => tool.name === "editor");
		const reader = tools.find((tool) => tool.name === "read_files");
		await editor?.execute(
			{ path: join(root, "a.txt"), new_text: "one\ntwo" },
			context,
		);
		expect(await readFile(join(root, "a.txt"), "utf8")).toBe("one\ntwo");
		expect(
			await reader?.execute(
				{ files: [{ path: join(root, "a.txt"), start_line: 2 }] },
				context,
			),
		).toEqual([{ path: join(root, "a.txt"), content: "two" }]);
		await expect(
			reader?.execute(
				{ files: [{ path: join(root, "..", "outside") }] },
				context,
			),
		).resolves.toEqual({
			error: expect.stringContaining("outside the workspace"),
		});
	});

	it("returns command failures as structured results", async () => {
		const root = await mkdtemp(join(tmpdir(), "cline-tools-"));
		const command = createBuiltinCodingTools({
			workspaceRoot: root,
			enabledToolNames: ["run_commands"],
		})[0];
		const result = await command.execute(
			{ commands: ["printf ok", "exit 7"] },
			context,
		);
		expect(result).toEqual([
			{ command: "printf ok", success: true, output: "ok" },
			{
				command: "exit 7",
				success: false,
				error: expect.stringContaining("exited 7"),
			},
		]);
	});
});
