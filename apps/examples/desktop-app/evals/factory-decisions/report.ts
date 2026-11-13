import { type Grade, isHarnessOutcome, type Trial } from "./grade";

/** Pure summaries and renderings of graded trials. */

export interface ScenarioSummary {
	suite: Trial["suite"];
	id: string;
	expect: string;
	trials: number;
	/** Trials that had a pass/fail grade. */
	graded: number;
	passes: number;
	passRate?: number;
	/** Wilson 95% interval on the pass rate. */
	interval?: [number, number];
	/** Share of the most common outcome among the model's (non-harness) trials. */
	consistency?: number;
	outcomes: Record<string, number>;
	meanSeconds: number;
	cost?: number;
	/** Distinct reasons for failed grades. */
	failures: string[];
}

export interface ScenarioRun {
	suite: Trial["suite"];
	id: string;
	expect: string;
	trials: Trial[];
	grades: (Grade | undefined)[];
}

/** Wilson score interval for k successes in n trials (z = 1.96: 95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
	if (n === 0) return [0, 1];
	const p = k / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const center = (p + z2 / (2 * n)) / denominator;
	const half =
		(z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function summarize(run: ScenarioRun): ScenarioSummary {
	const outcomes: Record<string, number> = {};
	for (const trial of run.trials)
		outcomes[trial.outcome] = (outcomes[trial.outcome] ?? 0) + 1;
	const decided = Object.entries(outcomes).filter(
		([outcome]) => !isHarnessOutcome(outcome),
	);
	const decidedCount = decided.reduce((sum, [, n]) => sum + n, 0);
	const graded = run.grades.filter((grade): grade is Grade => !!grade);
	const passes = graded.filter((grade) => grade.pass).length;
	const costs = run.trials
		.map((trial) => trial.usage?.totalCost)
		.filter((cost): cost is number => cost !== undefined);
	return {
		suite: run.suite,
		id: run.id,
		expect: run.expect,
		trials: run.trials.length,
		graded: graded.length,
		passes,
		...(graded.length
			? {
					passRate: passes / graded.length,
					interval: wilson(passes, graded.length),
				}
			: {}),
		...(decidedCount
			? {
					consistency: Math.max(...decided.map(([, n]) => n)) / decidedCount,
				}
			: {}),
		outcomes,
		meanSeconds: run.trials.length
			? run.trials.reduce((sum, trial) => sum + trial.seconds, 0) /
				run.trials.length
			: 0,
		...(costs.length ? { cost: costs.reduce((a, b) => a + b, 0) } : {}),
		failures: [
			...new Set(graded.flatMap((grade) => (grade.pass ? [] : grade.reasons))),
		],
	};
}

/** Pass rate over every graded trial; undefined when none was graded. */
export function overallPassRate(
	summaries: readonly ScenarioSummary[],
): number | undefined {
	const graded = summaries.reduce((sum, s) => sum + s.graded, 0);
	return graded
		? summaries.reduce((sum, s) => sum + s.passes, 0) / graded
		: undefined;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function cells(summary: ScenarioSummary): string[] {
	return [
		summary.suite,
		summary.id,
		summary.expect,
		summary.passRate === undefined
			? "-"
			: `${summary.passes}/${summary.graded} (${percent(summary.passRate)})`,
		summary.interval
			? `${percent(summary.interval[0])}-${percent(summary.interval[1])}`
			: "-",
		summary.consistency === undefined ? "-" : percent(summary.consistency),
		Object.entries(summary.outcomes)
			.sort((a, b) => b[1] - a[1])
			.map(([outcome, n]) => `${outcome} x${n}`)
			.join(", "),
		`${summary.meanSeconds.toFixed(0)}s`,
		summary.cost === undefined ? "-" : `$${summary.cost.toFixed(3)}`,
	];
}

const HEADERS = [
	"suite",
	"scenario",
	"expect",
	"pass",
	"95% CI",
	"consistency",
	"outcomes",
	"mean time",
	"cost",
];

/** A fixed-width table for a terminal. */
export function formatTable(summaries: readonly ScenarioSummary[]): string {
	const rows = [HEADERS, ...summaries.map(cells)];
	const widths = HEADERS.map((_, column) =>
		Math.max(...rows.map((row) => (row[column] ?? "").length)),
	);
	const line = (row: string[]) =>
		row
			.map((cell, column) => cell.padEnd(widths[column] ?? 0))
			.join("  ")
			.trimEnd();
	return [
		line(HEADERS),
		widths.map((width) => "-".repeat(width)).join("  "),
		...rows.slice(1).map(line),
	]
		.join("\n")
		.trimEnd();
}

export function formatMarkdown(
	summaries: readonly ScenarioSummary[],
	meta: { provider: string; model: string; trials: number; startedAt: string },
): string {
	const escapeCell = (cell: string) => cell.replaceAll("|", "\\|");
	const overall = overallPassRate(summaries);
	const failures = summaries.filter((s) => s.failures.length);
	return [
		"# Factory decisions eval",
		"",
		`Provider \`${meta.provider}\`, model \`${meta.model}\`, ${meta.trials} trial(s) per scenario, started ${meta.startedAt}.`,
		`Overall pass rate: ${overall === undefined ? "-" : percent(overall)}. With few trials the 95% interval is wide; read it before the rate.`,
		"",
		`| ${HEADERS.join(" | ")} |`,
		`| ${HEADERS.map(() => "---").join(" | ")} |`,
		...summaries.map((s) => `| ${cells(s).map(escapeCell).join(" | ")} |`),
		...(failures.length
			? [
					"",
					"## Why trials failed",
					"",
					...failures.map(
						(s) => `- **${s.suite}/${s.id}**: ${s.failures.join("; ")}`,
					),
				]
			: []),
		"",
	].join("\n");
}
