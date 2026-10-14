import { join } from "node:path";
import {
	type EmbeddedResources,
	materializeEmbeddedResources,
} from "@cline/core";
import { resolveClineDir } from "@cline/shared/storage";

declare const __CLINE_DASHBOARD_RUNTIME_RESOURCES__:
	| EmbeddedResources
	| undefined;

export function resolveEmbeddedDashboard(): string | undefined {
	if (typeof __CLINE_DASHBOARD_RUNTIME_RESOURCES__ === "undefined")
		return undefined;
	return materializeEmbeddedResources(
		__CLINE_DASHBOARD_RUNTIME_RESOURCES__,
		join(resolveClineDir(), "runtime", "dashboard"),
	);
}
