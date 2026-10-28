import { createAgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentMessage,
	AgentModel,
	MessageWithMetadata,
} from "@cline/shared";
import { formatMessagesForAiSdk } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createDefaultTools } from "../../extensions/tools/definitions";
import { createFileReadExecutor } from "../../extensions/tools/executors/file-read";
import type { ReadArtifact } from "../../session/services/artifact-files";
import { SessionRuntime } from "./session-runtime-orchestrator";

const artifactUri = "artifact://synthetic-frame";
const pngBase64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN3sAAAAASUVORK5CYII=";
const pngBytes = Buffer.from(pngBase64, "base64");

const priorConversation: MessageWithMetadata[] = [
	{ id: "prior-user", role: "user", ts: 1, content: "Earlier question" },
	{
		id: "prior-assistant",
		role: "assistant",
		ts: 2,
		content: "Earlier answer",
	},
];

function createReadFilesTool() {
	return createDefaultTools({
		executors: { readFile: createFileReadExecutor() },
		enableSearch: false,
		enableBash: false,
		enableWebFetch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: false,
	})[0];
}

function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		sessionId: "artifact-session",
		systemPrompt: "Inspect the attached artifact when asked.",
		tools: [createReadFilesTool()],
		...overrides,
	};
}

function runtimeDeps(model: AgentModel, readArtifact: ReadArtifact) {
	return {
		readArtifact,
		createAgentRuntimeImpl: (
			config: Parameters<typeof createAgentRuntime>[0],
		) => createAgentRuntime({ ...config, model }),
	};
}

