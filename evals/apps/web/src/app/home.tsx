"use client"

import { useCallback, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Ellipsis, Rocket } from "lucide-react"

import type { Run, TaskMetrics } from "@evals/db"

import { deleteRun } from "@/lib/server/runs"
import { formatCurrency, formatDuration, formatTokens } from "@/lib"
import {
	Button,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui"

export function Home({ runs }: { runs: (Run & { taskMetrics: TaskMetrics | null })[] }) {
	const router = useRouter()

	const [deleteRunId, setDeleteRunId] = useState<number>()
	const continueRef = useRef<HTMLButtonElement>(null)

	const onConfirmDelete = useCallback(async () => {
		if (!deleteRunId) {
			return
		}

		try {
			await deleteRun(deleteRunId)
			setDeleteRunId(undefined)
		} catch (error) {
			console.error(error)
		}
	}, [deleteRunId])

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
					{runs.length ? (
						runs.map(({ taskMetrics, ...run }) => (
							<TableRow key={run.id}>
								<TableCell>{run.model}</TableCell>
								<TableCell>{run.passed}</TableCell>
								<TableCell>{run.failed}</TableCell>
								<TableCell>
									{run.passed + run.failed > 0 && (
										<span>{((run.passed / (run.passed + run.failed)) * 100).toFixed(1)}%</span>
									)}
								</TableCell>
								<TableCell>
									{taskMetrics && (
										<div className="flex items-center justify-evenly">
											<div>{formatTokens(taskMetrics.tokensIn)}</div>/
											<div>{formatTokens(taskMetrics.tokensOut)}</div>
										</div>
									)}
								</TableCell>
								<TableCell>{taskMetrics && formatCurrency(taskMetrics.cost)}</TableCell>
								<TableCell>{taskMetrics && formatDuration(taskMetrics.duration)}</TableCell>
								<TableCell>
									<DropdownMenu>
										<Button variant="ghost" size="icon" asChild>
											<DropdownMenuTrigger>
												<Ellipsis />
											</DropdownMenuTrigger>
										</Button>
										<DropdownMenuContent align="end">
											<DropdownMenuItem asChild>
												<Link href={`/runs/${run.id}`}>View Tasks</Link>
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => {
													setDeleteRunId(run.id)
													setTimeout(() => continueRef.current?.focus(), 0)
												}}>
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
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
			<AlertDialog open={!!deleteRunId} onOpenChange={() => setDeleteRunId(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction ref={continueRef} onClick={onConfirmDelete}>
							Continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
