import type { ToolPolicy } from "@cline/core";

const SAFE_AUTO_APPROVE_TOOL_NAMES = [
	"ask_followup_question",
	"ask_question",
	"fetch_web_content",
	"read_files",
	"search_codebase",
	"skills",
	"submit_and_exit",
];

const SAFE_AUTO_APPROVE_TOOLS = new Set<string>(SAFE_AUTO_APPROVE_TOOL_NAMES);

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

export function resolveInteractiveAutoApprovePolicy(input: {
	toolName: string;
	baselinePolicies: Record<string, ToolPolicy>;
	enabled: boolean;
}): ToolPolicy {
	const toolPolicy = input.baselinePolicies[input.toolName] ?? {};
	const baselinePolicy = {
		...(input.baselinePolicies["*"] ?? {}),
		...toolPolicy,
	};
	return {
		...baselinePolicy,
		autoApprove: input.enabled
			? true
			: SAFE_AUTO_APPROVE_TOOLS.has(input.toolName)
				? (toolPolicy.autoApprove ?? true)
				: false,
	};
}

export function applyInteractiveAutoApproveOverride(input: {
	targetPolicies: Record<string, ToolPolicy>;
	baselinePolicies: Record<string, ToolPolicy>;
	enabled: boolean;
}): void {
	const nextPolicies: Record<string, ToolPolicy> = input.enabled
		? Object.fromEntries(
				Object.entries(input.baselinePolicies).map(([name, policy]) => [
					name,
					{
						...policy,
						autoApprove: true,
					},
				]),
			)
		: Object.fromEntries(
				Object.entries(input.baselinePolicies).map(([name, policy]) => [
					name,
					{
						...policy,
						autoApprove: resolveInteractiveAutoApprovePolicy({
							toolName: name,
							baselinePolicies: input.baselinePolicies,
							enabled: false,
						}).autoApprove,
					},
				]),
			);

	if (!input.enabled) {
		for (const name of SAFE_AUTO_APPROVE_TOOL_NAMES) {
			nextPolicies[name] ??= { autoApprove: true };
		}
	}

	const globalPolicy = clonePolicy(nextPolicies["*"]);
	globalPolicy.autoApprove = input.enabled;
	nextPolicies["*"] = globalPolicy;

	for (const key of Object.keys(input.targetPolicies)) {
		delete input.targetPolicies[key];
	}
	for (const [name, policy] of Object.entries(nextPolicies)) {
		input.targetPolicies[name] = policy;
	}
}
