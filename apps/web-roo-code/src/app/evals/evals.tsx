"use client"

import { useMemo } from "react"
import { ScatterChart, Scatter, XAxis, YAxis, Label, Customized, Cross } from "recharts"

import type { TaskMetrics, Run } from "@roo-code/evals"

import { formatTokens, formatCurrency, formatDuration, formatScore } from "@/lib"
import { useOpenRouterModels } from "@/lib/hooks"
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	ChartConfig,
	ChartLegend,
	ChartLegendContent,
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui"

export function Evals({
	runs,
}: {
	runs: (Run & {
		label: string
		score: number
		languageScores?: Record<"go" | "java" | "javascript" | "python" | "rust", number>
		taskMetrics: TaskMetrics
		modelId?: string
	})[]
}) {
	const { data: openRouterModels } = useOpenRouterModels()

	const tableData = useMemo(
		() =>
			runs.map((run) => ({
				...run,
				label: run.description || run.model,
				score: run.score,
				cost: run.taskMetrics.cost,
				model: openRouterModels?.[run.modelId ?? ""],
				modelInfo: openRouterModels?.[run.modelId ?? ""]?.modelInfo,
			})),
		[runs, openRouterModels],
	)

	const chartData = useMemo(() => tableData.filter(({ cost }) => cost < 100), [tableData])

	const chartConfig = useMemo(
		() => chartData.reduce((acc, run) => ({ ...acc, [run.label]: run }), {} as ChartConfig),
		[chartData],
	)

	return (
		<div className="mx-auto flex max-w-screen-lg flex-col gap-8 p-8">
			<div className="flex flex-col gap-4">
				<div>
					Roo Code tests each frontier model against{" "}
					<a href="https://github.com/cte/evals/" className="underline">
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
							<TableCell title={run.model?.description}>
								<div className="font-sans">{run.label}</div>
								<div className="text-xs opacity-50">
									{formatTokens(run.modelInfo?.contextWindow ?? 0)}
								</div>
							</TableCell>
							<TableCell className="border-r">
								<div className="flex flex-row gap-2">
									<div>{formatCurrency(run.modelInfo?.inputPrice ?? 0)}</div>
									<div className="opacity-25">/</div>
									<div>{formatCurrency(run.modelInfo?.outputPrice ?? 0)}</div>
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
					<div className="pb-4 font-medium">Cost Versus Score</div>
					<ChartContainer config={chartConfig} className="h-[500px] w-full">
						<ScatterChart margin={{ top: 0, right: 0, bottom: 0, left: 20 }}>
							<XAxis
								type="number"
								dataKey="cost"
								name="Cost"
								domain={[
									(dataMin: number) => Math.round((dataMin - 5) / 5) * 5,
									(dataMax: number) => Math.round((dataMax + 5) / 5) * 5,
								]}
								tickFormatter={(value) => formatCurrency(value)}>
								<Label value="Cost" position="bottom" offset={0} />
							</XAxis>
							<YAxis
								type="number"
								dataKey="score"
								name="Score"
								domain={[
									(dataMin: number) => Math.max(0, Math.round((dataMin - 5) / 5) * 5),
									(dataMax: number) => Math.min(100, Math.round((dataMax + 5) / 5) * 5),
								]}
								tickFormatter={(value) => `${value}%`}>
								<Label value="Score" angle={-90} position="left" dy={-15} />
							</YAxis>
							<ChartTooltip content={<ChartTooltipContent labelKey="label" hideIndicator />} />
							<Customized component={renderQuadrant} />
							{chartData.map((d, i) => (
								<Scatter key={d.label} name={d.label} data={[d]} fill={`hsl(var(--chart-${i + 1}))`} />
							))}
							<ChartLegend content={<ChartLegendContent />} />
						</ScatterChart>
					</ChartContainer>
					<div className="py-4 text-xs opacity-50">
						(Note: Very expensive models are exluded from the scatter plot.)
					</div>
				</TableCaption>
			</Table>
		</div>
	)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderQuadrant = (props: any) => (
	<Cross
		width={props.width}
		height={props.height}
		x={props.width / 2 + 35}
		y={props.height / 2 - 15}
		top={0}
		left={0}
		stroke="currentColor"
		opacity={0.1}
	/>
)
