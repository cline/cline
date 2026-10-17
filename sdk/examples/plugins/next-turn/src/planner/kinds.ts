import type { Manifest } from "../context/manifest";

/**
 * Which kinds this environment may offer. Core kinds always; a gated kind needs its capability in the
 * manifest, and the rules add evidence on top (a pushed branch, a failing
 * check). Outward kinds speak for the person outside the machine, so the tray
 * offers them as Use only.
 */

/** Kinds the rules and the model may offer anywhere. */
export const CORE_KINDS = [
	"fix_failure",
	"continue",
	"next_step",
	"verify",
	"review_diff",
	"wrap_up",
	"commit",
] as const;
type CoreKind = (typeof CORE_KINDS)[number];

type Gate = { anyOf: readonly string[]; outward: boolean; describe: string };

/** Kinds gated on a capability and evidence. */
export const KIND_GATES = {
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
} satisfies Readonly<Record<string, Gate>>;

type GatedKind = keyof typeof KIND_GATES;
export const GATED_KINDS = Object.keys(KIND_GATES) as GatedKind[];

export type SuggestionKind = CoreKind | GatedKind;

/**
 * Tags that are not connections. A `remote:` tag is where the code lives:
 * `remote:github` with no GitHub route is evidence, never the capability. The
 * person's workflows, skills, plugin commands, scripts and make targets are
 * names they chose: a skill called `slack` connects nothing.
 */
const NOT_CONNECTIONS = [
	"remote:",
	"workflow:",
	"skill:",
	"plugin-command:",
	"script:",
	"make:",
] as const;

/**
 * True when a capability tag names the service: `github`, `github:gh`,
 * `composio:linear`, or an MCP server whose name carries it (`mcp:linear-app`).
 */
export function hasCapability(
	capabilities: readonly string[],
	service: string,
): boolean {
	return capabilities.some((tag) => {
		const lower = tag.toLowerCase();
		if (NOT_CONNECTIONS.some((prefix) => lower.startsWith(prefix)))
			return false;
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

export function offersKind(
	manifest: Pick<Manifest, "capabilities">,
	kind: GatedKind,
): boolean {
	return KIND_GATES[kind].anyOf.some((service) =>
		hasCapability(manifest.capabilities, service),
	);
}

/** Core kinds, plus each gated kind whose capability is in the manifest. */
export function offerableKinds(
	manifest: Pick<Manifest, "capabilities">,
): SuggestionKind[] {
	return [
		...CORE_KINDS,
		...GATED_KINDS.filter((kind) => offersKind(manifest, kind)),
	];
}
