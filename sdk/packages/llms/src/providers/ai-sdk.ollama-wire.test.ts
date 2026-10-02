import type {
	AgentModelEvent,
	GatewayModelCapability,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaProvider } from "./ai-sdk";

const IMAGE =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const tool = {
	name: "read_files",
	description: "Read files",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
	},
};
function context(
	id: string,
	capabilities?: GatewayModelCapability[],
): GatewayProviderContext {
	const model = {
		id,
		name: id,
		providerId: "ollama",
		...(capabilities ? { capabilities } : {}),
	};
	return {
		model,
		provider: {
			id: "ollama",
			name: "Ollama",
			defaultModelId: id,
			models: [model],
		},
		config: { providerId: "ollama" },
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn() },
	} as GatewayProviderContext;
}
function request(
	id: string,
	image = false,
	tools = true,
): GatewayStreamRequest {
	return {
		providerId: "ollama",
		modelId: id,
		messages: [
			{
				id: "msg",
				role: "user",
				createdAt: new Date(),
				content: [
					{ type: "text", text: "Look at this and read a file" },
					...(image
						? [
								{
									type: "image",
									image: `data:image/png;base64,${IMAGE}`,
									mediaType: "image/png",
								},
							]
						: []),
				],
			},
		],
		...(tools ? { tools: [tool] } : {}),
	} as GatewayStreamRequest;
}
function chatResponse(model: string) {
	return new Response(
		[
			{
				model,
				created_at: "2024-01-01T00:00:00Z",
				done: false,
				message: { role: "assistant", content: "hello" },
			},
			{
				model,
				created_at: "2024-01-01T00:00:00Z",
				done: true,
				done_reason: "stop",
				message: { role: "assistant", content: "" },
				prompt_eval_count: 1,
				eval_count: 1,
			},
		]
			.map((c) => JSON.stringify(c))
			.join("\n") + "\n",
		{ headers: { "content-type": "application/x-ndjson" } },
	);
}
async function collect(
	iterable:
		| AsyncIterable<AgentModelEvent>
		| Promise<AsyncIterable<AgentModelEvent>>,
) {
	const events: AgentModelEvent[] = [];
	for await (const event of await iterable) events.push(event);
	return events;
}
interface WireRequest {
	model: string;
	messages: Array<{ images?: string[] }>;
	tools?: unknown[];
	tool_choice?: string;
}

function harness(metadata: (id: string) => unknown | Promise<unknown>) {
	const calls: { url: string; body: WireRequest; init?: RequestInit }[] = [];
	const fetch = vi.fn(
		async (
			input: Parameters<typeof globalThis.fetch>[0],
			init?: RequestInit,
		) => {
			const body = JSON.parse(String(init?.body)) as WireRequest;
			calls.push({ url: String(input), body, init });
			if (String(input).endsWith("/show")) {
				const data = await metadata(body.model);
				if (data instanceof Error) throw data;
				if (data instanceof Response) return data;
				return Response.json(data);
			}
			expect(String(input)).toMatch(/\/api\/chat$/);
			return chatResponse(body.model);
		},
	) as unknown as typeof globalThis.fetch;
	return {
		fetch,
		calls,
		chat: (id: string) => {
			const call = calls.find(
				(c) => c.url.endsWith("/chat") && c.body.model === id,
			);
			if (!call) throw new Error(`No chat request captured for ${id}`);
			return call.body;
		},
	};
}

