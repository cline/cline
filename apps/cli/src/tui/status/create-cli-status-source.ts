import { createFallbackStatusSnapshotSource } from "./fallback-status-snapshot-source";
import { createHubStatusSnapshotSource } from "./hub-status-snapshot-source";
import type {
	StatusSnapshotSource,
	StatusViewBootstrap,
} from "./status-snapshot-source";

export function createCliStatusSource(options?: {
	fallback?: StatusSnapshotSource;
	banner?: string;
}): {
	source: StatusSnapshotSource;
	bootstrap: StatusViewBootstrap;
} {
	const hub = createHubStatusSnapshotSource();
	if (!options?.fallback) {
		return {
			source: hub,
			bootstrap: {},
		};
	}

	return {
		source: createFallbackStatusSnapshotSource(hub, options.fallback),
		bootstrap: {
			...(options.banner !== undefined ? { banner: options.banner } : {}),
		},
	};
}
