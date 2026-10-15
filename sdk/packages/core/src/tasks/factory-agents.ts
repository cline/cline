import type {
	AgendaTaskRecord,
	FactoryAgent,
	FactoryReview,
} from "@cline/shared";
import { factoryReviewSchema } from "@cline/shared";

export function resolveFactoryAgent(
	task: AgendaTaskRecord,
	agent: FactoryAgent,
): AgendaTaskRecord {
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
		modelSelection: agent.modelSelection ?? task.modelSelection,
		maxIterations: limit(task.maxIterations, agent.maxIterations),
		timeoutSeconds: limit(task.timeoutSeconds, agent.timeoutSeconds),
		systemPrompt:
			[task.systemPrompt, agent.instructions].filter(Boolean).join("\n\n") ||
			undefined,
	};
}

export function parseFactoryReview(summary: string): FactoryReview {
	return factoryReviewSchema.parse(
		JSON.parse(
			summary.replace(/^\s*```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, ""),
		),
	);
}

export function factoryReviewFindings(review: FactoryReview): string[] {
	return review.verdict === "pass" && review.findings.length === 0
		? []
		: review.findings.length
			? review.findings
			: [review.summary];
}