describe("Ollama tool capability wire contract", () => {
	it.each([
		["capable", { capabilities: ["completion", "tools"] }, true],
		["incapable", { capabilities: ["completion"] }, false],
		["unknown", {}, false],
		["malformed", { capabilities: false }, false],
		["empty", { capabilities: [] }, false],
		["failed", new Error("metadata offline"), false],
		["http-failed", new Response("{}", { status: 500 }), false],
	])("real wire, model-scoped metadata, text and immutability for %s", async (id, metadata, supportsTools) => {
		const h = harness(() => metadata);
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const ctx = context(id as string, ["text", "tools", "images"]);
		Object.freeze(ctx.model.capabilities);
		Object.freeze(ctx.model);
		Object.freeze(ctx);
		const events = await collect(
			provider.stream(request(id as string, true), ctx),
		);
		expect(h.calls.map((c) => c.url)).toEqual([
			"http://127.0.0.1:11434/api/show",
			"http://127.0.0.1:11434/api/chat",
		]);
		expect(h.calls[0].body).toEqual({ model: id });
		expect(h.calls[0].init?.method).toBe("POST");
		const body = h.chat(id as string);
		expect(body).toBeDefined();
		expect(body.messages[0].images).toEqual([IMAGE]);
		if (supportsTools)
			expect(body.tools).toEqual([
				expect.objectContaining({
					type: "function",
					function: expect.objectContaining({ name: "read_files" }),
				}),
			]);
		else expect(Object.hasOwn(body, "tools")).toBe(false);
		if (!supportsTools) expect(Object.hasOwn(body, "tool_choice")).toBe(false);
		else expect(body.tool_choice).toBe("auto");
		expect(Object.hasOwn(body, "toolChoice")).toBe(false);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "hello" }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "finish", reason: "stop" }),
		);
		expect(ctx.model.capabilities).toEqual(["text", "tools", "images"]);
		if (
			["unknown", "malformed", "failed", "http-failed"].includes(id as string)
		)
			expect(ctx.logger?.log).toHaveBeenCalledWith(
				expect.stringContaining("tool capability"),
				expect.objectContaining({ modelId: id, severity: "warn" }),
			);
	});

	it("observes same-model catalog refresh and reverse model switching without shared state", async () => {
		let capable = false;
		const h = harness(() => ({
			capabilities: capable ? ["completion", "tools"] : ["completion"],
		}));
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const ctx = context("same-model");
		await collect(provider.stream(request("same-model"), ctx));
		capable = true;
		await collect(provider.stream(request("same-model"), ctx));
		capable = false;
		await collect(provider.stream(request("new-model"), context("new-model")));
		const chats = h.calls.filter((c) => c.url.endsWith("/chat"));
		expect(chats.map((c) => Object.hasOwn(c.body, "tools"))).toEqual([
			false,
			true,
			false,
		]);
		expect(ctx.model.capabilities).toBeUndefined();
		expect(h.calls.filter((c) => c.url.endsWith("/show"))).toHaveLength(3);
	});

	it("isolates deliberately overlapped requests at real fetch boundary", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const h = harness(async (id) => {
			if (id === "slow") {
				started.resolve();
				await release.promise;
				return { capabilities: ["completion", "tools"] };
			}
			return { capabilities: ["completion"] };
		});
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const slowCtx = context("slow");
		const fastCtx = context("fast");
		const slow = collect(provider.stream(request("slow"), slowCtx));
		await started.promise;
		await collect(provider.stream(request("fast"), fastCtx));
		release.resolve();
		await slow;
		expect(
			h.calls.filter((c) => c.url.endsWith("/chat")).map((c) => c.body.model),
		).toEqual(["fast", "slow"]);
		expect(Object.hasOwn(h.chat("fast"), "tools")).toBe(false);
		expect(h.chat("slow").tools).toHaveLength(1);
		expect(slowCtx.model.capabilities).toBeUndefined();
		expect(fastCtx.model.capabilities).toBeUndefined();
	});

	it("skips metadata lookup for text-only no-tool requests", async () => {
		const h = harness(() => {
			throw new Error("Unexpected metadata lookup");
		});
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const events = await collect(
			provider.stream(request("plain", false, false), context("plain")),
		);
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0].url).toBe("http://127.0.0.1:11434/api/chat");
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "hello" }),
		);
	});

	it.each([
		["capable", { capabilities: ["completion", "vision", "tools"] }],
		["incapable", { capabilities: ["completion", "vision"] }],
		["unknown", {}],
		["failed", new Error("metadata offline")],
	])("preserves unspecified image input when tool metadata is %s", async (_name, metadata) => {
		const h = harness(() => metadata);
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const ctx = context("vision-model");
		const events = await collect(
			provider.stream(request("vision-model", true), ctx),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "finish", reason: "stop" }),
		);
		expect(h.chat("vision-model").messages[0].images).toEqual([IMAGE]);
		expect(ctx.model.capabilities).toBeUndefined();
		expect(ctx.model.metadata).toBeUndefined();
	});

	it("preserves an explicit text-only catalog model", async () => {
		const h = harness(() => ({ capabilities: ["completion", "tools"] }));
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		await collect(
			provider.stream(
				request("text-only", true),
				context("text-only", ["text"]),
			),
		);
		expect(h.chat("text-only").messages[0]).not.toHaveProperty("images");
		expect(h.chat("text-only").tools).toHaveLength(1);
	});

	it("preserves explicit input modalities during metadata failure", async () => {
		const h = harness(() => new Error("metadata offline"));
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
		});
		const ctx = context("multimodal", ["text"]);
		ctx.model.modalities = {
			input: ["text", "image", "audio"],
			output: ["text"],
		};
		const modalities = ctx.model.modalities;
		await collect(provider.stream(request("multimodal", true), ctx));
		expect(h.chat("multimodal").messages[0].images).toEqual([IMAGE]);
		expect(h.chat("multimodal")).not.toHaveProperty("tools");
		expect(ctx.model.modalities).toBe(modalities);
	});

	it("bounds and cancels a metadata body that stalls after headers", async () => {
		vi.useFakeTimers();
		const started = Promise.withResolvers<void>();
		const cancel = vi.fn();
		const h = harness(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("{"));
							started.resolve();
						},
						cancel,
					}),
				),
		);
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
			timeoutMs: 1000,
		});
		const pending = collect(
			provider.stream(request("stalled"), context("stalled")),
		);
		await started.promise;
		await vi.advanceTimersByTimeAsync(1001);
		const events = await pending;
		expect(h.chat("stalled")).not.toHaveProperty("tools");
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "hello" }),
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(h.calls[0].init?.signal?.aborted).toBe(true);
	});

	it.each([
		"request",
		"context",
	])("cancels a stalled metadata body without sending chat (%s signal)", async (source) => {
		vi.useFakeTimers();
		const started = Promise.withResolvers<void>();
		const cancel = vi.fn();
		const h = harness(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("{"));
							started.resolve();
						},
						cancel,
					}),
				),
		);
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
			timeoutMs: 1000,
		});
		const controller = new AbortController();
		const req = request("cancelled");
		const ctx = context("cancelled");
		if (source === "request") req.signal = controller.signal;
		else ctx.signal = controller.signal;
		const pending = collect(provider.stream(req, ctx));
		await started.promise;
		controller.abort(new Error("user cancelled"));
		await pending;
		await vi.advanceTimersByTimeAsync(1001);
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0].url).toMatch(/\/show$/);
		expect(cancel).toHaveBeenCalledOnce();
		expect(ctx.logger?.log).not.toHaveBeenCalled();
	});

	it("clears the metadata deadline after successful resolution", async () => {
		vi.useFakeTimers();
		const h = harness(() => ({ capabilities: ["completion", "tools"] }));
		const provider = await createOllamaProvider({
			providerId: "ollama",
			fetch: h.fetch,
			timeoutMs: 1000,
		});
		await collect(provider.stream(request("done"), context("done")));
		await vi.advanceTimersByTimeAsync(1001);
		expect(h.calls[0].init?.signal?.aborted).toBe(false);
		expect(h.calls).toHaveLength(2);
	});
});

afterEach(() => vi.useRealTimers());
