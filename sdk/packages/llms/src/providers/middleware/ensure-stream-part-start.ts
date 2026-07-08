import type { LanguageModelV3Middleware } from "@ai-sdk/provider";

type StreamChunk = { type: string; id?: string; [key: string]: unknown };

/**
 * Some OpenAI-compatible backends (e.g. llama.cpp server-rocm) omit the `content`
 * key on early SSE deltas. The `@ai-sdk/openai-compatible` provider only emits
 * `text-start` once non-empty `delta.content` arrives, but AI SDK 6.x requires
 * a matching `text-start` before every `text-delta`/`text-end` pair. Without
 * it, streamText surfaces `text part <id> not found` and the turn fails.
 *
 * This middleware synthesizes missing `*-start` events at the provider stream
 * layer so downstream AI SDK bookkeeping stays consistent.
 */
export const ensureStreamPartStartMiddleware: LanguageModelV3Middleware = {
	specificationVersion: "v3",
	wrapStream: async ({ doStream }) => {
		const { stream, ...rest } = await doStream();
		const activeText = new Set<string>();
		const activeReasoning = new Set<string>();

		const normalized = stream.pipeThrough(
			new TransformStream<StreamChunk, StreamChunk>({
				transform(chunk, controller) {
					switch (chunk.type) {
						case "text-start": {
							if (typeof chunk.id === "string") {
								activeText.add(chunk.id);
							}
							controller.enqueue(chunk);
							return;
						}
						case "text-delta":
						case "text-end": {
							if (typeof chunk.id === "string" && !activeText.has(chunk.id)) {
								controller.enqueue({ type: "text-start", id: chunk.id });
								activeText.add(chunk.id);
							}
							controller.enqueue(chunk);
							if (chunk.type === "text-end" && typeof chunk.id === "string") {
								activeText.delete(chunk.id);
							}
							return;
						}
						case "reasoning-start": {
							if (typeof chunk.id === "string") {
								activeReasoning.add(chunk.id);
							}
							controller.enqueue(chunk);
							return;
						}
						case "reasoning-delta":
						case "reasoning-end": {
							if (
								typeof chunk.id === "string" &&
								!activeReasoning.has(chunk.id)
							) {
								controller.enqueue({
									type: "reasoning-start",
									id: chunk.id,
								});
								activeReasoning.add(chunk.id);
							}
							controller.enqueue(chunk);
							if (
								chunk.type === "reasoning-end" &&
								typeof chunk.id === "string"
							) {
								activeReasoning.delete(chunk.id);
							}
							return;
						}
						default:
							controller.enqueue(chunk);
					}
				},
			}),
		);

		return { stream: normalized, ...rest };
	},
};

export function isRecoverableAiSdkStreamPartError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return (
		/^text part .+ not found$/.test(message) ||
		/^reasoning part .+ not found$/.test(message)
	);
}
