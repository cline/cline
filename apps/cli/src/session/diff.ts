import {
	formatSessionReplayDivergence,
	SESSION_REPLAY_DIVERGENCE_KINDS,
	type SessionReplayDivergenceReport,
} from "@cline/replay";

export interface SessionDiffSide {
	bundleDir: string;
	sessionId: string;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describeKinds(report: SessionReplayDivergenceReport): string {
	const ignored = SESSION_REPLAY_DIVERGENCE_KINDS.filter(
		(kind) => !report.kinds.includes(kind),
	);
	return ignored.length === 0
		? "all divergence kinds"
		: `all divergence kinds except ${ignored.join(", ")}`;
}

/** The text report of `cline session diff`. */
export function formatSessionDiffText(input: {
	recorded: SessionDiffSide;
	live: SessionDiffSide;
	report: SessionReplayDivergenceReport;
}): string[] {
	const { report } = input;
	const lines = [
		"Session diff",
		`  recorded: ${input.recorded.bundleDir} · session ${input.recorded.sessionId} · ${plural(report.iterations.recorded, "iteration")}`,
		`  live:     ${input.live.bundleDir} · session ${input.live.sessionId} · ${plural(report.iterations.live, "iteration")}`,
		`  counting: ${describeKinds(report)} · ${report.strictness}`,
		"",
	];
	for (const row of report.perIteration) {
		const kinds = row.kinds.map((kind) =>
			report.kinds.includes(kind) ? kind : `${kind} (not counted)`,
		);
		lines.push(
			`  iteration ${row.iteration}  ${kinds.length > 0 ? kinds.join(", ") : "same"}`,
		);
	}
	if (report.first) {
		lines.push(
			"",
			"First divergence",
			...formatSessionReplayDivergence(report.first).map((line) => `  ${line}`),
		);
	}
	const counted = report.divergences.filter(
		(divergence) => divergence.counted,
	).length;
	const ignored = report.divergences.length - counted;
	const iterationsWithCounted = report.perIteration.filter(
		(row) => row.counted,
	).length;
	lines.push(
		"",
		report.diverged
			? `Result: diverged · ${plural(counted, "counted divergence")} in ${plural(iterationsWithCounted, "iteration")}${ignored > 0 ? ` · ${ignored} not counted` : ""}${report.failed ? "" : " (lenient)"}`
			: `Result: no divergence across ${plural(Math.max(report.iterations.recorded, report.iterations.live), "iteration")}${ignored > 0 ? ` · ${ignored} not counted` : ""}`,
	);
	return lines;
}
