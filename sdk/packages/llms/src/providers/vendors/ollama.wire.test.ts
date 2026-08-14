// Wire-contract tests for the Ollama vendor, exercised through the *real*
// `ollama-ai-provider-v2` package (patched via
// `patches/ollama-ai-provider-v2@4.0.1.patch`) rather than a mocked
// constructor. Each test drives `doStream` through the vendor module with a
// stubbed fetch and asserts on the actual `/api/chat` request body or the
// parsed stream, so regressions inside the dependency's request converter and
// stream parser are caught here:
//
//   1. an unset thinking setting must be *omitted* from the request (not sent
//      as `think: false`), so the Ollama server default applies;
//   2. a mid-stream `{"error": ...}` object must surface as an error stream
//      part with an `error` finish reason — not be dropped and reported as a
//      clean finish;
//   3. an attachment-only user turn must serialize `content` as a string
//      (Ollama declares `Message.content` as a string), never `[]`;
//   4. tool results must carry the documented `tool_name` field.
import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Prompt,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createOllamaProviderModule } from "./ollama";

interface OllamaChatRequest {
	model: string;
	messages: Array<Record<string, unknown>>;
	think?: boolean;
	options?: Record<string, unknown>;
	[key: string]: unknown;
}

interface WireResult {
	/** Bodies of every `/api/chat` request the vendor issued. */
	requests: OllamaChatRequest[];
	/** All stream parts surfaced to the consumer. */
	parts: LanguageModelV4StreamPart[];
}

const DONE_CHUNK = {
	model: "test-model",
	created_at: "2024-01-01T00:00:00Z",
	done: true,
	done_reason: "stop",
	message: { role: "assistant", content: "" },
	prompt_eval_count: 1,
	eval_count: 1,
};

function textChunk(content: string): Record<string, unknown> {
	return {
		model: "test-model",
		created_at: "2024-01-01T00:00:00Z",
		done: false,
		message: { role: "assistant", content },
	};
}

/**
 * Run one `doStream` turn through the vendor module against a canned NDJSON
 * response, capturing the outgoing request bodies and the resulting stream.
 */
async function streamThroughVendor({
	responseLines,
	prompt,
	providerOptions,
}: {
	responseLines: Array<Record<string, unknown>>;
	prompt: LanguageModelV4Prompt;
	providerOptions?: LanguageModelV4CallOptions["providerOptions"];
}): Promise<WireResult> {
	const requests: OllamaChatRequest[] = [];
	const fetchStub = (async (_input, init) => {
		requests.push(JSON.parse(init?.body as string));
		const body = `${responseLines.map((line) => JSON.stringify(line)).join("\n")}\n`;
		return new Response(body, {
			status: 200,
			headers: { "content-type": "application/x-ndjson" },
		});
	}) as typeof fetch;

	const module = await createOllamaProviderModule(
		{ providerId: "ollama", fetch: fetchStub } as GatewayResolvedProviderConfig,
		{
			provider: {
				id: "ollama",
				name: "Ollama",
				defaultModelId: "",
				models: [],
			},
			model: { id: "test-model", name: "test-model", providerId: "ollama" },
		} as unknown as GatewayProviderContext,
	);
	const model = module.operations.language("test-model");
	const result = await model.doStream({
		prompt,
		...(providerOptions ? { providerOptions } : {}),
	} as LanguageModelV4CallOptions);

	const parts: LanguageModelV4StreamPart[] = [];
	const reader = result.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		parts.push(value);
	}
	return { requests, parts };
}

function userText(text: string): LanguageModelV4Prompt {
	return [{ role: "user", content: [{ type: "text", text }] }];
}

describe("ollama wire contract (real provider package)", () => {
	it("omits think from the request when no reasoning setting is given", async () => {
		const { requests } = await streamThroughVendor({
			responseLines: [textChunk("hi"), DONE_CHUNK],
			prompt: userText("hello"),
		});

		expect(requests).toHaveLength(1);
		// An omitted `think` lets the Ollama server default (auto-thinking for
		// capable models) apply; `think: false` would force-disable it.
		expect(requests[0]).not.toHaveProperty("think");
	});

	it("passes explicit think settings through to the request body", async () => {
		const enabled = await streamThroughVendor({
			responseLines: [textChunk("hi"), DONE_CHUNK],
			prompt: userText("hello"),
			providerOptions: { ollama: { think: true } },
		});
		expect(enabled.requests[0].think).toBe(true);

		const disabled = await streamThroughVendor({
			responseLines: [textChunk("hi"), DONE_CHUNK],
			prompt: userText("hello"),
			providerOptions: { ollama: { think: false } },
		});
		expect(disabled.requests[0].think).toBe(false);
	});

	it("routes options.num_ctx through the provider bucket", async () => {
		const { requests } = await streamThroughVendor({
			responseLines: [textChunk("hi"), DONE_CHUNK],
			prompt: userText("hello"),
			providerOptions: { ollama: { options: { num_ctx: 65536 } } },
		});
		expect(requests[0].options).toEqual({ num_ctx: 65536 });
	});

	it("serializes an attachment-only user turn with string content", async () => {
		const { requests } = await streamThroughVendor({
			responseLines: [textChunk("hi"), DONE_CHUNK],
			prompt: [
				{
					role: "user",
					content: [
						{
							type: "file",
							mediaType: "image/png",
							data: { type: "data", data: "iVBORw0KGgoAAAANSUhEUg==" },
						},
					],
				},
			],
		});

		const [message] = requests[0].messages;
		expect(message.role).toBe("user");
		// Ollama declares `Message.content` as a string; `[]` is off-contract.
		expect(message.content).toBe("");
		expect(message.images).toHaveLength(1);
	});

	it("includes tool_name on tool result messages", async () => {
		const { requests } = await streamThroughVendor({
			responseLines: [textChunk("done"), DONE_CHUNK],
			prompt: [
				...userText("read a file"),
				{
					role: "assistant",
					content: [
						{
							type: "tool-call",
							toolCallId: "call-1",
							toolName: "read_file",
							input: { path: "a.ts" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call-1",
							toolName: "read_file",
							output: { type: "text", value: "file contents" },
						},
					],
				},
			],
		});

		const toolMessage = requests[0].messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage).toMatchObject({
			tool_call_id: "call-1",
			tool_name: "read_file",
			content: "file contents",
		});
	});

	it("surfaces a mid-stream error object as an error part, not a clean finish", async () => {
		const { requests, parts } = await streamThroughVendor({
			responseLines: [
				textChunk("partial "),
				{ error: "model crashed while generating" },
			],
			prompt: userText("hello"),
		});

		const errorPart = parts.find((part) => part.type === "error");
		expect(errorPart).toBeDefined();
		expect((errorPart as { error: unknown }).error).toBe(
			"model crashed while generating",
		);

		const finishPart = parts.find((part) => part.type === "finish");
		expect(finishPart).toBeDefined();
		expect(
			(finishPart as { finishReason: { unified: string } }).finishReason
				.unified,
		).toBe("error");

		// The empty-response retry middleware (applied centrally in
		// `ai-sdk.ts`, outside this vendor module) must not mask the failure
		// by re-issuing the request; error finishes are never retried.
		expect(requests).toHaveLength(1);
	});
});
