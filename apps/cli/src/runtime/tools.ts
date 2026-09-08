import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveDisabledToolNames,
	resolveEnabledOptInToolNames,
	type ToolCatalogEntry,
} from "@cline/core";

export type { ToolCatalogEntry } from "@cline/core";

export function getToolCatalog(
	availabilityContext?: BuiltinToolAvailabilityContext,
): ToolCatalogEntry[] {
	return getCoreBuiltinToolCatalog({
		clientType: "cli",
		disabledToolIds: resolveDisabledToolNames(),
		enabledOptInToolIds: resolveEnabledOptInToolNames(),
		...availabilityContext,
	});
}
