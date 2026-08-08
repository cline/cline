import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveDisabledToolNames,
	resolveEnabledToolNames,
	type ToolCatalogEntry,
} from "@cline/core";

export type { ToolCatalogEntry } from "@cline/core";

export function getToolCatalog(
	availabilityContext?: BuiltinToolAvailabilityContext,
): ToolCatalogEntry[] {
	return getCoreBuiltinToolCatalog({
		disabledToolIds: resolveDisabledToolNames(),
		enabledToolIds: resolveEnabledToolNames(),
		...availabilityContext,
	});
}
