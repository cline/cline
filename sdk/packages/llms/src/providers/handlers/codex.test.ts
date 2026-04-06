import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_CODEX_PROVIDER } from "../../models";
import { CodexHandler } from "./community-sdk";

const streamTextSpy = vi.fn();
const codexCliSpy = vi.fn((modelId: string) => ({ modelId }));
let lastCreateCodexCliOptions: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
	streamText: (input: unknown) => streamTextSpy(input),
}));

vi.mock("ai-sdk-provider-codex-cli", () => ({
	codexCli: (modelId: string) => codexCliSpy(modelId),
	createCodexCli: (options?: Record<string, unknown>) => {
		lastCreateCodexCliOptions = options;
		return (modelId: string) => codexCliSpy(modelId);
	},
}));

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
}

describe("CodexHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		lastCreateCodexCliOptions = undefined;
	});

	it("streams text and usage through AI SDK fullStream", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "Hello" },
				{
					type: "finish",
					usage: { inputTokens: 12, outputTokens: 4 },
				},
			]),
		});

		const handler = new CodexHandler({
			providerId: "openai-codex",
			modelId: "gpt-5.2-codex",
		});

		const chunks: Array<Record<string, unknown>> = [];
		for await (const chunk of handler.createMessage("System", [
			{ role: "user", content: "Hi" },
		])) {
			chunks.push(chunk as unknown as Record<string, unknown>);
		}

		expect(codexCliSpy).toHaveBeenCalledWith("gpt-5.2-codex");
		expect(chunks.map((chunk) => chunk.type)).toEqual([
			"text",
			"usage",
			"done",
		]);
		expect(chunks[0]?.text).toBe("Hello");
		expect(chunks[1]?.inputTokens).toBe(12);
		expect(chunks[1]?.outputTokens).toBe(4);
	});

	it("uses a fallback model id when model is missing", () => {
		const handler = new CodexHandler({
			providerId: "openai-codex",
			modelId: "",
		});

		expect(handler.getModel().id).toBe("gpt-5.3-codex");
	});

	it("does not map OAuth access tokens to OPENAI_API_KEY env", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish" }]),
		});

		const handler = new CodexHandler({
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
			apiKey: "oauth-token-shorthand",
			accessToken: "oauth-access-token",
		});

		for await (const _chunk of handler.createMessage("System", [
			{ role: "user", content: "Hi" },
		])) {
			// consume stream
		}

		const createOptions = lastCreateCodexCliOptions as
			| { defaultSettings?: { env?: Record<string, string> } }
			| undefined;
		expect(createOptions?.defaultSettings?.env?.OPENAI_API_KEY).toBeUndefined();
	});

	it("maps explicit OpenAI API keys to OPENAI_API_KEY env", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish" }]),
		});

		const handler = new CodexHandler({
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
			apiKey: "sk-test-key",
		});

		for await (const _chunk of handler.createMessage("System", [
			{ role: "user", content: "Hi" },
		])) {
			// consume stream
		}

		const createOptions = lastCreateCodexCliOptions as
			| { defaultSettings?: { env?: Record<string, string> } }
			| undefined;
		expect(createOptions?.defaultSettings?.env?.OPENAI_API_KEY).toBe(
			"sk-test-key",
		);
	});

	it("does not surface Codex native tool calls as local tool calls", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "tool-call",
					toolCallId: "codex-call-1",
					toolName: "read_file",
					args: { path: "README.md" },
				},
				{
					type: "finish",
					usage: { inputTokens: 8, outputTokens: 3 },
				},
			]),
		});

		const handler = new CodexHandler({
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
		});

		const chunks: Array<Record<string, unknown>> = [];
		for await (const chunk of handler.createMessage("System", [
			{ role: "user", content: "Hi" },
		])) {
			chunks.push(chunk as unknown as Record<string, unknown>);
		}

		expect(chunks.map((chunk) => chunk.type)).toEqual(["usage", "done"]);
	});

	it("does not advertise custom tool capability for Codex models", () => {
		const model = OPENAI_CODEX_PROVIDER.models["gpt-5.3-codex"];
		expect(model?.capabilities).not.toContain("tools");
	});
});
