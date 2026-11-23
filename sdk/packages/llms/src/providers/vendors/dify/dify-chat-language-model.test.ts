import { describe, expect, it } from "vitest";
import { DifyChatLanguageModel } from "./dify-chat-language-model";

function createMockFetch(mockResponse: any) {
	return async () => mockResponse;
}

// provider-utils 5 reads response bodies through a size-limited stream reader,
// so blocking-mode fixtures must be real Responses rather than { text() } stubs.
function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function makeModel(overrides: any = {}) {
	const mockFetch = overrides.fetch || createMockFetch({});
	return new DifyChatLanguageModel(
		"test-model" as any,
		{},
		{
			provider: "dify",
			baseURL: "https://mock.api",
			headers: () => ({ Authorization: "Bearer test" }),
			fetch: mockFetch,
			...overrides,
		},
	);
}

describe("DifyChatLanguageModel", () => {
	it("should handle blocking response (doGenerate)", async () => {
		const mockFetch = createMockFetch(
			jsonResponse(
				{
					id: "id1",
					answer: "Hello world",
					task_id: "task1",
					conversation_id: "conv1",
					message_id: "msg1",
					metadata: {
						usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
					},
				},
				200,
			),
		);

		const model = makeModel({ fetch: mockFetch });
		const result = await model.doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		// Validate important fields without using snapshot
		expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(result.usage.inputTokens).toBe(5);
		expect(result.usage.outputTokens).toBe(7);
		expect(result.usage.totalTokens).toBe(12);
		expect(result.warnings).toEqual([]);
		expect(result.providerMetadata).toBeDefined();
		expect(result.providerMetadata?.difyWorkflowData).toBeDefined();
		expect(result.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(result.providerMetadata?.difyWorkflowData?.messageId).toBe("msg1");
	});

	it("should handle streaming message events", async () => {
		// Proper SSE format with each event separated by double newlines
		const mockResponseText =
			`data: {"event":"message","answer":"Hel","id":"msg1"}\n\n` +
			`data: {"event":"message","answer":"lo","id":"msg1"}\n\n` +
			`data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":42,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

		// Create a mock for the fetch function with a readable stream response
		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		// Check we have text-delta parts
		const textDeltaParts = parts.filter((p) => p.type === "text-delta");
		expect(textDeltaParts.length).toBe(2);
		expect(textDeltaParts[0].delta).toBe("Hel");
		expect(textDeltaParts[1].delta).toBe("lo");

		// Check finish part
		const finishPart = parts.find((p) => p.type === "finish");
		expect(finishPart).toBeDefined();
		expect(finishPart?.providerMetadata).toBeDefined();
		expect(finishPart?.providerMetadata?.difyWorkflowData).toBeDefined();
		expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
			"msg1",
		);
		expect(finishPart?.usage?.outputTokens).toBe(42);
	});

	it("should handle workflow events in streaming mode", async () => {
		// Proper SSE format with each event separated by double newlines
		const mockResponseText =
			`data: {"event":"workflow_started","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","created_at":1625097600000}}\n\n` +
			`data: {"event":"node_started","workflow_run_id":"wfr1","data":{"id":"node1","node_id":"n1","node_type":"llm"}}\n\n` +
			`data: {"event":"message","answer":"Hello","id":"msg1"}\n\n` +
			`data: {"event":"node_finished","workflow_run_id":"wfr1","data":{"id":"node1","node_id":"n1","node_type":"llm"}}\n\n` +
			`data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":15,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

		// Create a mock for the fetch function with a readable stream response
		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		// Verify we get text delta from message event
		const textDeltaPart = parts.find((p) => p.type === "text-delta");
		expect(textDeltaPart).toBeDefined();
		expect(textDeltaPart?.delta).toBe("Hello");

		// Verify finish part from workflow_finished event
		const finishPart = parts.find((p) => p.type === "finish");
		expect(finishPart).toBeDefined();
		expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
			"msg1",
		);
		expect(finishPart?.usage?.outputTokens).toBe(15);
	});

	it("should ignore non-handled event types in streaming mode", async () => {
		// Proper SSE format with each event separated by double newlines
		const mockResponseText =
			`data: {"event":"tts_message","audio":"base64audio1","conversation_id":"conv1","message_id":"msg1"}\n\n` +
			`data: {"event":"message","answer":"Text response","id":"msg1"}\n\n` +
			`data: {"event":"tts_message_end","audio":"base64audio2","conversation_id":"conv1","message_id":"msg1"}\n\n` +
			`data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":10,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

		// Create a mock for the fetch function with a readable stream response
		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		// Check text-delta parts
		const textDeltaPart = parts.find((p) => p.type === "text-delta");
		expect(textDeltaPart).toBeDefined();
		expect(textDeltaPart?.delta).toBe("Text response");

		// Check finish part
		const finishPart = parts.find((p) => p.type === "finish");
		expect(finishPart).toBeDefined();
		expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
			"msg1",
		);
	});

	it("should skip malformed event without throwing", async () => {
		const mockResponseText = `data: not-json\n\n`;

		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });

		// The main thing we're testing is that it doesn't throw an exception
		// when receiving malformed data
		await expect(async () => {
			const { stream: resultStream } = await model.doStream({
				prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			} as any);

			const reader = resultStream.getReader();

			// Read all stream content
			while (true) {
				const { done } = await reader.read();
				if (done) break;
			}
		}).not.toThrow();
	});

	it("should throw on API error", async () => {
		const mockFetch = createMockFetch(
			jsonResponse(
				{
					code: "400",
					message: "Bad Request: Invalid input parameters",
					status: 400,
				},
				400,
			),
		);

		const model = makeModel({ fetch: mockFetch });
		let error: any;
		try {
			await model.doGenerate({
				prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			} as any);
		} catch (e) {
			error = e;
		}
		expect(error?.name).toBe("AI_APICallError");
		expect(error?.message).toBe(
			"Dify API error: Bad Request: Invalid input parameters",
		);
	});

	it("should merge headers from options with headers from this.headers()", async () => {
		let capturedUrl: string = "";
		let capturedOptions: any = {};

		const mockFetch = async (url: string, options: any) => {
			capturedUrl = url;
			capturedOptions = options;
			return jsonResponse(
				{
					id: "id1",
					answer: "Hello world",
					task_id: "task1",
					conversation_id: "conv1",
					message_id: "msg1",
					metadata: {
						usage: {
							prompt_tokens: 5,
							completion_tokens: 7,
							total_tokens: 12,
						},
					},
				},
				200,
			);
		};

		const model = makeModel({ fetch: mockFetch });
		await model.doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			headers: { "Custom-Header": "custom-value" },
		} as any);

		const getHeader = (name: string) =>
			typeof capturedOptions.headers.get === "function"
				? capturedOptions.headers.get(name)
				: Object.entries(capturedOptions.headers).find(
						([key]) => key.toLowerCase() === name,
					)?.[1];
		expect(getHeader("authorization")).toBe("Bearer test");
		expect(getHeader("custom-header")).toBe("custom-value");
	});

	it("should use default user-id when no user-id is provided", async () => {
		let capturedRequestBody: any = {};

		const mockFetch = async (url: string, options: any) => {
			capturedRequestBody = JSON.parse(options.body);
			return jsonResponse(
				{
					id: "id1",
					answer: "Hello world",
					task_id: "task1",
					conversation_id: "conv1",
					message_id: "msg1",
					metadata: {
						usage: {
							prompt_tokens: 5,
							completion_tokens: 7,
							total_tokens: 12,
						},
					},
				},
				200,
			);
		};

		const model = makeModel({ fetch: mockFetch });
		await model.doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			headers: {}, // No user-id provided
		} as any);

		// Verify that the default user-id is used
		expect(capturedRequestBody.user).toBe("you_should_pass_user-id");
	});

	it("should use provided user-id when explicitly set", async () => {
		let capturedRequestBody: any = {};

		const mockFetch = async (url: string, options: any) => {
			capturedRequestBody = JSON.parse(options.body);
			return jsonResponse(
				{
					id: "id1",
					answer: "Hello world",
					task_id: "task1",
					conversation_id: "conv1",
					message_id: "msg1",
					metadata: {
						usage: {
							prompt_tokens: 5,
							completion_tokens: 7,
							total_tokens: 12,
						},
					},
				},
				200,
			);
		};

		const model = makeModel({ fetch: mockFetch });
		await model.doGenerate({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			headers: { "user-id": "custom-user-123" }, // Explicit user-id provided
		} as any);

		// Verify that the provided user-id is used instead of default
		expect(capturedRequestBody.user).toBe("custom-user-123");
	});

	it("should handle message_end and agent_message events", async () => {
		// Test both message_end (finish event) and agent_message (text-delta event)
		const mockResponseText =
			`data: {"event":"agent_message","answer":"Agent response","id":"agent1","conversation_id":"conv1","message_id":"msg1"}\n\n` +
			`data: {"event":"message_end","id":"msg1","metadata":{"usage":{"prompt_tokens":10,"completion_tokens":25,"total_tokens":35}},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		// Verify agent_message produces text-delta
		const textDeltaPart = parts.find((p) => p.type === "text-delta");
		expect(textDeltaPart).toBeDefined();
		expect(textDeltaPart?.delta).toBe("Agent response");

		// Verify agent_message produces response-metadata
		const metadataPart = parts.find((p) => p.type === "response-metadata");
		expect(metadataPart).toBeDefined();
		expect(metadataPart?.id).toBe("agent1");

		// Verify message_end produces finish event
		const finishPart = parts.find((p) => p.type === "finish");
		expect(finishPart).toBeDefined();
		expect(finishPart?.finishReason).toBe("stop");
		expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
			"msg1",
		);
		expect(finishPart?.usage?.outputTokens).toBe(25); // message_end doesn't have data.data.total_tokens
	});

	it("should emit retriever resources as source parts", async () => {
		const retrieverResource = {
			segment_id: "segment-1",
			document_id: "document-1",
			document_name: "Knowledge Base.md",
			dataset_name: "Support docs",
			content: "Relevant source excerpt",
			score: 0.98,
		};
		const mockResponseText =
			`data: {"event":"agent_message","answer":"Agent response","id":"agent1","conversation_id":"conv1","message_id":"msg1"}\n\n` +
			`data: ${JSON.stringify({
				event: "message_end",
				id: "msg1",
				metadata: {
					usage: { prompt_tokens: 10, completion_tokens: 25, total_tokens: 35 },
					retriever_resources: [retrieverResource],
				},
				conversation_id: "conv1",
				message_id: "msg1",
				task_id: "task1",
			})}\n\n`;

		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		const sourcePart = parts.find((p) => p.type === "source");
		expect(sourcePart).toMatchObject({
			type: "source",
			sourceType: "document",
			id: "segment-1",
			mediaType: "text/plain",
			title: "Knowledge Base.md",
			filename: "Knowledge Base.md",
			providerMetadata: {
				difyWorkflowData: {
					conversationId: "conv1",
					messageId: "msg1",
					taskId: "task1",
					retrieverResource,
				},
			},
		});
	});

	it("should handle message_end with usage tokens from data field", async () => {
		// Test message_end event with usage tokens in data.total_tokens (like workflow_finished)
		const mockResponseText = `data: {"event":"message_end","id":"msg1","data":{"total_tokens":50},"metadata":{"usage":{"prompt_tokens":10,"completion_tokens":25,"total_tokens":35}},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

		const mockFetch = createMockFetch({
			ok: true,
			headers: new Map([["Content-Type", "text/event-stream"]]),
			body: new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					controller.enqueue(encoder.encode(mockResponseText));
					controller.close();
				},
			}),
			status: 200,
		});

		const model = makeModel({ fetch: mockFetch });
		const { stream: resultStream } = await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
		} as any);

		const parts: any[] = [];
		const reader = resultStream.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			parts.push(value);
		}

		// Verify message_end produces finish event with usage tokens from data field
		const finishPart = parts.find((p) => p.type === "finish");
		expect(finishPart).toBeDefined();
		expect(finishPart?.finishReason).toBe("stop");
		expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
			"conv1",
		);
		expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
			"msg1",
		);
		expect(finishPart?.usage?.outputTokens).toBe(25); // Should use data.total_tokens, not metadata.usage.total_tokens
	});
});
