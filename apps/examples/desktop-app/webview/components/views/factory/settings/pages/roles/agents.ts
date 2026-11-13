import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryWorkflowConfig,
} from "@cline/shared/browser";
import type { FactoryGuidanceRole } from "@/lib/factory-settings-client";
import type { FsRoleKey } from "@/lib/factory-settings-copy/roles";

export type Agents = NonNullable<FactoryWorkflowConfig["agents"]>;
export type ListRole = "planReviewers" | "implementers" | "reviewers";

export const ROLE_KEYS: readonly FsRoleKey[] = [
	"designer",
	"planReviewers",
	"implementers",
	"verifier",
	"reviewers",
];

/** How many agents each role may have (the workflow schema's bounds). */
export const ROLE_BOUNDS: Record<FsRoleKey, { min: number; max: number }> = {
	designer: { min: 1, max: 1 },
	planReviewers: { min: 0, max: 4 },
	implementers: { min: 1, max: 4 },
	verifier: { min: 0, max: 1 },
	reviewers: { min: 1, max: 4 },
};

/** The guidance target each role reads. */
export const ROLE_GUIDANCE: Record<FsRoleKey, FactoryGuidanceRole> = {
	designer: "designer",
	planReviewers: "plan_reviewer",
	implementers: "builder",
	verifier: "verifier",
	reviewers: "reviewer",
};

export const isListRole = (role: FsRoleKey): role is ListRole =>
	role === "planReviewers" || role === "implementers" || role === "reviewers";

/** A deep link's role: a role key or its guidance name. */
export function roleFromFocus(role: string | undefined): FsRoleKey | undefined {
	if (!role) return undefined;
	if ((ROLE_KEYS as readonly string[]).includes(role)) return role as FsRoleKey;
	return ROLE_KEYS.find((key) => ROLE_GUIDANCE[key] === role);
}

export const workflowAgents = (config: FactoryWorkflowConfig): Agents =>
	config.agents ?? DEFAULT_FACTORY_AGENTS;

/** A role's agents, in order (the tester's is empty when it is off). */
export function roleAgents(agents: Agents, role: FsRoleKey): FactoryAgent[] {
	if (role === "designer") return [agents.designer];
	if (role === "verifier") return agents.verifier ? [agents.verifier] : [];
	return agents[role];
}

/** The agents with one agent of a role replaced (its other fields kept). */
export function withAgent(
	agents: Agents,
	role: FsRoleKey,
	index: number,
	agent: FactoryAgent,
): Agents {
	if (role === "designer")
		return { ...agents, designer: { ...agents.designer, ...agent } };
	if (role === "verifier")
		return { ...agents, verifier: { ...agents.verifier, ...agent } };
	return {
		...agents,
		[role]: agents[role].map((item, i) => (i === index ? agent : item)),
	};
}

/** The workflow with one more agent in a list role. */
export function addAgent(
	config: FactoryWorkflowConfig,
	role: ListRole,
): FactoryWorkflowConfig {
	const agents = workflowAgents(config);
	return { ...config, agents: { ...agents, [role]: [...agents[role], {}] } };
}

/**
 * The workflow without one agent of a list role. Removing a code reviewer
 * also lowers "Fewest code reviewers" when it would ask for more reviewers
 * than remain.
 */
export function removeAgent(
	config: FactoryWorkflowConfig,
	role: ListRole,
	index: number,
): FactoryWorkflowConfig {
	const agents = workflowAgents(config);
	const list = agents[role].filter((_, i) => i !== index);
	const next: FactoryWorkflowConfig = {
		...config,
		agents: { ...agents, [role]: list },
	};
	if (
		role === "reviewers" &&
		config.minCodeReviewers !== undefined &&
		config.minCodeReviewers > list.length
	)
		next.minCodeReviewers = list.length;
	return next;
}

/** The workflow with the tester on (a default-model tester) or off. */
export function withTester(
	config: FactoryWorkflowConfig,
	on: boolean,
): FactoryWorkflowConfig {
	const { verifier: _previous, ...rest } = workflowAgents(config);
	return { ...config, agents: on ? { ...rest, verifier: {} } : rest };
}
