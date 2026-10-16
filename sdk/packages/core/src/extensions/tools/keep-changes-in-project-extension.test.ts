import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentBeforeToolContext,
	AgentBeforeToolResult,
	AgentRuntimeStateSnapshot,
	AgentTool,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setKeepChangesInProjectGlobally } from "../../services/global-settings";
import { createKeepChangesInProjectExtension } from "./keep-changes-in-project-extension";

function makeContext(toolName: string, input: unknown): AgentBeforeToolContext {
	return {
		snapshot: {} as AgentRuntimeStateSnapshot,
		tool: { name: toolName } as AgentTool,
		toolCall: {
			type: "tool-call",
			toolCallId: "tool-call-1",
			toolName,
			input,
		},
		input,
	};
}

describe("createKeepChangesInProjectExtension", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
	const project = join(homedir(), "projects", "app");
	const outside = join(homedir(), ".bashrc");
	let settingsDir: string;

	const beforeTool = (toolName: string, input: unknown) =>
		createKeepChangesInProjectExtension({ cwd: project }).hooks?.beforeTool?.(
			makeContext(toolName, input),
		) as AgentBeforeToolResult | undefined;

	beforeEach(async () => {
		settingsDir = await mkdtemp(join(tmpdir(), "keep-changes-"));
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(settingsDir, "settings.json");
		setKeepChangesInProjectGlobally(true);
	});

	afterEach(async () => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
		await rm(settingsDir, { recursive: true, force: true });
	});

	it("allows edits inside the project and temp folders", () => {
		expect(beforeTool("editor", { path: "src/index.ts" })).toBeUndefined();
		expect(
			beforeTool("editor", { path: join(project, "README.md") }),
		).toBeUndefined();
		expect(
			beforeTool("editor", { path: join(tmpdir(), "notes.txt") }),
		).toBeUndefined();
	});

	it("refuses editor writes outside the project", () => {
		expect(beforeTool("editor", { path: outside })).toEqual({
			skip: true,
			reason: expect.stringContaining(
				'turn off "Only allow edits in project directory"',
			),
		});
		expect(beforeTool("editor", { path: "../other/file.ts" })?.skip).toBe(true);
	});

	it("checks every file an apply_patch touches, including moves", () => {
		const patch = (target: string) =>
			[
				"*** Begin Patch",
				"*** Update File: src/a.ts",
				`*** Move to: ${target}`,
				"@@",
				"-a",
				"+b",
				"*** End Patch",
			].join("\n");
		expect(
			beforeTool("apply_patch", { input: patch("src/b.ts") }),
		).toBeUndefined();
		expect(beforeTool("apply_patch", patch(outside))?.skip).toBe(true);
	});

	it("does nothing when the setting is off or for other tools", () => {
		expect(
			beforeTool("run_commands", { commands: ["rm -rf ~"] }),
		).toBeUndefined();
		setKeepChangesInProjectGlobally(false);
		expect(beforeTool("editor", { path: outside })).toBeUndefined();
	});
});
