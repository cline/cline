import {
	mkdtemp,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentMessage,
	AgentModel,
	AgentToolResultPart,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	pruneToolResultCache,
	TOOL_RESULT_CACHE_TTL_MS,
	toolResultCacheRoot,
} from "../../session/services/tool-result-cache";
import { SessionRuntime } from "./session-runtime-orchestrator";

describe("runtime result cache", () => {
	it.each([
		false,
		true,
	])("preserves history and tool-finished output when cache storage is blocked: %s", async (blocked) => {
		const root = await mkdtemp(join(tmpdir(), "runtime-result-cache-"));
		vi.stubEnv("CLINE_DATA_DIR", root);
		const full = "original external response\n".repeat(2000);
		const captured: AgentMessage[][] = [];
		let calls = 0;
		const model: AgentModel = {
			async stream(request) {
				captured.push([...request.messages]);
				const first = calls++ === 0;
				return (async function* () {
					if (first) {
						yield {
							type: "tool-call-delta" as const,
							toolCallId: "call",
							toolName: "custom_external_name",
							inputText: "{}",
						};
						yield { type: "finish" as const, reason: "tool-calls" as const };
					} else {
						yield { type: "text-delta" as const, text: "done" };
						yield { type: "finish" as const, reason: "stop" as const };
					}
				})();
			},
		};
		const logger = { debug: vi.fn(), log: vi.fn() };
		const config: AgentConfig = {
			providerId: "anthropic",
			modelId: "claude-3-5-sonnet",
			apiKey: "test",
			sessionId: "session",
			systemPrompt: "test",
			logger,
			tools: [
				{
					name: "custom_external_name",
					description: "test",
					inputSchema: { type: "object" },
					resultPolicy: "cache-oversized",
					execute: async () => full,
				},
			],
		};
		const deps = {
			createAgentRuntimeImpl: (
				runtimeConfig: Parameters<typeof createAgentRuntime>[0],
			) => createAgentRuntime({ ...runtimeConfig, model }),
		};
		const session = new SessionRuntime(config, deps);
		let resumed: SessionRuntime | undefined;
		let finishedOutput: unknown;
		session.subscribeEvents((event) => {
			if (event.type === "content_end" && event.contentType === "tool")
				finishedOutput = event.output;
		});
		function projectedResult(): AgentToolResultPart {
			for (const message of captured.at(-1) ?? [])
				for (const part of message.content)
					if (part.type === "tool-result") return part;
			throw new Error("Missing projected tool result");
		}
		try {
			if (blocked) await writeFile(join(root, "cache"), "blocked");
			expect((await session.run("go")).text).toBe("done");
			expect(finishedOutput).toBe(full);
			expect(JSON.stringify(session.getMessages())).toContain(
				JSON.stringify(full).slice(1, -1),
			);
			expect(JSON.stringify(projectedResult().output)).not.toContain(full);
			if (blocked) {
				expect(JSON.stringify(projectedResult().output)).not.toContain(
					"cached temporarily",
				);
				expect(logger.log).toHaveBeenCalledWith(
					expect.stringContaining("Unable to cache"),
					{ severity: "warn" },
				);
				return;
			}
			const entries = projectedResult().output as Array<{ text?: string }>;
			const notice = entries.find((entry) =>
				entry.text?.startsWith("Full result cached"),
			)?.text;
			const path = notice?.match(/cached temporarily at (.+)\. Search/)?.[1];
			expect(path).toBeDefined();
			if (!path) throw new Error("Missing recovery path");
			expect(await readFile(path, "utf8")).toBe(full);
			const inode = (await stat(path)).ino;
			await session.continue("follow up");
			expect((await stat(path)).ino).toBe(inode);
			const messages = session.getMessages();
			await session.shutdown();
			const expired = new Date(Date.now() - TOOL_RESULT_CACHE_TTL_MS * 2);
			await utimes(path, expired, expired);
			await pruneToolResultCache(toolResultCacheRoot());
			await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
			resumed = new SessionRuntime(
				{ ...config, initialMessages: messages },
				deps,
			);
			await resumed.continue("resume");
			expect(await readFile(path, "utf8")).toBe(full);
			expect(JSON.stringify(projectedResult().output)).toContain(
				"cached temporarily",
			);
		} finally {
			await session.shutdown();
			await resumed?.shutdown();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true });
		}
	});
});
