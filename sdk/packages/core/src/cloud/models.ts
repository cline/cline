export type CloudModel = {
	id: string;
	name: string;
	catalogId: "cline" | "cline-pass" | "cline-cloud";
};

function readCloudModel(
	value: unknown,
	catalogId: CloudModel["catalogId"],
): CloudModel | undefined {
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

function readCloudModels(
	value: unknown,
	catalogId: CloudModel["catalogId"],
): CloudModel[] {
	return Array.isArray(value)
		? value.flatMap((entry) => {
				const model = readCloudModel(entry, catalogId);
				return model ? [model] : [];
			})
		: [];
}

export async function loadCloudModels(
	apiBaseUrl: string,
	options: { isOrganizationSession?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<CloudModel[]> {
	const trimmedBaseUrl = apiBaseUrl.trim();
	let end = trimmedBaseUrl.length;
	while (end > 0 && trimmedBaseUrl[end - 1] === "/") end--;
	const baseUrl = trimmedBaseUrl.slice(0, end);
	const load = async (path: string): Promise<unknown> => {
		const response = await (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await response.json();
	};
	let catalogPayload: unknown;
	let recommendedPayload: unknown;
	try {
		[catalogPayload, recommendedPayload] = await Promise.all([
			load("/api/v1/ai/cline/models"),
			load("/api/v1/ai/cline/recommended-models"),
		]);
	} catch (error) {
		throw new Error("Could not load the cloud model catalog.", {
			cause: error,
		});
	}
	const catalogRecord =
		catalogPayload && typeof catalogPayload === "object"
			? (catalogPayload as Record<string, unknown>)
			: undefined;
	const catalog = readCloudModels(
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
	const pass = readCloudModels(recommended?.clinePass, "cline-pass");
	const cloud = readCloudModels(recommended?.clineCloud, "cline-cloud");
	const seen = new Set<string>();
	return [
		...(options.isOrganizationSession ? [] : pass),
		...cloud,
		...catalog,
	].filter((model) => {
		if (seen.has(model.id)) return false;
		seen.add(model.id);
		return true;
	});
}
