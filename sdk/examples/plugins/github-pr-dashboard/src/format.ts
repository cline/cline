import type { AgentMessage } from "@cline/shared";
import type { GitHubPrDashboardRun, GitHubPrDashboardSnapshot } from "./schema";

function tableRows(rows: string[][]): string {
	return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

export function renderDashboardMarkdown(
	snapshot: GitHubPrDashboardSnapshot,
): string {
	return [
		"# GitHub PR Dashboard",
		"",
		`Generated: ${snapshot.generatedAt}`,
		`Repositories: ${snapshot.repositories.join(", ")}`,
		"",
		"## Summary",
		tableRows([
			["Metric", "Value"],
			["Open PRs", String(snapshot.summary.openCount)],
			[
				`New open PRs (${snapshot.window.newPrHours}h)`,
				String(snapshot.summary.newOpenCount),
			],
			[
				`Recently closed (${snapshot.window.recentlyClosedDays}d)`,
				String(snapshot.summary.recentlyClosedCount),
			],
			["Average open age", `${snapshot.summary.avgOpenAgeHours}h`],
			[
				"Average waiting for review",
				`${snapshot.summary.avgWaitingForReviewHours}h`,
			],
		]),
		"",
		"## Waiting for Review",
		...(snapshot.waitingForReview.length > 0
			? [
					tableRows([
						["PR", "Title", "Author", "Waiting", "Requested"],
						...snapshot.waitingForReview.map((pr) => [
							`[${pr.repository}#${pr.number}](${pr.url})`,
							pr.title.replaceAll("|", "\\|"),
							pr.author,
							`${pr.waitingHours}h`,
							[...pr.requestedReviewers, ...pr.requestedTeams].join(", ") ||
								"—",
						]),
					]),
				]
			: ["No open PRs are currently waiting for requested reviewers."]),
		"",
		"## Volume Trend",
		tableRows([
			["Date", "Opened", "Closed", "Merged"],
			...snapshot.volumeTrend.map((day) => [
				day.date,
				String(day.opened),
				String(day.closed),
				String(day.merged),
			]),
		]),
		"",
		"## Leading Authors",
		"### This Week",
		snapshot.leadingAuthors.week
			.map((item) => `- ${item.login}: ${item.count}`)
			.join("\n") || "- none",
		"### This Month",
		snapshot.leadingAuthors.month
			.map((item) => `- ${item.login}: ${item.count}`)
			.join("\n") || "- none",
		"",
		"## Leading Reviewers",
		"### This Week",
		snapshot.leadingReviewers.week
			.map((item) => `- ${item.login}: ${item.count}`)
			.join("\n") || "- none",
		"### This Month",
		snapshot.leadingReviewers.month
			.map((item) => `- ${item.login}: ${item.count}`)
			.join("\n") || "- none",
		"",
		"## Repository Breakdown",
		tableRows([
			[
				"Repository",
				"Open",
				"New",
				"Recently Closed",
				"Avg Open Age",
				"Avg Review Wait",
			],
			...snapshot.repositoryBreakdown.map((repo) => [
				repo.repository,
				String(repo.openCount),
				String(repo.newOpenCount),
				String(repo.recentlyClosedCount),
				`${repo.avgOpenAgeHours}h`,
				`${repo.avgWaitingForReviewHours}h`,
			]),
		]),
		"",
	].join("\n");
}

function signedDelta(current: number, previous: number): string {
	const delta = current - previous;
	if (delta === 0) return "no change";
	return `${previous} → ${current} (${delta > 0 ? "+" : ""}${delta})`;
}

function itemKey(item: { repository: string; number: number }): string {
	return `${item.repository}#${item.number}`;
}

function topLogin(items: Array<{ login: string; count: number }>): string {
	const item = items[0];
	return item ? `${item.login} (${item.count})` : "none";
}

function summarizeWaitingChanges(
	previous: GitHubPrDashboardSnapshot,
	current: GitHubPrDashboardSnapshot,
): string[] {
	const previousWaiting = new Map(
		previous.waitingForReview.map((item) => [itemKey(item), item]),
	);
	const currentWaiting = new Map(
		current.waitingForReview.map((item) => [itemKey(item), item]),
	);
	const newlyWaiting = [...currentWaiting.entries()]
		.filter(([key]) => !previousWaiting.has(key))
		.slice(0, 5)
		.map(([key, item]) => `${key} ${item.title}`);
	const noLongerWaiting = [...previousWaiting.entries()]
		.filter(([key]) => !currentWaiting.has(key))
		.slice(0, 5)
		.map(([key, item]) => `${key} ${item.title}`);

	return [
		...(newlyWaiting.length > 0
			? [`Newly waiting for review: ${newlyWaiting.join("; ")}`]
			: []),
		...(noLongerWaiting.length > 0
			? [`No longer waiting for review: ${noLongerWaiting.join("; ")}`]
			: []),
	];
}

export function summarizeDashboardChanges(
	previous: GitHubPrDashboardSnapshot | undefined,
	current: GitHubPrDashboardSnapshot,
): string[] {
	if (!previous) {
		return [
			"Initial dashboard snapshot captured; future runs will summarize changes from this baseline.",
		];
	}

	const changes = [
		`Open PRs: ${signedDelta(current.summary.openCount, previous.summary.openCount)}`,
		`New open PRs: ${signedDelta(current.summary.newOpenCount, previous.summary.newOpenCount)}`,
		`Recently closed PRs: ${signedDelta(current.summary.recentlyClosedCount, previous.summary.recentlyClosedCount)}`,
		...summarizeWaitingChanges(previous, current),
	];

	const previousTopAuthor = topLogin(previous.leadingAuthors.week);
	const currentTopAuthor = topLogin(current.leadingAuthors.week);
	if (previousTopAuthor !== currentTopAuthor) {
		changes.push(
			`Top author this week: ${previousTopAuthor} → ${currentTopAuthor}`,
		);
	}

	const previousTopReviewer = topLogin(previous.leadingReviewers.week);
	const currentTopReviewer = topLogin(current.leadingReviewers.week);
	if (previousTopReviewer !== currentTopReviewer) {
		changes.push(
			`Top reviewer this week: ${previousTopReviewer} → ${currentTopReviewer}`,
		);
	}

	return changes.filter((change) => !change.endsWith("no change"));
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function htmlTable(headers: string[], rows: string[][]): string {
	return [
		"<table>",
		`<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
		`<tbody>${rows
			.map(
				(row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
			)
			.join("")}</tbody>`,
		"</table>",
	].join("\n");
}

function metricCard(label: string, value: string): string {
	return `<section class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></section>`;
}

function topList(items: Array<{ login: string; count: number }>): string {
	if (items.length === 0) return '<p class="muted">none</p>';
	return `<ol>${items
		.map(
			(item) =>
				`<li><span>${escapeHtml(item.login)}</span><strong>${item.count}</strong></li>`,
		)
		.join("")}</ol>`;
}

export function renderDashboardHtml(
	snapshot: GitHubPrDashboardSnapshot,
): string {
	const waitingRows = snapshot.waitingForReview.map((pr) => [
		`<a href="${escapeHtml(pr.url)}">${escapeHtml(`${pr.repository}#${pr.number}`)}</a>`,
		escapeHtml(pr.title),
		escapeHtml(pr.author),
		escapeHtml(`${pr.waitingHours}h`),
		escapeHtml(
			[...pr.requestedReviewers, ...pr.requestedTeams].join(", ") || "—",
		),
	]);
	const trendRows = snapshot.volumeTrend.map((day) => [
		escapeHtml(day.date),
		escapeHtml(String(day.opened)),
		escapeHtml(String(day.closed)),
		escapeHtml(String(day.merged)),
	]);
	const repoRows = snapshot.repositoryBreakdown.map((repo) => [
		escapeHtml(repo.repository),
		escapeHtml(String(repo.openCount)),
		escapeHtml(String(repo.newOpenCount)),
		escapeHtml(String(repo.recentlyClosedCount)),
		escapeHtml(`${repo.avgOpenAgeHours}h`),
		escapeHtml(`${repo.avgWaitingForReviewHours}h`),
	]);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GitHub PR Dashboard</title>
<style>
:root { color-scheme: light dark; --bg: #0f172a; --panel: #111827; --muted: #94a3b8; --text: #e5e7eb; --accent: #38bdf8; --border: #334155; }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
main { max-width: 1120px; margin: 0 auto; padding: 32px; }
h1, h2, h3 { line-height: 1.1; }
a { color: var(--accent); }
.muted { color: var(--muted); }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.metric, .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.metric span { color: var(--muted); display: block; font-size: 13px; margin-bottom: 8px; }
.metric strong { font-size: 28px; }
table { border-collapse: collapse; width: 100%; overflow: hidden; border-radius: 12px; }
th, td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; vertical-align: top; }
th { background: #1e293b; }
ol { margin: 0; padding-left: 24px; }
li { margin: 6px 0; }
li strong { margin-left: 8px; color: var(--accent); }
section { margin: 28px 0; }
</style>
</head>
<body>
<main>
<h1>GitHub PR Dashboard</h1>
<p class="muted">Generated ${escapeHtml(snapshot.generatedAt)} for ${escapeHtml(snapshot.repositories.join(", "))}</p>
<section class="grid">
${metricCard("Open PRs", String(snapshot.summary.openCount))}
${metricCard(`New open PRs (${snapshot.window.newPrHours}h)`, String(snapshot.summary.newOpenCount))}
${metricCard(`Recently closed (${snapshot.window.recentlyClosedDays}d)`, String(snapshot.summary.recentlyClosedCount))}
${metricCard("Avg review wait", `${snapshot.summary.avgWaitingForReviewHours}h`)}
</section>
<section><h2>Waiting for Review</h2>${
		waitingRows.length > 0
			? htmlTable(
					["PR", "Title", "Author", "Waiting", "Requested"],
					waitingRows,
				)
			: '<p class="muted">No open PRs are currently waiting for requested reviewers.</p>'
	}</section>
<section><h2>Volume Trend</h2>${htmlTable(["Date", "Opened", "Closed", "Merged"], trendRows)}</section>
<section class="grid">
<div class="panel"><h2>Leading Authors</h2><h3>This Week</h3>${topList(snapshot.leadingAuthors.week)}<h3>This Month</h3>${topList(snapshot.leadingAuthors.month)}</div>
<div class="panel"><h2>Leading Reviewers</h2><h3>This Week</h3>${topList(snapshot.leadingReviewers.week)}<h3>This Month</h3>${topList(snapshot.leadingReviewers.month)}</div>
</section>
<section><h2>Repository Breakdown</h2>${htmlTable(["Repository", "Open", "New", "Recently Closed", "Avg Open Age", "Avg Review Wait"], repoRows)}</section>
</main>
</body>
</html>
`;
}

export function formatDashboardHandoff(run: GitHubPrDashboardRun): string {
	return [
		"GitHub PR dashboard gate found changed dashboard data.",
		`Run ID: ${run.runId}`,
		`Snapshot hash: ${run.snapshotHash}`,
		`Dashboard path to update: ${run.dashboardPath}`,
		"",
		"What changed since the previous run:",
		...(run.changeSummary.length > 0
			? run.changeSummary.map((item) => `- ${item}`)
			: [
					"- Dashboard data changed, but no high-level summary fields changed.",
				]),
		"",
		"Task:",
		"1. Update the dashboard file at the exact path above with the Markdown dashboard below.",
		"2. Keep the update focused on the dashboard file only.",
		"3. Briefly summarize what changed in the PR metrics after writing the file.",
		"4. Do not edit unrelated files.",
		"",
		"# Dashboard Markdown",
		"```md",
		renderDashboardMarkdown(run.snapshot),
		"```",
		"",
		"# Raw Snapshot JSON",
		"```json",
		JSON.stringify(run.snapshot, null, 2),
		"```",
	].join("\n");
}

export function makeDashboardHandoffMessage(text: string): AgentMessage {
	const createdAt = Date.now();
	return {
		id: `msg_github_pr_dashboard_${createdAt}`,
		role: "user",
		createdAt,
		content: [{ type: "text", text }],
		metadata: { source: "github-pr-dashboard" },
	};
}
