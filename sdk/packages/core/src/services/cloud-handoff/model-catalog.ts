import type { CloudHandoffModel } from "./model-selection";

function readCloudHandoffModel(
	value: unknown,
	catalogId: CloudHandoffModel["catalogId"],
): CloudHandoffModel | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id) return undefined;
	const displayName =
		typeof record.display_name === "string"
			? record.display_name.trim()
			: typeof record.displayName === "string"
				? record.displayName.trim()
				: "";
	const name = typeof record.name === "string" ? record.name.trim() : "";
	return { id, name: displayName || name || id, catalogId };
}

function readCloudHandoffModels(
	value: unknown,
	catalogId: CloudHandoffModel["catalogId"],
): CloudHandoffModel[] {
	return Array.isArray(value)
		? value.flatMap((entry) => {
				const model = readCloudHandoffModel(entry, catalogId);
				return model ? [model] : [];
			})
		: [];
}

export function combineCloudHandoffModels(input: {
	catalog: CloudHandoffModel[];
	clinePass: CloudHandoffModel[];
	clineCloud: CloudHandoffModel[];
}): CloudHandoffModel[] {
	// Recommended entries stay first for personal selection, but retain catalog
	// duplicates so organization filtering cannot remove the model entirely.
	return [...input.clinePass, ...input.clineCloud, ...input.catalog];
}

export async function loadCloudHandoffModels(
	apiBaseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<CloudHandoffModel[]> {
	const baseUrl = apiBaseUrl.trim().replace(/\/+$/, "");
	const load = async (path: string): Promise<unknown> => {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	};
	let catalogPayload: unknown;
	try {
		catalogPayload = await load("/api/v1/ai/cline/models");
	} catch (error) {
		throw new Error("Could not load the cloud model catalog.", {
			cause: error,
		});
	}
	const recommendedPayload = await load(
		"/api/v1/ai/cline/recommended-models",
	).catch(() => undefined);
	const catalogRecord =
		catalogPayload && typeof catalogPayload === "object"
			? (catalogPayload as Record<string, unknown>)
			: undefined;
	const catalog = readCloudHandoffModels(
		Array.isArray(catalogPayload) ? catalogPayload : catalogRecord?.data,
		"cline",
	);
	const recommendedEnvelope =
		recommendedPayload && typeof recommendedPayload === "object"
			? (recommendedPayload as Record<string, unknown>)
			: undefined;
	const recommended =
		recommendedEnvelope?.data && typeof recommendedEnvelope.data === "object"
			? (recommendedEnvelope.data as Record<string, unknown>)
			: recommendedEnvelope;
	const pass = readCloudHandoffModels(recommended?.clinePass, "cline-pass");
	const cloud = readCloudHandoffModels(recommended?.clineCloud, "cline-cloud");
	return combineCloudHandoffModels({
		catalog,
		clinePass: pass,
		clineCloud: cloud,
	});
}
