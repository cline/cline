import { useCallback, useState, useRef } from "react"
import Link from "next/link"
import { Ellipsis, ClipboardList, Copy, Check, LoaderCircle, Trash } from "lucide-react"

import type { Run as EvalsRun, TaskMetrics as EvalsTaskMetrics } from "@roo-code/evals"

import { deleteRun } from "@/actions/runs"
import { formatCurrency, formatDuration, formatTokens, formatToolUsageSuccessRate } from "@/lib/formatters"
import { useCopyRun } from "@/hooks/use-copy-run"
import {
	Button,
	TableCell,
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

type RunProps = {
	run: EvalsRun
	taskMetrics: EvalsTaskMetrics | null
}

export function Run({ run, taskMetrics }: RunProps) {
	const [deleteRunId, setDeleteRunId] = useState<number>()
	const continueRef = useRef<HTMLButtonElement>(null)
	const { isPending, copyRun, copied } = useCopyRun(run.id)

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
			<TableRow>
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
						<div className="flex items-center gap-1.5">
							<div>{formatTokens(taskMetrics.tokensIn)}</div>/
							<div>{formatTokens(taskMetrics.tokensOut)}</div>
						</div>
					)}
				</TableCell>
				<TableCell>
					{taskMetrics?.toolUsage?.apply_diff && (
						<div className="flex flex-row items-center gap-1.5">
							<div>{taskMetrics.toolUsage.apply_diff.attempts}</div>
							<div>/</div>
							<div>{formatToolUsageSuccessRate(taskMetrics.toolUsage.apply_diff)}</div>
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
								<Link href={`/runs/${run.id}`}>
									<div className="flex items-center gap-1">
										<ClipboardList />
										<div>View Tasks</div>
									</div>
								</Link>
							</DropdownMenuItem>
							{run.taskMetricsId && (
								<DropdownMenuItem onClick={() => copyRun()} disabled={isPending || copied}>
									<div className="flex items-center gap-1">
										{isPending ? (
											<>
												<LoaderCircle className="animate-spin" />
												Copying...
											</>
										) : copied ? (
											<>
												<Check />
												Copied!
											</>
										) : (
											<>
												<Copy />
												Copy to Production
											</>
										)}
									</div>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								onClick={() => {
									setDeleteRunId(run.id)
									setTimeout(() => continueRef.current?.focus(), 0)
								}}>
								<div className="flex items-center gap-1">
									<Trash />
									<div>Delete</div>
								</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</TableCell>
			</TableRow>
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
