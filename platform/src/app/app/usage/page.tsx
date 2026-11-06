import { Activity, CalendarDays, CircleDollarSign, Cpu, Info } from "lucide-react";
import type { Metadata } from "next";
import { InlineAlert, Panel, SectionHeading, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import { countActiveTasks, getMonthlyUsage, startOfMonth } from "@/lib/usage";
import { formatCompact, formatDateTime, formatNumber, formatUsd } from "@/lib/utils";

export const metadata: Metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

function buildDailySeries(
	days: Array<{ date: string; tokens: number; costUsd: number }>,
	daysBack = 30,
) {
	const map = new Map(days.map((day) => [day.date, day]));
	const series: Array<{ date: string; tokens: number; costUsd: number }> = [];
	const today = new Date();
	for (let index = daysBack - 1; index >= 0; index -= 1) {
		const date = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - index),
		);
		const key = date.toISOString().slice(0, 10);
		series.push(map.get(key) ?? { date: key, tokens: 0, costUsd: 0 });
	}
	return series;
}

export default async function UsagePage() {
	const user = await requireUser();
	const profile = await getOrCreateProfile(user);
	const limits = limitsForPlan(profile.plan);
	const client = getServiceClient();

	const [usage, tasksResult, active] = await Promise.all([
		getMonthlyUsage(user.id),
		client
			.from("a21_tasks")
			.select("id", { count: "exact", head: true })
			.eq("owner_id", user.id)
			.gte("created_at", startOfMonth().toISOString()),
		countActiveTasks(user.id),
	]);

	const series = buildDailySeries(usage.daily);
	const maxTokens = Math.max(1, ...series.map((day) => day.tokens));
	const tokenPercent = Math.min(
		100,
		Math.round((usage.totals.totalTokens / Math.max(1, limits.tokensPerMonth)) * 100),
	);
	const taskPercent = Math.min(
		100,
		Math.round(((tasksResult.count ?? 0) / Math.max(1, limits.tasksPerMonth)) * 100),
	);

	return (
		<div className="space-y-6">
			<header>
				<p className="eyebrow">Usage</p>
				<h1 className="display mt-2 text-3xl font-semibold">Metering & limits</h1>
				<p className="mt-2 max-w-2xl text-sm text-mist-500">
					Token counts and costs are recorded from each agent run. If you use a personal OpenRouter
					key, OpenRouter bills you directly; costs here are still recorded for visibility.
				</p>
			</header>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat
					label="Tokens this month"
					value={formatCompact(usage.totals.totalTokens)}
					detail={
						<div className="space-y-1.5">
							<div className="h-1 overflow-hidden rounded-full bg-white/10">
								<div
									className="h-full rounded-full bg-signal-400"
									style={{ width: `${tokenPercent}%` }}
								/>
							</div>
							<span>
								{tokenPercent}% of {formatCompact(limits.tokensPerMonth)} included
							</span>
						</div>
					}
					icon={Cpu}
					accent="signal"
				/>
				<Stat
					label="Recorded cost"
					value={formatUsd(usage.totals.costUsd)}
					detail="Estimated from OpenRouter pricing at run time"
					icon={CircleDollarSign}
					accent="mint"
				/>
				<Stat
					label="Tasks this month"
					value={formatNumber(tasksResult.count ?? 0)}
					detail={
						<div className="space-y-1.5">
							<div className="h-1 overflow-hidden rounded-full bg-white/10">
								<div
									className="h-full rounded-full bg-iris-400"
									style={{ width: `${taskPercent}%` }}
								/>
							</div>
							<span>
								{taskPercent}% of {formatNumber(limits.tasksPerMonth)} included
							</span>
						</div>
					}
					icon={CalendarDays}
					accent="iris"
				/>
				<Stat
					label="Running now"
					value={formatNumber(active)}
					detail={`${limits.concurrentTasks} concurrent on ${profile.plan}`}
					icon={Activity}
				/>
			</div>

			<Panel className="p-5">
				<SectionHeading
					title="Daily tokens"
					description="Last 30 days, UTC. Hover a bar for the exact count."
				/>
				<div className="mt-6 flex h-40 items-end gap-1">
					{series.map((day) => (
						<div key={day.date} className="group relative flex h-full flex-1 items-end">
							<div
								className="w-full rounded-t-sm bg-gradient-to-t from-signal-600/40 to-signal-400 transition group-hover:from-signal-500/60"
								style={{
									height: `${Math.max(2, (day.tokens / maxTokens) * 100)}%`,
									opacity: day.tokens === 0 ? 0.18 : 1,
								}}
							/>
							<div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-[0.6rem] text-mist-200 shadow-lift group-hover:block">
								{day.date} · {formatNumber(day.tokens)} tokens · {formatUsd(day.costUsd)}
							</div>
						</div>
					))}
				</div>
				<div className="mt-2 flex justify-between font-mono text-[0.6rem] text-mist-700">
					<span>{series[0]?.date}</span>
					<span>today</span>
				</div>
			</Panel>

			<Panel className="overflow-hidden">
				<div className="border-b border-white/[0.06] px-5 py-4">
					<SectionHeading title="By model" description="Where your tokens went this month." />
				</div>
				{usage.byModel.length === 0 ? (
					<p className="px-5 py-8 text-center text-xs text-mist-500">
						No usage recorded yet. Run a task to populate this table.
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead className="text-[0.6rem] uppercase tracking-[0.12em] text-mist-600">
								<tr className="border-b border-white/[0.06]">
									<th className="px-5 py-2.5 font-medium">Model</th>
									<th className="px-5 py-2.5 text-right font-medium">Runs</th>
									<th className="px-5 py-2.5 text-right font-medium">Tokens</th>
									<th className="px-5 py-2.5 text-right font-medium">Cost</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-white/[0.055]">
								{usage.byModel.map((model) => (
									<tr key={model.modelId}>
										<td className="px-5 py-2.5 font-mono text-[0.7rem] text-mist-200">
											{model.modelId}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-400">{model.runs}</td>
										<td className="px-5 py-2.5 text-right text-mist-300">
											{formatNumber(model.tokens)}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-300">
											{formatUsd(model.costUsd)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>

			<Panel className="overflow-hidden">
				<div className="border-b border-white/[0.06] px-5 py-4">
					<SectionHeading title="Recent runs" description="The newest 40 metered records." />
				</div>
				{usage.recent.length === 0 ? (
					<p className="px-5 py-8 text-center text-xs text-mist-500">Nothing recorded yet.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-[0.72rem]">
							<thead className="text-[0.6rem] uppercase tracking-[0.12em] text-mist-600">
								<tr className="border-b border-white/[0.06]">
									<th className="px-5 py-2.5 font-medium">When</th>
									<th className="px-5 py-2.5 font-medium">Model</th>
									<th className="px-5 py-2.5 text-right font-medium">Prompt</th>
									<th className="px-5 py-2.5 text-right font-medium">Completion</th>
									<th className="px-5 py-2.5 text-right font-medium">Total</th>
									<th className="px-5 py-2.5 text-right font-medium">Cost</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-white/[0.055]">
								{usage.recent.map((record) => (
									<tr key={record.id}>
										<td className="whitespace-nowrap px-5 py-2.5 text-mist-500">
											{formatDateTime(record.created_at)}
										</td>
										<td className="px-5 py-2.5 font-mono text-[0.65rem] text-mist-300">
											{record.model_id}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-400">
											{formatNumber(record.prompt_tokens)}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-400">
											{formatNumber(record.completion_tokens)}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-300">
											{formatNumber(record.total_tokens)}
										</td>
										<td className="px-5 py-2.5 text-right text-mist-300">
											{formatUsd(Number(record.cost_usd))}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>

			<InlineAlert tone="info" title="How metering works">
				<div className="flex items-start gap-2">
					<Info className="mt-0.5 size-3.5 shrink-0" />
					<span>
						Token counts come from the provider response. When OpenRouter reports a cost we store
						it; otherwise we estimate from the model&apos;s published per-token pricing and mark the
						record accordingly. Sandbox time is not currently billed.
					</span>
				</div>
			</InlineAlert>
		</div>
	);
}
