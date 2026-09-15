import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveDisabledToolNames,
	resolveEnabledConfigurableModelToolNames,
	type ToolCatalogEntry,
} from "@cline/core";

export type { ToolCatalogEntry } from "@cline/core";

export function getToolCatalog(
	availabilityContext?: BuiltinToolAvailabilityContext,
): ToolCatalogEntry[] {
	return getCoreBuiltinToolCatalog({
		clientType: "cli",
		disabledToolIds: resolveDisabledToolNames(),
		enabledOptInToolIds: resolveEnabledConfigurableModelToolNames(),
		...availabilityContext,
	});
}
