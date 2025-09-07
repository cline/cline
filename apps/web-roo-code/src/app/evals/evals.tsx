"use client"

import { useMemo } from "react"

import { formatTokens, formatCurrency, formatDuration, formatScore } from "@/lib"
import { useOpenRouterModels } from "@/lib/hooks"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui"

import type { EvalRun } from "./types"
import { Plot } from "./plot"

export function Evals({ runs }: { runs: EvalRun[] }) {
	const { data: openRouterModels } = useOpenRouterModels()

	const tableData: (EvalRun & { label: string; cost: number })[] = useMemo(
		() =>
			runs.map((run) => {
				const openRouterModelInfo = openRouterModels?.[run.modelId ?? ""]?.modelInfo

				return {
					...run,
					label: run.name || run.description || run.model,
					cost: run.taskMetrics.cost,
					description: run.description ?? openRouterModelInfo?.description ?? null,
					contextWindow: run.contextWindow ?? openRouterModelInfo?.contextWindow ?? null,
					inputPrice: run.inputPrice ?? openRouterModelInfo?.inputPrice ?? null,
					outputPrice: run.outputPrice ?? openRouterModelInfo?.outputPrice ?? null,
				}
			}),
		[runs, openRouterModels],
	)

	return (
		<div className="mx-auto flex max-w-screen-lg flex-col gap-8 p-8">
			<div className="flex flex-col gap-4">
				<div>
					Roo Code tests each frontier model against{" "}
					<a href="https://github.com/RooCodeInc/Roo-Code-Evals" className="underline">
						a suite of hundreds of exercises
					</a>{" "}
					across 5 programming languages with varying difficulty. These results can help you find the right
					price-to-intelligence ratio for your use case.
				</div>
				<div>
					Want to see the results for a model we haven&apos;t tested yet? Ping us in{" "}
					<a href="https://discord.gg/roocode" className="underline">
						Discord
					</a>
					.
				</div>
			</div>
			<Table className="border">
				<TableHeader>
					<TableRow>
						<TableHead colSpan={2} className="border-r text-center">
							Model
						</TableHead>
						<TableHead colSpan={3} className="border-r text-center">
							Metrics
						</TableHead>
						<TableHead colSpan={6} className="text-center">
							Scores
						</TableHead>
					</TableRow>
					<TableRow>
						<TableHead>
							Name
							<div className="text-xs opacity-50">Context Window</div>
						</TableHead>
						<TableHead className="border-r">
							Price
							<div className="text-xs opacity-50">In / Out</div>
						</TableHead>
						<TableHead>Duration</TableHead>
						<TableHead>
							Tokens
							<div className="text-xs opacity-50">In / Out</div>
						</TableHead>
						<TableHead className="border-r">
							Cost
							<div className="text-xs opacity-50">USD</div>
						</TableHead>
						<TableHead>
							<i className="devicon-go-plain text-lg" title="Go" />
						</TableHead>
						<TableHead>
							<i className="devicon-java-plain text-lg" title="Java" />
						</TableHead>
						<TableHead>
							<i className="devicon-javascript-plain text-lg" title="JavaScript" />
						</TableHead>
						<TableHead>
							<i className="devicon-python-plain text-lg" title="Python" />
						</TableHead>
						<TableHead>
							<i className="devicon-rust-original text-lg" title="Rust" />
						</TableHead>
						<TableHead>Total</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="font-mono">
					{tableData.map((run) => (
						<TableRow key={run.id}>
							<TableCell title={run.description ?? undefined}>
								<div className="font-sans">{run.label}</div>
								<div className="text-xs opacity-50">{formatTokens(run.contextWindow)}</div>
							</TableCell>
							<TableCell className="border-r">
								<div className="flex flex-row gap-2">
									<div>{formatCurrency(run.inputPrice)}</div>
									<div className="opacity-25">/</div>
									<div>{formatCurrency(run.outputPrice)}</div>
								</div>
							</TableCell>
							<TableCell className="font-mono">{formatDuration(run.taskMetrics.duration)}</TableCell>
							<TableCell>
								<div className="flex flex-row gap-2">
									<div>{formatTokens(run.taskMetrics.tokensIn)}</div>
									<div className="opacity-25">/</div>
									<div>{formatTokens(run.taskMetrics.tokensOut)}</div>
								</div>
							</TableCell>
							<TableCell className="border-r">{formatCurrency(run.taskMetrics.cost)}</TableCell>
							<TableCell className="text-muted-foreground">
								{formatScore(run.languageScores?.go ?? 0)}%
							</TableCell>
							<TableCell className="text-muted-foreground">
								{formatScore(run.languageScores?.java ?? 0)}%
							</TableCell>
							<TableCell className="text-muted-foreground">
								{formatScore(run.languageScores?.javascript ?? 0)}%
							</TableCell>
							<TableCell className="text-muted-foreground">
								{formatScore(run.languageScores?.python ?? 0)}%
							</TableCell>
							<TableCell className="text-muted-foreground">
								{formatScore(run.languageScores?.rust ?? 0)}%
							</TableCell>
							<TableCell className="font-bold">{run.score}%</TableCell>
						</TableRow>
					))}
				</TableBody>
				<TableCaption>
					<Plot tableData={tableData} />
				</TableCaption>
			</Table>
		</div>
	)
}
