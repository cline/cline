export interface LmStudioModel {
	id: string;
	type?: string;
	maxContextWindow?: number;
	loadedContextWindow?: number;
}

interface LmStudioModelResponse {
	key?: string;
	type?: string;
	max_context_length?: number;
	loaded_instances?: Array<{
		id?: string;
		config?: { context_length?: number };
	}>;
}

export type LmStudioModelsFetch = (url: string) => Promise<Response>;

function readPositiveInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return undefined;
}

export function toLmStudioRestModelsUrl(baseUrl: string): string | undefined {
	try {
		const url = new URL(baseUrl);
		const basePath = url.pathname
			.replace(/\/+$/, "")
			.replace(/\/models$/, "")
			.replace(/\/v1$/, "");
		url.pathname = `${basePath}/api/v1/models`;
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return undefined;
	}
}

export async function fetchLmStudioModels(
	baseUrl: string,
	fetchModels: LmStudioModelsFetch = (url) => fetch(url, { method: "GET" }),
): Promise<LmStudioModel[]> {
	const endpoint = toLmStudioRestModelsUrl(baseUrl);
	if (!endpoint) {
		return [];
	}
	const response = await fetchModels(endpoint);
	if (!response.ok) {
		throw new Error(`LM Studio model refresh failed: HTTP ${response.status}`);
	}
	const payload = (await response.json()) as {
		models?: LmStudioModelResponse[];
	};
	return (payload.models ?? []).flatMap((model) => {
		const id = model.key?.trim();
		if (!id) {
			return [];
		}
		const loadedInstance =
			model.loaded_instances?.find((instance) => instance.id === id) ??
			model.loaded_instances?.[0];
		return [
			{
				id,
				type: model.type,
				maxContextWindow: readPositiveInteger(model.max_context_length),
				loadedContextWindow: readPositiveInteger(
					loadedInstance?.config?.context_length,
				),
			},
		];
	});
}
