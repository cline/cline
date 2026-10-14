import type { HubLink } from "../../hub/link";
import type { ContextSource, SourceState } from "../source";

type Described = Pick<ContextSource, "displayName" | "settingsToggle">;

/**
 * A source whose facts come from the hub fold, as the tasks do. Its presence
 * is the link's: absent when no hub runs here, unknown while a hub exists but
 * is unreachable.
 */
export function hubBackedSource(
	id: string,
	link: Pick<HubLink, "availability">,
	described: Described = {},
): ContextSource {
	return { id, tier: "T2", ...described, probe: () => link.availability() };
}

/**
 * A source that exists only where something supplies it: Status reports once a
 * Status store is wired, a host's plan and bank only where that host supplies them.
 * Elsewhere it is absent, so the planner never hears of it.
 */
export function suppliedSource(
	id: string,
	supplied: boolean,
	described: Described = {},
	availability: () => SourceState = () => "present",
): ContextSource {
	return {
		id,
		tier: "T2",
		...described,
		probe: () => (supplied ? availability() : "absent"),
	};
}
