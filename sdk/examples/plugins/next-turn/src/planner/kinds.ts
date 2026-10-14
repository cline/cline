import type { Manifest } from "../context/manifest";
import {
	CORE_KINDS,
	GATED_KINDS,
	type GatedKind,
	type SuggestionKind,
} from "./candidates";

/**
 * Which kinds this environment may offer. Core kinds always; a gated kind needs its capability in the
 * manifest, and the rules add evidence on top (a pushed branch, a failing
 * check). Outward kinds speak for the person outside the machine, so the tray
 * offers them as Use only.
 */

export { CORE_KINDS };

type Gate = { anyOf: readonly string[]; outward: boolean; describe: string };

export const KIND_GATES: Readonly<Record<GatedKind, Gate>> = {
	check_ci: {
		anyOf: ["github"],
		outward: false,
		describe:
			"ask the agent to check CI on this branch's pull request and fix what fails",
	},
	reply_review: {
		anyOf: ["github"],
		outward: true,
		describe: "ask the agent to answer review comments on the pull request",
	},
	update_issue: {
		anyOf: ["linear", "jira"],
		outward: true,
		describe: "ask the agent to update the issue this work tracks",
	},
	post_update: {
		anyOf: ["slack"],
		outward: true,
		describe: "ask the agent to post a short update to the team",
	},
};

/**
 * True when a capability tag names the service: `github`, `github:gh`,
 * `composio:linear`, or an MCP server whose name carries it (`mcp:linear-app`).
 * A `remote:` tag is where the code lives, not a connection: `remote:github`
 * with no GitHub route is evidence, never the capability.
 */
export function hasCapability(
	capabilities: readonly string[],
	service: string,
): boolean {
	return capabilities.some((tag) => {
		const lower = tag.toLowerCase();
		if (lower.startsWith("remote:")) return false;
		return (
			lower === service ||
			lower.startsWith(`${service}:`) ||
			lower.endsWith(`:${service}`) ||
			(lower.startsWith("mcp:") && lower.includes(service))
		);
	});
}

export function isGated(kind: SuggestionKind): kind is GatedKind {
	return kind in KIND_GATES;
}

export function isOutward(kind: SuggestionKind): boolean {
	return isGated(kind) && KIND_GATES[kind].outward;
}

/** Core kinds, plus each gated kind whose capability is in the manifest. */
export function offerableKinds(
	manifest: Pick<Manifest, "capabilities">,
): SuggestionKind[] {
	const gated = GATED_KINDS.filter((kind) =>
		KIND_GATES[kind].anyOf.some((service) =>
			hasCapability(manifest.capabilities, service),
		),
	);
	return [...CORE_KINDS, ...gated];
}
