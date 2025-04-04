"use client"

import { useState, useRef } from "react"
import { LoaderCircle, SquareTerminal } from "lucide-react"

import * as db from "@evals/db"

import { formatCurrency, formatDuration, formatTokens } from "@/lib"
import { useRunStatus } from "@/hooks/use-run-status"
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	ScrollArea,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui"

import { TaskStatus } from "./task-status"
import { ConnectionStatus } from "./connection-status"

export function Run({ run }: { run: db.Run }) {
	const { tasks, status, output, outputCounts } = useRunStatus(run)
	const scrollAreaRef = useRef<HTMLDivElement>(null)
	const [selectedTask, setSelectedTask] = useState<db.Task>()

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
											<TaskStatus task={task} />
											<div>
												{task.language}/{task.exercise}
											</div>
											{(outputCounts[task.id] ?? 0) > 0 && (
												<div
													className="flex items-center gap-1 cursor-pointer"
													onClick={() => setSelectedTask(task)}>
													<SquareTerminal className="size-4" />
													<div className="font-mono text-xs text-foreground/50">
														{outputCounts[task.id]}
													</div>
												</div>
											)}
										</div>
									</TableCell>
									{task.taskMetrics ? (
										<>
											<TableCell className="font-mono text-xs">
												<div className="flex items-center justify-evenly">
													<div>{formatTokens(task.taskMetrics.tokensIn)}</div>/
													<div>{formatTokens(task.taskMetrics.tokensOut)}</div>
												</div>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatTokens(task.taskMetrics.tokensContext)}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatDuration(task.taskMetrics.duration)}
											</TableCell>
											<TableCell className="font-mono text-xs">
												{formatCurrency(task.taskMetrics.cost)}
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
			<Drawer open={!!selectedTask} onOpenChange={() => setSelectedTask(undefined)}>
				<DrawerContent>
					<div className="mx-auto w-full max-w-2xl">
						<DrawerHeader>
							<DrawerTitle>
								{selectedTask?.language}/{selectedTask?.exercise}
							</DrawerTitle>
						</DrawerHeader>
						<div className="font-mono text-xs pb-12">
							{selectedTask && (
								<ScrollArea viewportRef={scrollAreaRef} className="h-96 rounded-sm border">
									<div className="p-4">
										<h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
										{output.get(selectedTask.id)?.map((line, i) => <div key={i}>{line}</div>)}
									</div>
								</ScrollArea>
							)}
						</div>
					</div>
				</DrawerContent>
			</Drawer>
		</>
	)
}
