export function createEphemeralCacheControl() {
	return {
		cache_control: { type: "ephemeral" as const },
	};
}
