import type { ProviderConfigFieldPrimitive } from "@/lib/provider-schema";

function assignSettingsPath(
	target: Record<string, unknown>,
	path: string,
	value: ProviderConfigFieldPrimitive,
) {
	const segments = path.split(".").filter(Boolean);
	if (segments.length === 0) return;
	let cursor = target;
	for (const segment of segments.slice(0, -1)) {
		const existing = cursor[segment];
		if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
			cursor[segment] = {};
		}
		cursor = cursor[segment] as Record<string, unknown>;
	}
	const last = segments.at(-1);
	if (last) {
		cursor[last] = value;
	}
}

export function toSettingsPatch(
	values: Record<string, ProviderConfigFieldPrimitive>,
): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	for (const [path, value] of Object.entries(values)) {
		assignSettingsPath(settings, path, value);
	}
	return settings;
}
