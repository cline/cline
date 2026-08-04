import type {
	AgentMessage,
	BasicLogger,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "./ai-sdk";

/**
 * Regression tests for the Gemini "function_response.name: Name cannot be
 * empty." 400 (production, SDK extension).
 *
 * Tool-result parts restored from persisted histories can carry an empty or
 * missing `toolName`:
 *   - tasks imported from the legacy extension store Anthropic-format
 *     `tool_result` blocks, which have no `name` field, and
 *   - SDK sessions persisted before `ToolResultContent.name` existed
 *     deserialize with `name: undefined`.
 *
 * `@ai-sdk/google` serializes `functionResponse.name` verbatim from the
 * tool-result part's `toolName`, and the Generative Language API rejects the
 * whole request when it is empty. These tests drive the real Google provider
 * adapter with a capturing fetch stub and assert the wire payload carries the
 * originating tool-call's name on every functionResponse part.
 */

const GOOGLE_SSE_RESPONSE = `data: ${JSON.stringify({
	candidates: [
		{
			content: { parts: [{ text: "done" }], role: "model" },
			finishReason: "STOP",
			index: 0,
		},
	],
	usageMetadata: {
		promptTokenCount: 10,
		candidatesTokenCount: 2,
		totalTokenCount: 12,
	},
})}\n\ndata: [DONE]\n\n`;

interface CapturedGoogleRequest {
	contents: Array<{
		role: string;
		parts: Array<Record<string, unknown>>;
	}>;
}

async function streamAndCaptureGoogleRequest(
	messages: AgentMessage[],
	logger?: BasicLogger,
): Promise<CapturedGoogleRequest> {
	let capturedBody: string | undefined;
	const config = {
		providerId: "google",
		apiKey: "test-key",
		fetch: (async (_input: unknown, init?: RequestInit) => {
			capturedBody =
				typeof init?.body === "string" ? init.body : String(init?.body);
			return new Response(GOOGLE_SSE_RESPONSE, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}) as unknown as typeof fetch,
	};
	const provider = await createGoogleProvider(config as never);
	const model = {
		id: "gemini-2.5-flash",
		providerId: "google",
		name: "Gemini 2.5 Flash",
	};
	const context = {
		provider: {
			id: "google",
			name: "Google",
			defaultModelId: model.id,
			models: [model],
		},
		model,
		config,
		logger,
	} as unknown as GatewayProviderContext;
	const request = {
		providerId: "google",
		modelId: model.id,
		messages,
	} as unknown as GatewayStreamRequest;

	for await (const _event of await provider.stream(request, context)) {
		// Drain the stream so the request is issued.
	}

	expect(capturedBody).toBeDefined();
	return JSON.parse(capturedBody ?? "{}") as CapturedGoogleRequest;
}

function collectFunctionResponseNames(body: CapturedGoogleRequest): string[] {
	const names: string[] = [];
	for (const content of body.contents ?? []) {
		for (const part of content.parts ?? []) {
			const functionResponse = part.functionResponse as
				| { name?: unknown }
				| undefined;
			if (functionResponse !== undefined) {
				names.push(
					typeof functionResponse.name === "string"
						? functionResponse.name
						: "",
				);
			}
		}
	}
	return names;
}

function conversationWithToolResultName(
	toolName: string | undefined,
): AgentMessage[] {
	const createdAt = Date.now();
	return [
		{
			id: "msg_user",
			role: "user",
			content: [{ type: "text", text: "read the readme" }],
			createdAt,
		},
		{
			id: "msg_assistant",
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "toolu_1",
					toolName: "read_files",
					input: { files: [{ path: "README.md" }] },
				},
			],
			createdAt,
		},
		{
			id: "msg_tool",
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_1",
					// Restored histories can violate the non-optional type.
					toolName: toolName as string,
					output: "# README\ncontents",
				},
			],
			createdAt,
		},
	];
}

describe("google tool-result name serialization", () => {
	it("keeps the tool name carried on the tool-result part", async () => {
		const body = await streamAndCaptureGoogleRequest(
			conversationWithToolResultName("read_files"),
		);
		expect(collectFunctionResponseNames(body)).toEqual(["read_files"]);
	});

	it("backfills an empty tool name from the paired tool call (legacy extension import)", async () => {
		const body = await streamAndCaptureGoogleRequest(
			conversationWithToolResultName(""),
		);
		expect(collectFunctionResponseNames(body)).toEqual(["read_files"]);
	});

	it("backfills a missing tool name from the paired tool call (pre-name persisted session)", async () => {
		const body = await streamAndCaptureGoogleRequest(
			conversationWithToolResultName(undefined),
		);
		expect(collectFunctionResponseNames(body)).toEqual(["read_files"]);
	});

	it("logs when the backfill engages", async () => {
		const log = vi.fn();
		const logger: BasicLogger = { debug: vi.fn(), log };
		await streamAndCaptureGoogleRequest(
			conversationWithToolResultName(""),
			logger,
		);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("backfilled missing tool name"),
			expect.objectContaining({ toolName: "read_files" }),
		);
	});

	it("falls back to a placeholder name for an orphaned tool-result", async () => {
		const createdAt = Date.now();
		const body = await streamAndCaptureGoogleRequest([
			{
				id: "msg_user",
				role: "user",
				content: [{ type: "text", text: "hello" }],
				createdAt,
			},
			{
				id: "msg_tool",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "toolu_orphan",
						toolName: "" as string,
						output: "orphaned result",
					},
				],
				createdAt,
			},
		]);
		const names = collectFunctionResponseNames(body);
		expect(names).toHaveLength(1);
		expect(names[0]).not.toBe("");
	});
});
