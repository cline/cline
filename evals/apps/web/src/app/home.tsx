"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight, Rocket } from "lucide-react"

import type { Run, TaskMetrics } from "@evals/db"

import { formatCurrency, formatDuration, formatTokens } from "@/lib"
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"

export function Home({ runs }: { runs: (Run & { taskMetrics: TaskMetrics | null })[] }) {
	const router = useRouter()

	const visibleRuns = useMemo(() => runs.filter((run) => run.taskMetrics !== null), [runs])

	return (
		<>
			<Table className="border border-t-0">
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead>Passed</TableHead>
						<TableHead>Failed</TableHead>
						<TableHead>% Correct</TableHead>
						<TableHead className="text-center">Tokens In / Out</TableHead>
						<TableHead>Cost</TableHead>
						<TableHead>Duration</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{visibleRuns.length ? (
						visibleRuns.map(({ taskMetrics, ...run }) => (
							<TableRow key={run.id}>
								<TableCell>{run.model}</TableCell>
								<TableCell>{run.passed}</TableCell>
								<TableCell>{run.failed}</TableCell>
								<TableCell>{((run.passed / (run.passed + run.failed)) * 100).toFixed(1)}%</TableCell>
								<TableCell>
									<div className="flex items-center justify-evenly">
										<div>{formatTokens(taskMetrics!.tokensIn)}</div>/
										<div>{formatTokens(taskMetrics!.tokensOut)}</div>
									</div>
								</TableCell>
								<TableCell>{formatCurrency(taskMetrics!.cost)}</TableCell>
								<TableCell>{formatDuration(taskMetrics!.duration)}</TableCell>
								<TableCell>
									<Button variant="ghost" size="icon" asChild>
										<Link href={`/runs/${run.id}`}>
											<ChevronRight />
										</Link>
									</Button>
								</TableCell>
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell colSpan={8} className="text-center">
								No eval runs yet.
								<Button variant="link" onClick={() => router.push("/runs/new")}>
									Launch
								</Button>
								one now.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
			<Button
				variant="default"
				className="absolute top-4 right-12 size-12 rounded-full"
				onClick={() => router.push("/runs/new")}>
				<Rocket className="size-6" />
			</Button>
		</>
	)
}
