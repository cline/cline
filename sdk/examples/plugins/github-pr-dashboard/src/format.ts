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
		'<div class="table-wrap"><table>',
		`<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
		`<tbody>${rows
			.map(
				(row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
			)
			.join("")}</tbody>`,
		"</table></div>",
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

	const repositoryPills = snapshot.repositories
		.map(
			(repository) =>
				`<span class="repo-pill">${escapeHtml(repository)}</span>`,
		)
		.join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GitHub PR Dashboard</title>
<style>
:root {
  color-scheme: dark;
  --background: #09090b;
  --foreground: #fafafa;
  --card: rgba(24, 24, 27, 0.86);
  --card-strong: rgba(39, 39, 42, 0.88);
  --muted: #a1a1aa;
  --muted-strong: #d4d4d8;
  --divider: rgba(255, 255, 255, 0.10);
  --divider-strong: rgba(255, 255, 255, 0.16);
  --purple: #c084fc;
  --purple-strong: #a855f7;
  --fuchsia: #e879f9;
  --emerald: #34d399;
  --amber: #fbbf24;
  --radius-card: 14px;
  --shadow-card: 0 18px 70px rgba(0, 0, 0, 0.38);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: normal;
  background:
    radial-gradient(circle at 18% 10%, rgba(168, 85, 247, 0.24), transparent 34rem),
    radial-gradient(circle at 88% 4%, rgba(217, 70, 239, 0.16), transparent 28rem),
    linear-gradient(180deg, #111113 0%, var(--background) 46%, #050506 100%);
  color: var(--foreground);
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, black, transparent 78%);
}
main { max-width: 1180px; margin: 0 auto; padding: 40px 24px 56px; position: relative; }
h1, h2, h3, p { margin-top: 0; }
h1 { font-size: clamp(2rem, 5vw, 4rem); line-height: 0.95; letter-spacing: -0.055em; margin: 0; }
h2 { font-size: 1rem; line-height: 1.1; letter-spacing: -0.02em; margin: 0; }
h3 { color: var(--muted-strong); font-size: 0.8rem; letter-spacing: 0.06em; margin: 18px 0 10px; text-transform: uppercase; }
a { color: #d8b4fe; font-weight: 650; text-decoration: none; }
a:hover { color: white; text-decoration: underline; text-underline-offset: 3px; }
.muted { color: var(--muted); }
.eyebrow { align-items: center; background: rgba(251, 191, 36, 0.16); border: 1px solid rgba(251, 191, 36, 0.26); border-radius: 999px; color: #fcd34d; display: inline-flex; font-size: 0.72rem; font-weight: 800; gap: 7px; letter-spacing: 0.12em; padding: 7px 10px; text-transform: uppercase; width: fit-content; }
.eyebrow::before { content: "✦"; color: var(--amber); }
.hero { background: radial-gradient(circle at 18% 18%, rgba(168,85,247,0.24), transparent 62%), linear-gradient(135deg, rgba(88,28,135,0.38), rgba(76,29,149,0.24) 56%, rgba(17,24,39,0.34)); border: 1px solid var(--divider); border-radius: 24px; box-shadow: var(--shadow-card); overflow: hidden; padding: clamp(24px, 5vw, 42px); position: relative; }
.hero::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(135deg, rgba(255,255,255,0.12), transparent 32%, rgba(255,255,255,0.04)); }
.hero-content { display: grid; gap: 26px; position: relative; z-index: 1; }
.hero-top { display: flex; flex-wrap: wrap; gap: 18px; justify-content: space-between; }
.subtitle { color: var(--muted); font-size: 1rem; line-height: 1.65; margin: 18px 0 0; max-width: 760px; }
.repo-list { display: flex; flex-wrap: wrap; gap: 8px; }
.repo-pill { background: rgba(255, 255, 255, 0.06); border: 1px solid var(--divider); border-radius: 999px; color: var(--muted-strong); font-size: 0.78rem; font-weight: 700; padding: 7px 10px; }
.timestamp { color: var(--muted); font-size: 0.82rem; margin: 0; text-align: right; }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.metric, .panel, .section-card { background: var(--card); border: 1px solid var(--divider); border-radius: var(--radius-card); box-shadow: 0 12px 42px rgba(0,0,0,0.22); }
.metric { min-height: 132px; padding: 20px; position: relative; overflow: hidden; }
.metric::after { background: linear-gradient(135deg, rgba(168,85,247,0.18), rgba(232,121,249,0.08)); border-radius: 999px; content: ""; height: 92px; position: absolute; right: -32px; top: -34px; width: 92px; }
.metric span { color: var(--muted); display: block; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.12em; margin-bottom: 14px; max-width: 150px; text-transform: uppercase; }
.metric strong { display: block; font-size: clamp(2rem, 5vw, 3.6rem); font-weight: 750; letter-spacing: -0.06em; line-height: 0.95; }
.section-card { margin-top: 18px; overflow: hidden; }
.section-header { align-items: center; border-bottom: 1px solid var(--divider); display: flex; justify-content: space-between; min-height: 68px; padding: 20px 24px 16px; }
.section-body { padding: 0; }
.panel { padding: 22px 24px; }
.panel h2 { margin-bottom: 12px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--divider); padding: 14px 16px; text-align: left; vertical-align: top; }
th { background: rgba(255,255,255,0.035); color: var(--muted); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
td { color: var(--muted-strong); font-size: 0.9rem; }
tbody tr:hover { background: rgba(255,255,255,0.035); }
tbody tr:last-child td { border-bottom: 0; }
ol { margin: 0; padding-left: 22px; }
li { color: var(--muted-strong); margin: 8px 0; }
li strong { background: rgba(168,85,247,0.16); border: 1px solid rgba(168,85,247,0.22); border-radius: 999px; color: #e9d5ff; margin-left: 8px; padding: 2px 8px; }
.panel-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 18px; }
.empty { padding: 22px 24px; }
section.dashboard-section { margin-top: 28px; }
@media (max-width: 720px) {
  main { padding: 22px 14px 36px; }
  .hero { border-radius: 18px; }
  .timestamp { text-align: left; }
  .section-header { align-items: flex-start; flex-direction: column; gap: 6px; }
  th, td { padding: 12px; }
}
</style>
</head>
<body>
<main>
<section class="hero">
<div class="hero-content">
<div class="hero-top">
<span class="eyebrow">Cline PR Intelligence</span>
<p class="timestamp">Generated ${escapeHtml(snapshot.generatedAt)}</p>
</div>
<div>
<h1>GitHub PR Dashboard</h1>
<p class="subtitle">A scheduled Cline dashboard for review load, PR velocity, and repository health. Metrics are generated by the deterministic before-run gate and styled after the Cline dashboard UI.</p>
</div>
<div class="repo-list">${repositoryPills}</div>
<div class="grid">
${metricCard("Open PRs", String(snapshot.summary.openCount))}
${metricCard(`New open PRs (${snapshot.window.newPrHours}h)`, String(snapshot.summary.newOpenCount))}
${metricCard(`Recently closed (${snapshot.window.recentlyClosedDays}d)`, String(snapshot.summary.recentlyClosedCount))}
${metricCard("Avg review wait", `${snapshot.summary.avgWaitingForReviewHours}h`)}
</div>
</div>
</section>
<section class="dashboard-section section-card"><div class="section-header"><h2>Waiting for Review</h2><span class="muted">${snapshot.waitingForReview.length} PRs</span></div><div class="section-body">${
		waitingRows.length > 0
			? htmlTable(
					["PR", "Title", "Author", "Waiting", "Requested"],
					waitingRows,
				)
			: '<p class="muted empty">No open PRs are currently waiting for requested reviewers.</p>'
	}</div></section>
<section class="dashboard-section section-card"><div class="section-header"><h2>Volume Trend</h2><span class="muted">Last ${snapshot.window.trendDays} days</span></div><div class="section-body">${htmlTable(["Date", "Opened", "Closed", "Merged"], trendRows)}</div></section>
<section class="panel-grid">
<div class="panel"><h2>Leading Authors</h2><h3>This Week</h3>${topList(snapshot.leadingAuthors.week)}<h3>This Month</h3>${topList(snapshot.leadingAuthors.month)}</div>
<div class="panel"><h2>Leading Reviewers</h2><h3>This Week</h3>${topList(snapshot.leadingReviewers.week)}<h3>This Month</h3>${topList(snapshot.leadingReviewers.month)}</div>
</section>
<section class="dashboard-section section-card"><div class="section-header"><h2>Repository Breakdown</h2><span class="muted">${snapshot.repositories.length} repositories</span></div><div class="section-body">${htmlTable(["Repository", "Open", "New", "Recently Closed", "Avg Open Age", "Avg Review Wait"], repoRows)}</div></section>
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
