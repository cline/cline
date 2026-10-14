import type { HubLink } from "../../hub/link";
import type { ContextSource, SourceState, SourceTier } from "../source";

/**
 * A source whose facts come from the hub fold (tasks, status, schedules,
 * teams). Its presence is the link's: absent when no hub runs here, unknown
 * while a hub exists but is unreachable.
 */
export function hubBackedSource(
	id: string,
	link: Pick<HubLink, "availability">,
	tier: SourceTier = "T2",
): ContextSource {
	return { id, tier, probe: () => link.availability() };
}

/**
 * A source that exists only where something supplies it: Status reports once a
 * Status store is wired, a host's plan and bank only where that host supplies them.
 * Elsewhere it is absent, so the planner never hears of it.
 */
export function suppliedSource(
	id: string,
	supplied: boolean,
	availability: () => SourceState = () => "present",
	tier: SourceTier = "T2",
): ContextSource {
	return { id, tier, probe: () => (supplied ? availability() : "absent") };
}
