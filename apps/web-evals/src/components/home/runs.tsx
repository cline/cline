"use client"

import { useRouter } from "next/navigation"
import { Rocket } from "lucide-react"

import type { Run, TaskMetrics } from "@roo-code/evals"

import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"
import { Run as Row } from "@/components/home/run"

type RunWithTaskMetrics = Run & { taskMetrics: TaskMetrics | null }

export function Runs({ runs }: { runs: RunWithTaskMetrics[] }) {
	const router = useRouter()

	return (
		<>
			<Table className="border border-t-0">
				<TableHeader>
					<TableRow>
						<TableHead>Model</TableHead>
						<TableHead>Passed</TableHead>
						<TableHead>Failed</TableHead>
						<TableHead>% Correct</TableHead>
						<TableHead>Tokens In / Out</TableHead>
						<TableHead>Diff Edits</TableHead>
						<TableHead>Cost</TableHead>
						<TableHead>Duration</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.length ? (
						runs.map(({ taskMetrics, ...run }) => <Row key={run.id} run={run} taskMetrics={taskMetrics} />)
					) : (
						<TableRow>
							<TableCell colSpan={9} className="text-center">
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
