import { createAgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentMessage,
	AgentModel,
	AgentToolResultPart,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createDefaultTools } from "../../extensions/tools/definitions";
import { createFileReadExecutor } from "../../extensions/tools/executors/file-read";
import { TOOL_RESULT_CACHE_MISS } from "../../session/services/tool-result-cache";
import { SessionRuntime } from "./session-runtime-orchestrator";

function findResult(
	messages: readonly AgentMessage[],
	name: string,
): AgentToolResultPart | undefined {
	return messages
		.flatMap((message) => [...message.content])
		.find(
			(part): part is AgentToolResultPart =>
				part.type === "tool-result" && part.toolName === name,
		);
}

describe("runtime memory result recovery", () => {
	it("does not advertise recovery when read_files is unavailable", async () => {
		let calls = 0;
		const model: AgentModel = {
			async stream(request) {
				const first = calls++ === 0;
				if (!first) {
					const output = findResult(request.messages, "external")?.output;
					expect(JSON.stringify(output)).not.toContain("cline://cache/");
					expect(JSON.stringify(output)).not.toContain("Use read_files");
					expect(JSON.stringify(output)?.length).toBeLessThan(9000);
				}
				return (async function* () {
					if (first) {
						yield {
							type: "tool-call-delta" as const,
							toolCallId: "external-call",
							toolName: "external",
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
		const session = new SessionRuntime(
			{
				providerId: "anthropic",
				modelId: "claude-3-5-sonnet",
				apiKey: "test",
				sessionId: "without-reader",
				systemPrompt: "test",
				tools: [
					{
						name: "external",
						description: "test",
						inputSchema: { type: "object" },
						resultPolicy: "cache-oversized",
						execute: async () => "x".repeat(20000),
					},
				],
			},
			{
				createAgentRuntimeImpl: (config) =>
					createAgentRuntime({ ...config, model }),
			},
		);
		try {
			expect((await session.run("go")).text).toBe("done");
			expect(calls).toBe(2);
		} finally {
			await session.shutdown();
		}
	});
	it("reads omitted content through the real read_files tool and expires across follow-up turns", async () => {
		const full = Array.from(
			{ length: 4000 },
			(_, index) => `row_${index + 1}: original external response`,
		).join("\n");
		let calls = 0;
		let uri = "";
		let readExpired = false;
		let emittedExpiredRead = false;
		const captured: AgentMessage[][] = [];
		const model: AgentModel = {
			async stream(request) {
				captured.push([...request.messages]);
				const call = calls++;
				let toolName: string | undefined;
				let input: unknown = {};
				if (call === 0) toolName = "custom_external_name";
				else if (call === 1) {
					const output = findResult(request.messages, "custom_external_name")
						?.output as Array<{ text?: string }>;
					uri =
						output
							.map((entry) => entry.text ?? "")
							.join("\n")
							.match(/cline:\/\/cache\/[^ ]+\.result\.txt/)?.[0] ?? "";
					expect(uri).not.toBe("");
					expect(JSON.stringify(output)).not.toContain("row_2000:");
					toolName = "read_files";
					input = { files: [{ path: uri, start_line: 2000, end_line: 2001 }] };
				} else if (call === 2) {
					expect(
						JSON.stringify(findResult(request.messages, "read_files")?.output),
					).toContain("row_2000:");
				} else if (readExpired && !emittedExpiredRead) {
					emittedExpiredRead = true;
					toolName = "read_files";
					input = { files: [{ path: uri, start_line: 2000, end_line: 2001 }] };
				} else if (readExpired) {
					const reads = request.messages
						.flatMap((message) => [...message.content])
						.filter(
							(part) =>
								part.type === "tool-result" && part.toolName === "read_files",
						);
					expect(JSON.stringify(reads.at(-1))).toContain(
						TOOL_RESULT_CACHE_MISS,
					);
				}
				return (async function* () {
					if (toolName) {
						yield {
							type: "tool-call-delta" as const,
							toolCallId: `call_${call}`,
							toolName,
							inputText: JSON.stringify(input),
						};
						yield { type: "finish" as const, reason: "tool-calls" as const };
					} else {
						yield { type: "text-delta" as const, text: "done" };
						yield { type: "finish" as const, reason: "stop" as const };
					}
				})();
			},
		};
		const config: AgentConfig = {
			providerId: "anthropic",
			modelId: "claude-3-5-sonnet",
			apiKey: "test",
			sessionId: "session",
			systemPrompt: "test",
			tools: [
				{
					name: "custom_external_name",
					description: "test",
					inputSchema: { type: "object" },
					resultPolicy: "cache-oversized",
					execute: async () => full,
				},
				...createDefaultTools({
					executors: { readFile: createFileReadExecutor() },
				}),
			],
		};
		const deps = {
			createAgentRuntimeImpl: (
				config: Parameters<typeof createAgentRuntime>[0],
			) => createAgentRuntime({ ...config, model }),
		};
		const session = new SessionRuntime(config, deps);
		let resumed: SessionRuntime | undefined;
		let finishedOutput: unknown;
		session.subscribeEvents((event) => {
			if (
				event.type === "content_end" &&
				event.toolName === "custom_external_name"
			)
				finishedOutput = event.output;
		});
		try {
			expect((await session.run("go")).text).toBe("done");
			expect(finishedOutput).toBe(full);
			expect(JSON.stringify(session.getMessages())).toContain(
				JSON.stringify(full).slice(1, -1),
			);
			for (let index = 0; index < 3; index++)
				await session.continue("follow up");
			expect(
				JSON.stringify(
					findResult(captured.at(-1) ?? [], "custom_external_name")?.output,
				),
			).toContain(uri);
			await session.continue("five iterations since read");
			expect(findResult(captured.at(-1) ?? [], "custom_external_name")).toEqual(
				findResult(captured[1], "custom_external_name"),
			);
			expect(JSON.stringify(captured.at(-1))).not.toContain(
				TOOL_RESULT_CACHE_MISS,
			);
			readExpired = true;
			expect((await session.continue("read expired result")).text).toBe("done");
			const history = session.getMessages();
			await session.shutdown();
			emittedExpiredRead = false;
			resumed = new SessionRuntime(
				{ ...config, initialMessages: history },
				deps,
			);
			expect((await resumed.continue("resume and read old URI")).text).toBe(
				"done",
			);
		} finally {
			await session.shutdown();
			await resumed?.shutdown();
		}
	});
});
