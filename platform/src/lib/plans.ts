import type { Plan } from "@/lib/types";

export type PlanLimits = {
	projects: number;
	tasksPerMonth: number;
	tokensPerMonth: number;
	concurrentTasks: number;
	sandboxMinutesPerMonth: number;
	maxTaskIterations: number;
	maxTerminalTimeoutSeconds: number;
	byok: boolean;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
	free: {
		projects: 5,
		tasksPerMonth: 100,
		tokensPerMonth: 2_000_000,
		concurrentTasks: 1,
		sandboxMinutesPerMonth: 180,
		maxTaskIterations: 30,
		maxTerminalTimeoutSeconds: 120,
		byok: true,
	},
	pro: {
		projects: 50,
		tasksPerMonth: 2_000,
		tokensPerMonth: 50_000_000,
		concurrentTasks: 4,
		sandboxMinutesPerMonth: 3_000,
		maxTaskIterations: 40,
		maxTerminalTimeoutSeconds: 300,
		byok: true,
	},
};

export function limitsForPlan(plan: string | null | undefined): PlanLimits {
	return PLAN_LIMITS[plan === "pro" ? "pro" : "free"];
}

export function clampToPlanLimit(
	requested: number | null | undefined,
	planMax: number,
	fallback: number,
): number {
	if (requested === null || requested === undefined || !Number.isFinite(requested)) {
		return Math.min(fallback, planMax);
	}
	return Math.max(1, Math.min(Math.floor(requested), planMax));
}

export function formatLimit(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
	return String(value);
}
