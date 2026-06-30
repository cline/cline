#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { renderDashboardHtml, renderDashboardMarkdown } from "./format";
import {
	markGitHubPrDashboardSnapshotApplied,
	runGitHubPrDashboardGate,
} from "./gate";

function readFlag(name: string): string | undefined {
	const args = process.argv.slice(2);
	const prefix = `${name}=`;
	const inline = args.find((arg) => arg.startsWith(prefix));
	if (inline) return inline.slice(prefix.length).trim() || undefined;
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	return value && !value.startsWith("--")
		? value.trim() || undefined
		: undefined;
}

function applyCliOverrides(): void {
	const repositories = readFlag("--repo") ?? readFlag("--repos");
	if (repositories) process.env.GITHUB_REPOSITORIES = repositories;

	const markdownPath = readFlag("--output");
	if (markdownPath) process.env.GITHUB_PR_DASHBOARD_PATH = markdownPath;

	const htmlPath = readFlag("--html-output");
	if (htmlPath) process.env.GITHUB_PR_DASHBOARD_HTML_PATH = htmlPath;

	const statePath = readFlag("--state");
	if (statePath) process.env.GITHUB_PR_DASHBOARD_STATE_PATH = statePath;

	const maxRecent = readFlag("--max-recent");
	if (maxRecent) process.env.GITHUB_PR_DASHBOARD_MAX_PRS = maxRecent;
}

function printHelp(): void {
	console.log(`GitHub PR Dashboard preview

Fetch GitHub PR metrics and write a dashboard Markdown + HTML file without
starting an agent/model. This uses the same deterministic gate as the plugin.

Minimal usage:
  bun -F cline-github-pr-dashboard-plugin run-once -- --repo owner/repo

Recommended when GitHub rate-limits unauthenticated requests:
  GITHUB_TOKEN=$(gh auth token) bun -F cline-github-pr-dashboard-plugin run-once -- --repo owner/repo

Advanced optional env:
  GITHUB_PR_DASHBOARD_PATH=github-pr-dashboard.md
  GITHUB_PR_DASHBOARD_HTML_PATH=github-pr-dashboard.html
  GITHUB_PR_DASHBOARD_STATE_PATH=/tmp/github-pr-dashboard-state.json
  GITHUB_PR_DASHBOARD_MAX_PRS=25       # recent activity sample size, not open PR cap
  GITHUB_PR_DASHBOARD_NEW_HOURS=24
  GITHUB_PR_DASHBOARD_RECENTLY_CLOSED_DAYS=7
  GITHUB_PR_DASHBOARD_TREND_DAYS=14

Usage:
  GITHUB_TOKEN="$(gh auth token)" \
    bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline --open

  bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline

Flags:
  --repo owner/repo[,owner/repo]  Repositories to inspect. Also accepts --repos.
  --output path                  Markdown output path.
  --html-output path             HTML output path.
  --state path                   State/cache file path.
  --max-recent count             Recent activity sample size for review details.
  --open                         Open the generated HTML dashboard on macOS.
  --help                         Show this help text.
`);
}

function resolveOutputPath(path: string): string {
	return resolve(process.cwd(), path);
}

function defaultHtmlPath(markdownPath: string): string {
	const ext = extname(markdownPath);
	return ext
		? `${markdownPath.slice(0, -ext.length)}.html`
		: `${markdownPath}.html`;
}

function writeTextFile(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

async function openIfRequested(
	path: string,
	requested: boolean,
): Promise<void> {
	if (!requested) return;
	if (process.platform !== "darwin") {
		console.warn(
			"--open is only implemented for macOS; open the HTML path manually.",
		);
		return;
	}
	const child = Bun.spawn(["open", path], {
		stdout: "ignore",
		stderr: "inherit",
	});
	await child.exited;
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
	printHelp();
	process.exit(0);
}
applyCliOverrides();

if (!process.env.GITHUB_REPOSITORIES?.trim()) {
	console.error(
		"Missing repository. Pass --repo owner/repo or set GITHUB_REPOSITORIES=owner/repo[,owner/repo].",
	);
	console.error(
		'Example: GITHUB_TOKEN="$(gh auth token)" bun -F cline-github-pr-dashboard-plugin run-once -- --repo cline/cline --open',
	);
	process.exit(1);
}

const result = await runGitHubPrDashboardGate();

if (!result.snapshot || !result.dashboardPath) {
	throw new Error(
		"GitHub PR dashboard gate did not return a dashboard snapshot",
	);
}

const markdownPath = resolveOutputPath(result.dashboardPath);
const htmlPath = resolveOutputPath(
	process.env.GITHUB_PR_DASHBOARD_HTML_PATH?.trim() ||
		defaultHtmlPath(result.dashboardPath),
);

writeTextFile(markdownPath, renderDashboardMarkdown(result.snapshot));
writeTextFile(htmlPath, renderDashboardHtml(result.snapshot));
if (result.snapshotHash) {
	markGitHubPrDashboardSnapshotApplied({
		snapshotHash: result.snapshotHash,
		statePath: result.statePath,
	});
}
await openIfRequested(htmlPath, args.has("--open"));

console.log(
	JSON.stringify(
		{
			changed: result.stop !== true,
			stop: result.stop ?? false,
			reason: result.reason,
			snapshotHash: result.snapshotHash,
			markdownPath,
			htmlPath,
			summary: result.snapshot.summary,
			changes: result.changeSummary,
			warnings: result.warnings?.map((warning) => warning.message),
			next: args.has("--open")
				? undefined
				: `Open ${htmlPath} in a browser to view the dashboard.`,
		},
		null,
		2,
	),
);
