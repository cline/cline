import type {
	AgendaTaskRecord,
	FactoryAgent,
	FactoryReview,
} from "@cline/shared";
import { factoryReviewSchema } from "@cline/shared";

import { loadConfiguredAgentConfigs } from "../extensions/tools/team/configured-agent-config";

export function freezeFactoryAgent(
	task: AgendaTaskRecord,
	agent: FactoryAgent,
): FactoryAgent {
	if (!agent.profile || agent.resolvedProfile) return agent;
	const loaded = loadConfiguredAgentConfigs({
		workspaceRoot: task.workspaceRoot ?? task.cwd,
	});
	const profile = loaded.configs.find(
		(candidate) =>
			candidate.name.toLowerCase() === agent.profile?.trim().toLowerCase(),
	);
	if (!profile)
		throw new Error(
			`Configured Factory agent profile not found: ${agent.profile}`,
		);
	return { ...agent, resolvedProfile: profile };
}

export function resolveFactoryAgent(
	task: AgendaTaskRecord,
	agent: FactoryAgent,
): AgendaTaskRecord {
	agent = freezeFactoryAgent(task, agent);
	const profile = agent.resolvedProfile;
	const limit = (
		taskLimit: number | undefined,
		agentLimit: number | undefined,
	) =>
		taskLimit === undefined
			? agentLimit
			: agentLimit === undefined
				? taskLimit
				: Math.min(taskLimit, agentLimit);
	return {
		...task,
		modelSelection:
			agent.modelSelection ??
			(profile?.providerId || profile?.modelId
				? {
						providerId:
							profile.providerId ?? task.modelSelection?.providerId ?? "cline",
						modelId: profile.modelId ?? task.modelSelection?.modelId ?? "",
					}
				: task.modelSelection),
		maxIterations: limit(
			task.maxIterations,
			agent.maxIterations ?? profile?.maxIterations,
		),
		timeoutSeconds: limit(task.timeoutSeconds, agent.timeoutSeconds),
		systemPrompt:
			[task.systemPrompt, profile?.systemPrompt, agent.instructions]
				.filter(Boolean)
				.join("\n\n") || undefined,
	};
}

export function parseFactoryReview(summary: string): FactoryReview {
	return factoryReviewSchema.parse(
		JSON.parse(
			summary.replace(/^\s*```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, ""),
		),
	);
}
