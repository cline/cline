"use client"

import { useRouter } from "next/navigation"
import { Rocket } from "lucide-react"

import type { Run, TaskMetrics } from "@evals/db"

import { formatCurrency, formatDuration } from "@/lib"
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"
import { useMemo } from "react"
import Link from "next/link"

export function Home({ runs }: { runs: (Run & { taskMetrics: TaskMetrics | null })[] }) {
	const router = useRouter()

	const visibleRuns = useMemo(() => runs.filter((run) => run.taskMetrics !== null), [runs])

	return (
		<>
			<Table className="border border-t-0">
				<TableHeader>
					<TableRow>
						<TableHead>ID</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Timestamp</TableHead>
						<TableHead>Passed</TableHead>
						<TableHead>Failed</TableHead>
						<TableHead>% Correct</TableHead>
						<TableHead>Cost</TableHead>
						<TableHead>Duration</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{visibleRuns.length ? (
						visibleRuns.map(({ taskMetrics, ...run }) => (
							<TableRow key={run.id}>
								<TableCell>
									<Button variant="link" asChild>
										<Link href={`/runs/${run.id}`}>{run.id}</Link>
									</Button>
								</TableCell>
								<TableCell>{run.model}</TableCell>
								<TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
								<TableCell>{run.passed}</TableCell>
								<TableCell>{run.failed}</TableCell>
								<TableCell>{((run.passed / (run.passed + run.failed)) * 100).toFixed(1)}%</TableCell>
								<TableCell>{formatCurrency(taskMetrics!.cost)}</TableCell>
								<TableCell>{formatDuration(taskMetrics!.duration)}</TableCell>
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
