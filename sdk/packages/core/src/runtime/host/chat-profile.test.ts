import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as builtinTools from "../../extensions/tools";
import { createToolResultReadExecutor } from "../../extensions/tools/executors/file-read";
import { ToolResultCache } from "../../session/services/tool-result-cache";
import { DefaultRuntimeBuilder } from "../orchestration/runtime-builder";
import {
	applyChatProfile,
	assertChatProvider,
	CHAT_SYSTEM_PROMPT,
} from "./chat-profile";
import type { StartSessionInput } from "./runtime-host";

const dirs: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function chatInput() {
	return applyChatProfile({
		config: {
			cwd: "/tmp",
			providerId: "openai-native",
			modelId: "gpt-5",
			systemPrompt: "You write code",
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: true,
			mode: "yolo",
			toolRoutingRules: [{ enableTools: ["run_commands", "editor"] }],
		},
		localRuntime: {
			configExtensions: ["plugins", "hooks"],
			checkpoint: { enabled: true },
			extraTools: [{ name: "unsafe" } as never],
		},
	} as StartSessionInput);
}

describe("host chat profile", () => {
	it("rejects local coding CLI providers", () => {
		expect(() => assertChatProvider("claude-code")).toThrow(
			"API model provider",
		);
		expect(() => assertChatProvider("openai-codex-cli")).toThrow(
			"API model provider",
		);
		expect(() => assertChatProvider("cline")).not.toThrow();
	});
	it("omits the default tool factory even with coding client options", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-chat-test-"));
		dirs.push(dir);
		setClineDir(dir);
		const input = chatInput();
		expect(input.config.systemPrompt).toBe(CHAT_SYSTEM_PROMPT);
		expect(input.localRuntime?.extraTools?.map((t) => t.name)).toEqual([
			"read_files",
		]);
		expect(input.config.toolRoutingRules).toBeUndefined();
		const factory = vi.spyOn(builtinTools, "createBuiltinTools");
		expect(input.localRuntime?.checkpoint?.enabled).toBe(false);
		const runtime = await new DefaultRuntimeBuilder().build({
			config: input.config as never,
			configExtensions: input.localRuntime?.configExtensions,
			toolExecutors: {
				...input.capabilities?.toolExecutors,
				askQuestion: async () => "answer",
				submit: async (summary) => summary,
			},
		});
		try {
			expect(runtime.tools).toEqual([]);
			expect(factory).not.toHaveBeenCalled();
			expect(runtime.teamRuntime).toBeUndefined();
		} finally {
			await runtime.shutdown("test");
		}
	});
	it("reads cached connector results but rejects disk paths and other sessions", async () => {
		const read = createToolResultReadExecutor();
		const cache = new ToolResultCache("session-a");
		const uri = cache.store(
			"call",
			"saved connector response\nsecond line\nthird line",
		)!;
		const context = {
			agentId: "a",
			iteration: 1,
			metadata: { toolResultCache: cache },
		};
		expect(await read({ path: uri }, context)).toContain(
			"saved connector response",
		);
		expect(
			await read({ path: uri, start_line: 2, end_line: 2 }, context),
		).toContain("second line");
		expect(
			await read({ path: uri, start_line: 2, end_line: 2 }, context),
		).not.toContain("third line");
		for (const path of [
			"/etc/passwd",
			"../settings.json",
			"file:///etc/passwd",
		]) {
			await expect(read({ path }, context)).rejects.toThrow(
				"Invalid tool result cache URI",
			);
		}
		await expect(
			read(
				{ path: uri },
				{
					...context,
					metadata: { toolResultCache: new ToolResultCache("session-b") },
				},
			),
		).rejects.toThrow();
	});
});
