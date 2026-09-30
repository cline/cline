import { z } from "zod";
import type { ModelInfo } from "../catalog/types";
import type { ProviderConfig } from "./config";

export const CHATGPT_PLAN_API = "https://api.openai.com/v1";

export function assertChatGPTPlanGrant(grant: unknown): void {
	const parsed = z
		.object({
			clientId: z
				.string()
				.min(1)
				.refine((id) => id !== "dynamic_agent_client"),
			issuer: z.literal("https://auth.openai.com"),
			subject: z.string().min(1),
			scopes: z.array(z.string()),
		})
		.safeParse(grant);
	if (
		!parsed.success ||
		!parsed.data.scopes.includes("chatgpt.tokens.use.direct")
	) {
		throw new Error(
			"Continue with ChatGPT and grant ChatGPT plan usage before inference (chatgpt.tokens.use.direct).",
		);
	}
}

export async function fetchChatGPTPlanModels(
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	assertChatGPTPlanGrant(config.chatgptPlan);
	const token = config.apiKey ?? config.accessToken;
	if (!token)
		throw new Error("Continue with ChatGPT to load your available models.");
	const response = await (config.fetch ?? globalThis.fetch)(
		`${CHATGPT_PLAN_API}/models`,
		{
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(30_000),
			redirect: "error",
		},
	);
	if (!response.ok)
		throw new Error(
			`ChatGPT model discovery failed (${response.status}). Sign in again if your session expired.`,
		);
	const data = z
		.object({
			models: z.array(
				z.object({
					slug: z.string().min(1),
					display_name: z.string(),
					visibility: z.string(),
				}),
			),
		})
		.parse(await response.json());
	return Object.fromEntries(
		data.models
			.filter((model) => model.visibility === "list")
			.map((model) => [
				model.slug,
				{
					id: model.slug,
					name: model.display_name,
				},
			]),
	);
}

const UNSUPPORTED_FIELDS = [
	"background",
	"conversation",
	"max_output_tokens",
	"max_tool_calls",
	"metadata",
	"moderation",
	"multi_agent",
	"prompt",
	"prompt_cache_retention",
	"safety_identifier",
	"temperature",
	"top_logprobs",
	"top_p",
	"truncation",
	"user",
	"previous_response_id",
] as const;

/** Keep the plan route's wire contract local to this transport. */
export function chatGPTPlanFetch(
	delegate: typeof fetch,
	token: string,
): typeof fetch {
	return (async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		if (
			url !== `${CHATGPT_PLAN_API}/responses` ||
			init?.method !== "POST" ||
			typeof init.body !== "string"
		) {
			throw new Error(
				"ChatGPT plan usage supports only the public streaming Responses API.",
			);
		}
		const body = JSON.parse(init.body) as Record<string, unknown>;
		if (!Array.isArray(body.input))
			throw new Error("ChatGPT plan requests require an input array.");
		for (const field of UNSUPPORTED_FIELDS) delete body[field];
		body.store = false;
		body.stream = true;
		body.input = body.input.map((item) =>
			item?.role === "system" ? { ...item, role: "developer" } : item,
		);
		const response = await delegate(url, {
			...init,
			body: JSON.stringify(body),
			redirect: "error",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
		});
		if (!response.ok || !response.body) return response;
		// Do not let an interrupted SSE response count as successful inference.
		const decoder = new TextDecoder();
		let pending = "";
		let completed = false;
		const checkLine = (line: string) => {
			if (!line.startsWith("data:")) return;
			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") return;
			const event = JSON.parse(data);
			if (event.type === "response.completed") completed = true;
			if (
				["response.failed", "response.incomplete", "error"].includes(event.type)
			) {
				const code = event.response?.error?.code ?? event.code ?? event.type;
				throw new Error(
					`ChatGPT response did not complete (${String(code)}). Check your ChatGPT plan usage settings.`,
				);
			}
		};
		return new Response(
			response.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						pending += decoder.decode(chunk, { stream: true });
						let newline = pending.indexOf("\n");
						while (newline !== -1) {
							checkLine(pending.slice(0, newline));
							pending = pending.slice(newline + 1);
							newline = pending.indexOf("\n");
						}
						controller.enqueue(chunk);
					},
					flush() {
						pending += decoder.decode();
						if (pending.trim()) checkLine(pending);
						if (!completed)
							throw new Error(
								"ChatGPT stream ended without response.completed.",
							);
					},
				}),
			),
			{
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			},
		);
	}) as typeof fetch;
}