describe("SessionRuntime artifact retrieval", () => {
	it("reads a published image on demand, persists only its reference, and rehydrates after restore", async () => {
		const readArtifact = vi.fn(async () => new Uint8Array(pngBytes));
		const requests: AgentMessage[][] = [];
		const model: AgentModel = {
			async stream(request) {
				const call = requests.length;
				requests.push([...request.messages]);
				if (call === 0) {
					const inventory = request.messages
						.flatMap((message) => [...message.content])
						.find(
							(part) =>
								part.type === "text" &&
								part.text.includes("Published files from this conversation"),
						);
					expect(inventory?.type).toBe("text");
					if (inventory?.type === "text") {
						expect(inventory.text).toContain(artifactUri);
						expect(inventory.text).not.toContain(pngBase64);
					}
				} else if (call === 1) {
					const result = request.messages
						.flatMap((message) => message.content)
						.find(
							(part) =>
								part.type === "tool-result" && part.toolName === "read_files",
						);
					expect(result?.type).toBe("tool-result");
					if (result?.type !== "tool-result")
						throw new Error("read_files result missing");
					expect(result.output).toEqual([
						{
							query: artifactUri,
							result: [
								{ type: "image", data: pngBase64, mediaType: "image/png" },
							],
							success: true,
						},
					]);
					const formatted = formatMessagesForAiSdk(undefined, [
						{
							role: "assistant",
							content: [
								{
									type: "tool-result",
									toolCallId: result.toolCallId,
									toolName: result.toolName,
									output: result.output,
								},
							],
						},
					]);
					expect(formatted[0]?.content).toMatchObject([
						{
							type: "tool-result",
							output: {
								type: "content",
								value: [
									{ type: "text", text: expect.stringContaining(artifactUri) },
									{
										type: "file",
										data: { type: "data", data: pngBase64 },
										mediaType: "image/png",
									},
								],
							},
						},
					]);
				}
				return (async function* () {
					if (call === 0) {
						yield {
							type: "tool-call-delta" as const,
							toolCallId: "read-image",
							toolName: "read_files",
							inputText: JSON.stringify({ files: [{ path: artifactUri }] }),
						};
						yield { type: "finish" as const, reason: "tool-calls" as const };
					} else {
						yield { type: "text-delta" as const, text: "The image is ready." };
						yield { type: "finish" as const, reason: "stop" as const };
					}
				})();
			},
		};
		const config = createConfig({ initialMessages: priorConversation });
		const session = new SessionRuntime(
			config,
			runtimeDeps(model, readArtifact),
		);
		let resumed: SessionRuntime | undefined;
		const restoredReadArtifact = vi.fn(async () => new Uint8Array(pngBytes));
		try {
			session.attachMedia({
				id: "synthetic-frame",
				modality: "image",
				mediaType: "image/png",
				name: "synthetic-frame.png",
				source: { type: "artifact", artifactId: "synthetic-frame" },
			});
			expect((await session.continue("Read this image")).text).toBe(
				"The image is ready.",
			);
			expect(readArtifact).toHaveBeenCalledTimes(1);
			expect(readArtifact).toHaveBeenCalledWith(
				"synthetic-frame",
				expect.objectContaining({ maxBytes: expect.any(Number) }),
			);

			const history = session.getMessages();
			const storedToolResult = history
				.flatMap((message) =>
					Array.isArray(message.content) ? message.content : [],
				)
				.find(
					(block) =>
						block.type === "tool_result" && block.name === "read_files",
				);
			expect(storedToolResult?.type).toBe("tool_result");
			if (storedToolResult?.type === "tool_result") {
				expect(storedToolResult.content).toEqual([
					{
						query: artifactUri,
						result: [
							{
								type: "media",
								media: expect.objectContaining({
									source: { type: "artifact", artifactId: "synthetic-frame" },
								}),
							},
						],
						success: true,
					},
				]);
				expect(JSON.stringify(storedToolResult.content)).not.toContain(
					pngBase64,
				);
				expect(JSON.stringify(storedToolResult.content)).not.toContain(
					"https://",
				);
			}

			const restoredHistory = structuredClone(history);
			const resumedRequests: AgentMessage[][] = [];
			const resumedModel: AgentModel = {
				async stream(request) {
					resumedRequests.push([...request.messages]);
					const result = request.messages
						.flatMap((message) => message.content)
						.find(
							(part) =>
								part.type === "tool-result" && part.toolName === "read_files",
						);
					expect(result?.type).toBe("tool-result");
					if (result?.type !== "tool-result")
						throw new Error("read_files result missing");
					expect(JSON.stringify(result.output)).toContain(pngBase64);
					return (async function* () {
						yield { type: "text-delta" as const, text: "Restored." };
						yield { type: "finish" as const, reason: "stop" as const };
					})();
				},
			};
			resumed = new SessionRuntime(
				createConfig({ initialMessages: restoredHistory }),
				runtimeDeps(resumedModel, restoredReadArtifact),
			);
			expect(
				(await resumed.continue("Read the attached image again.")).text,
			).toBe("Restored.");
			expect(resumedRequests).toHaveLength(1);
			expect(restoredReadArtifact).toHaveBeenCalledTimes(1);
			expect(restoredReadArtifact).toHaveBeenCalledWith(
				"synthetic-frame",
				expect.objectContaining({ maxBytes: expect.any(Number) }),
			);
		} finally {
			await session.shutdown();
			await resumed?.shutdown();
		}
	});

	it("reads an attached text artifact using the requested line range", async () => {
		const readArtifact = async () =>
			new TextEncoder().encode("first line\nselected line\nlast line\n");
		const requests: AgentMessage[][] = [];
		const model: AgentModel = {
			async stream(request) {
				const call = requests.length;
				requests.push([...request.messages]);
				if (call === 1) {
					const result = request.messages
						.flatMap((message) => message.content)
						.find(
							(part) =>
								part.type === "tool-result" && part.toolName === "read_files",
						);
					if (result?.type !== "tool-result")
						throw new Error("read_files result missing");
					const output = JSON.stringify(result.output);
					expect(output).toContain("2 | selected line");
					expect(output).not.toContain("first line");
					expect(output).not.toContain("last line");
				}
				return (async function* () {
					if (call === 0) {
						yield {
							type: "tool-call-delta" as const,
							toolCallId: "read-text",
							toolName: "read_files",
							inputText: JSON.stringify({
								files: [
									{
										path: "artifact://synthetic-text",
										start_line: 2,
										end_line: 2,
									},
								],
							}),
						};
						yield { type: "finish" as const, reason: "tool-calls" as const };
					} else {
						yield { type: "text-delta" as const, text: "Selected line read." };
						yield { type: "finish" as const, reason: "stop" as const };
					}
				})();
			},
		};
		const session = new SessionRuntime(
			createConfig({
				sessionId: "artifact-text-session",
				initialMessages: priorConversation,
			}),
			runtimeDeps(model, readArtifact),
		);
		try {
			session.attachMedia({
				id: "synthetic-text",
				modality: "file",
				mediaType: "application/octet-stream",
				name: "notes.txt",
				source: { type: "artifact", artifactId: "synthetic-text" },
			});
			expect((await session.continue("Read line two")).text).toBe(
				"Selected line read.",
			);
		} finally {
			await session.shutdown();
		}
	});
});
