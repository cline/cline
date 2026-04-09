import type { ToolPolicy } from "@clinebot/core";

function clonePolicy(policy: ToolPolicy | undefined): ToolPolicy {
	return policy ? { ...policy } : {};
}

export function cloneToolPolicies(
	policies: Record<string, ToolPolicy>,
): Record<string, ToolPolicy> {
	return Object.fromEntries(
		Object.entries(policies).map(([name, policy]) => [
			name,
			clonePolicy(policy),
		]),
	);
}

export function applyInteractiveAutoApproveOverride(input: {
	targetPolicies: Record<string, ToolPolicy>;
	baselinePolicies: Record<string, ToolPolicy>;
	enabled: boolean;
}): void {
	const nextPolicies = input.enabled
		? cloneToolPolicies(input.baselinePolicies)
		: Object.fromEntries(
				Object.entries(input.baselinePolicies).map(([name, policy]) => [
					name,
					{ ...policy, autoApprove: false },
				]),
			);

	const globalPolicy = clonePolicy(nextPolicies["*"]);
	globalPolicy.autoApprove = input.enabled
		? (input.baselinePolicies["*"]?.autoApprove ?? true)
		: false;
	nextPolicies["*"] = globalPolicy;

	for (const key of Object.keys(input.targetPolicies)) {
		delete input.targetPolicies[key];
	}
	for (const [name, policy] of Object.entries(nextPolicies)) {
		input.targetPolicies[name] = policy;
	}
}
