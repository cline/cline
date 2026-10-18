import { ApiError, handleApiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { fetchOpenRouterModels, filterModels } from "@/lib/openrouter/models";
import { hasPersonalOpenRouterKey } from "@/lib/profile";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const user = await requireUser();
		await enforceRateLimit(user.id, "modelsList");

		const url = new URL(request.url);
		const search = url.searchParams.get("search") ?? undefined;
		const provider = url.searchParams.get("provider") ?? undefined;
		const toolsOnly = url.searchParams.get("tools") === "1";
		const minContext = Number(url.searchParams.get("minContext") ?? 0) || undefined;

		const personalKey = await hasPersonalOpenRouterKey(user.id);
		const configured = Boolean(process.env.OPENROUTER_API_KEY) || personalKey;

		try {
			const { models, fetchedAt } = await fetchOpenRouterModels();
			const filtered = filterModels(models, { search, provider, toolsOnly, minContext });
			const providers = [...new Set(models.map((model) => model.provider))].sort();
			return jsonOk({
				models: filtered,
				configured,
				source: "openrouter" as const,
				fetchedAt,
				total: models.length,
				providers,
			});
		} catch (error) {
			const message =
				error instanceof ApiError
					? error.message
					: "OpenRouter model discovery is temporarily unavailable.";
			// The UI renders this as a recoverable banner rather than a dead page.
			return jsonOk({
				models: [],
				configured,
				source: "openrouter" as const,
				fetchedAt: new Date().toISOString(),
				total: 0,
				providers: [],
				error: message,
			});
		}
	} catch (error) {
		return handleApiError(error);
	}
}
