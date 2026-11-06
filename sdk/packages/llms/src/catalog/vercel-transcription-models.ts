import { isTranscriptionModel } from "@cline/shared";
import { z } from "zod";
import type { ProviderConfig } from "../providers/config";
import { resolveVercelAiGatewayBaseUrl } from "../providers/url";
import type { ModelInfo } from "./types";

const catalogSchema = z.object({
	data: z.array(
		z.object({
			id: z.string().trim().min(1),
			name: z.string().optional(),
			type: z.string().optional(),
			tags: z.array(z.string()).optional(),
			modalities: z
				.object({
					input: z.array(z.string()).optional(),
					output: z.array(z.string()).optional(),
				})
				.optional(),
			supported_specifications: z.array(z.string()).optional(),
		}),
	),
});

/**
 * Voice input must use the gateway's current transcription routes. The shared
 * models.dev snapshot can contain removed models and has no streaming tags.
 * Do not merge this list with bundled models or infer support from a name.
 */
export async function fetchVercelTranscriptionModels(
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const baseUrl = resolveVercelAiGatewayBaseUrl(
		config.baseUrl,
		"https://ai-gateway.vercel.sh/v4/ai",
	);
	const endpoint = `${baseUrl.slice(0, -"/v4/ai".length)}/v1/models`;
	const timeout = AbortSignal.timeout(config.timeoutMs ?? 5_000);
	const response = await (config.fetch ?? fetch)(endpoint, {
		headers: config.headers,
		signal: config.abortSignal
			? AbortSignal.any([config.abortSignal, timeout])
			: timeout,
	});
	if (!response.ok) {
		throw new Error(
			`Unable to verify Vercel AI Gateway transcription models (${response.status})`,
		);
	}
	const catalog = catalogSchema.parse(await response.json());
	return Object.fromEntries(
		catalog.data
			.filter(
				(model) =>
					isTranscriptionModel(model) &&
					model.supported_specifications?.includes("v4"),
			)
			.map((model) => [
				model.id,
				{
					id: model.id,
					name: model.name ?? model.id,
					operation: "transcription",
					// Prefer the advertised WebSocket path when supported. A tag is
					// capability metadata, not a claim that batch is also supported.
					operationModes: model.tags?.includes("websocket-transcription")
						? ["streaming"]
						: ["batch"],
					modalities: { input: ["audio"], output: ["text"] },
				} satisfies ModelInfo,
			]),
	);
}
