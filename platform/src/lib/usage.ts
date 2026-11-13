import { ApiError } from "@/lib/api";
import { limitsForPlan } from "@/lib/plans";
import { getServiceClient } from "@/lib/supabase/service";
import type { Plan, UsageRecordRow } from "@/lib/types";

export function startOfMonth(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export type UsageTotals = {
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costUsd: number;
};

export type DailyUsage = {
	date: string;
	tokens: number;
	costUsd: number;
};

export type ModelUsage = {
	modelId: string;
	tokens: number;
	costUsd: number;
	runs: number;
};

export type UsageReport = {
	monthStart: string;
	totals: UsageTotals;
	daily: DailyUsage[];
	byModel: ModelUsage[];
	recent: UsageRecordRow[];
	taskCount: number;
};

export function emptyTotals(): UsageTotals {
	return {
		promptTokens: 0,
		completionTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costUsd: 0,
	};
}

export function aggregateUsage(records: UsageRecordRow[]): UsageReport {
	const totals = emptyTotals();
	const daily = new Map<string, DailyUsage>();
	const byModel = new Map<string, ModelUsage>();
	const taskIds = new Set<string>();

	for (const record of records) {
		const cost = Number(record.cost_usd) || 0;
		totals.promptTokens += record.prompt_tokens;
		totals.completionTokens += record.completion_tokens;
		totals.cacheReadTokens += record.cache_read_tokens;
		totals.cacheWriteTokens += record.cache_write_tokens;
		totals.totalTokens += record.total_tokens;
		totals.costUsd += cost;
		if (record.task_id) taskIds.add(record.task_id);

		const day = record.created_at.slice(0, 10);
		const dailyEntry = daily.get(day) ?? { date: day, tokens: 0, costUsd: 0 };
		dailyEntry.tokens += record.total_tokens;
		dailyEntry.costUsd += cost;
		daily.set(day, dailyEntry);

		const modelEntry = byModel.get(record.model_id) ?? {
			modelId: record.model_id,
			tokens: 0,
			costUsd: 0,
			runs: 0,
		};
		modelEntry.tokens += record.total_tokens;
		modelEntry.costUsd += cost;
		modelEntry.runs += 1;
		byModel.set(record.model_id, modelEntry);
	}

	return {
		monthStart: startOfMonth().toISOString(),
		totals,
		daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
		byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
		recent: records.slice(0, 40),
		taskCount: taskIds.size,
	};
}

export async function getMonthlyUsage(ownerId: string): Promise<UsageReport> {
	const { data, error } = await getServiceClient()
		.from("a21_usage_records")
		.select("*")
		.eq("owner_id", ownerId)
		.gte("created_at", startOfMonth().toISOString())
		.order("created_at", { ascending: false })
		.limit(1000);

	if (error) {
		throw new ApiError(500, "usage_lookup_failed", "Could not load usage records.");
	}
	return aggregateUsage((data ?? []) as UsageRecordRow[]);
}

export async function assertTaskQuota(
	ownerId: string,
	plan: Plan,
): Promise<{ usedTasks: number; usedTokens: number }> {
	const limits = limitsForPlan(plan);
	const client = getServiceClient();
	const [tasksResult, usageResult] = await Promise.all([
		client
			.from("a21_tasks")
			.select("id", { count: "exact", head: true })
			.eq("owner_id", ownerId)
			.gte("created_at", startOfMonth().toISOString()),
		client
			.from("a21_usage_records")
			.select("total_tokens")
			.eq("owner_id", ownerId)
			.gte("created_at", startOfMonth().toISOString())
			.limit(5000),
	]);

	if (tasksResult.error || usageResult.error) {
		throw new ApiError(500, "quota_check_failed", "Could not verify usage limits.");
	}

	const usedTasks = tasksResult.count ?? 0;
	const usedTokens = ((usageResult.data ?? []) as Array<{ total_tokens: number }>).reduce(
		(sum, row) => sum + (row.total_tokens ?? 0),
		0,
	);

	if (usedTasks >= limits.tasksPerMonth) {
		throw new ApiError(
			402,
			"task_quota_exceeded",
			`Your ${plan} plan includes ${limits.tasksPerMonth} tasks per month. Upgrade or wait for the next cycle.`,
		);
	}
	if (usedTokens >= limits.tokensPerMonth) {
		throw new ApiError(
			402,
			"token_quota_exceeded",
			`Your ${plan} plan includes ${limits.tokensPerMonth.toLocaleString()} tokens per month. Upgrade or wait for the next cycle.`,
		);
	}

	return { usedTasks, usedTokens };
}

export async function countActiveTasks(ownerId: string): Promise<number> {
	const { count, error } = await getServiceClient()
		.from("a21_tasks")
		.select("id", { count: "exact", head: true })
		.eq("owner_id", ownerId)
		.in("status", ["queued", "provisioning", "running", "waiting_approval"]);
	if (error) {
		throw new ApiError(500, "quota_check_failed", "Could not check running tasks.");
	}
	return count ?? 0;
}
