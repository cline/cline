"use client"

import { useMemo } from "react"
import { LoaderCircle } from "lucide-react"

import * as db from "@evals/db"

import { formatCurrency, formatDuration, formatTokens } from "@/lib/formatters"
import { useRunStatus } from "@/hooks/use-run-status"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"

import { TaskStatus } from "./task-status"
import { ConnectionStatus } from "./connection-status"

type TaskMetrics = Pick<db.TaskMetrics, "tokensIn" | "tokensOut" | "tokensContext" | "duration" | "cost">

export function Run({ run }: { run: db.Run }) {
	const { tasks, status, tokenUsage, usageUpdatedAt } = useRunStatus(run)

	const taskMetrics: Record<number, TaskMetrics> = useMemo(() => {
		const metrics: Record<number, TaskMetrics> = {}

		tasks?.forEach((task) => {
			const usage = tokenUsage.get(task.id)

			if (task.finishedAt && task.taskMetrics) {
				metrics[task.id] = task.taskMetrics
			} else if (usage) {
				metrics[task.id] = {
					tokensIn: usage.totalTokensIn,
					tokensOut: usage.totalTokensOut,
					tokensContext: usage.contextTokens,
					duration: usage.duration ?? 0,
					cost: usage.totalCost,
				}
			}
		})

		return metrics
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tasks, tokenUsage, usageUpdatedAt])

	return (
		<>
			<div>
				<div className="mb-2">
					<div>
						<div>{run.model}</div>
						{run.description && <div className="text-sm text-muted-foreground">{run.description}</div>}
					</div>
					{!run.taskMetricsId && <ConnectionStatus status={status} pid={run.pid} />}
				</div>
				{!tasks ? (
					<LoaderCircle className="size-4 animate-spin" />
				) : (
					<Table className="border">
						<TableHeader>
							<TableRow>
								<TableHead>Exercise</TableHead>
								<TableHead className="text-center">Tokens In / Out</TableHead>
								<TableHead>Context</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead>Cost</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tasks.map((task) => (
								<TableRow key={task.id}>
									<TableCell>
										<div className="flex items-center gap-2">
											<TaskStatus
												task={task}
												running={!!task.startedAt || !!tokenUsage.get(task.id)}
											/>
											<div>
												{task.language}/{task.exercise}
											</div>
										</div>
									</TableCell>
									{taskMetrics[task.id] ? (
										<>
											<TableCell className="font-mono text-xs">
												<div className="flex items-center justify-evenly">
													<div>{formatTokens(taskMetrics[task.id]!.tokensIn)}</div>/
													<div>{formatTokens(taskMetrics[task.id]!.tokensOut)}</div>
												</div>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatTokens(taskMetrics[task.id]!.tokensContext)}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{taskMetrics[task.id]!.duration
													? formatDuration(taskMetrics[task.id]!.duration)
													: "-"}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatCurrency(taskMetrics[task.id]!.cost)}
											</TableCell>
										</>
									) : (
										<TableCell colSpan={4} />
									)}
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>
		</>
	)
}
