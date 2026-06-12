import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveConfiguredAgentAllowedToolNames,
} from "@cline/core";
import type { ActiveAgentProfile } from "../utils/types";

/**
 * Computes the session-scoped tool disable list for an agent profile's tools
 * allowlist: every builtin tool catalog entry whose id is not in the profile's
 * resolved allowlist (legacy aliases resolved, `skills` implied by a skills
 * field). Returns undefined when the profile has no tools field (no
 * restriction). Only catalog tools are ever disabled; harness tools outside
 * the catalog (like submit_and_exit), plugin tools, MCP tools, and
 * `subagent_*` tools are unaffected. Recomputed on every session (re)start
 * with the active provider/model/mode so routed tool names (editor vs
 * apply_patch) match the runtime's toolset.
 */
export function resolveAgentProfileDisabledToolNames(
	profile: Pick<ActiveAgentProfile, "tools" | "skills"> | undefined,
	availabilityContext?: BuiltinToolAvailabilityContext,
): string[] | undefined {
	if (!profile) {
		return undefined;
	}
	const allowed = resolveConfiguredAgentAllowedToolNames(profile);
	if (allowed === undefined) {
		return undefined;
	}
	const disabled = new Set<string>();
	for (const entry of getCoreBuiltinToolCatalog(availabilityContext)) {
		if (allowed.has(entry.id)) {
			continue;
		}
		disabled.add(entry.id);
		for (const name of entry.headlessToolNames) {
			disabled.add(name);
		}
	}
	return [...disabled];
}
