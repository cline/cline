import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { Agent, createTool } from "@cline/sdk";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3457);
const MODEL_ID = process.env.CLINE_MODEL_ID || "anthropic/claude-sonnet-4.6";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const POSTING_ENABLED =
	process.env.ENABLE_GITHUB_REVIEW_POSTING === "1" && Boolean(GITHUB_TOKEN);
const MAX_DIFF_CHARS = 60_000;
const MAX_FILE_CONTEXT_CHARS = 80_000;

const ReviewFindingInputSchema = z.object({
	file: z.string().describe("Changed file path"),
	line: z.number().int().min(1).describe("Line number in the changed file"),
	severity: z.enum(["high", "medium", "low"]).describe("Impact level"),
	category: z
		.enum(["security", "correctness", "performance", "maintainability"])
		.describe("Review category"),
	title: z.string().max(140).describe("Short finding title"),
	comment: z.string().max(1200).describe("Specific review comment"),
	suggestion: z
		.string()
		.max(1200)
		.optional()
		.describe("Optional suggested fix"),
});

const ReviewSummarySchema = z.object({
	summary: z.string().describe("Brief overall review summary"),
	approve: z.boolean().describe("Whether the PR looks safe to merge"),
});

const PostReviewRequestSchema = z.object({
	prUrl: z.string(),
	summary: ReviewSummarySchema.optional(),
	findings: z.array(ReviewFindingInputSchema),
});

type ReviewFindingInput = z.infer<typeof ReviewFindingInputSchema>;
type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

interface ReviewFinding extends ReviewFindingInput {
	id: string;
}

interface PullRequestRef {
	owner: string;
	repo: string;
	number: number;
}

interface GitHubPullRequest {
	number: number;
	title: string;
	state: string;
	html_url: string;
	draft: boolean;
	additions: number;
	deletions: number;
	changed_files: number;
	comments: number;
	review_comments: number;
	commits: number;
	user: { login: string };
	base: { ref: string };
	head: { ref: string; sha: string };
}

interface GitHubPullFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	raw_url?: string;
}

interface CheckRunsResponse {
	total_count: number;
	check_runs: Array<{ conclusion: string | null; status: string }>;
}

interface CombinedStatusResponse {
	state: string;
	total_count: number;
}

interface PullRequestBundle {
	ref: PullRequestRef;
	pr: GitHubPullRequest;
	files: GitHubPullFile[];
	diff: string;
	checks: string;
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Code Review Bot</title>
<style>
  :root {
    --bg: #05080c;
    --panel: rgba(9, 14, 21, 0.94);
    --panel-2: rgba(13, 19, 29, 0.96);
    --line: rgba(124, 178, 206, 0.17);
    --line-strong: rgba(91, 168, 255, 0.36);
    --text: #e7f1f6;
    --muted: #8796a1;
    --blue: #4ea6ff;
    --green: #67e68a;
    --amber: #f4b23a;
    --red: #ff5f77;
    --violet: #b579ff;
  }

  * { box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; margin: 0; }
  body {
    color: var(--text);
    background:
      radial-gradient(circle at 20% -10%, rgba(59, 155, 255, 0.16), transparent 34%),
      radial-gradient(circle at 85% 15%, rgba(103, 230, 138, 0.09), transparent 28%),
      linear-gradient(145deg, #030508, #071018 52%, #020407);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }
  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 40px 40px;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,0.95), transparent 92%);
  }
  button, input, select { font: inherit; }
  button { color: inherit; }

  .app {
    position: relative;
    z-index: 1;
    width: 100vw;
    height: 100vh;
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr);
    background: rgba(3, 7, 11, 0.72);
  }
  .rail {
    border-right: 1px solid var(--line);
    background: rgba(4, 9, 15, 0.9);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 18px 8px;
    gap: 10px;
  }
  .logo {
    width: 48px;
    height: 48px;
    margin: 0 auto 20px;
    border: 1px solid rgba(78, 166, 255, 0.58);
    border-radius: 11px;
    display: grid;
    place-items: center;
    color: #74c7ff;
    font-weight: 900;
    font-size: 26px;
    box-shadow: 0 0 24px rgba(78, 166, 255, 0.22);
  }
  .nav {
    min-height: 58px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    color: #9aa8b1;
    display: grid;
    place-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .nav strong {
    width: 25px;
    height: 25px;
    border: 1px solid rgba(151, 174, 188, 0.28);
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-size: 12px;
  }
  .nav span { font-size: 11px; }
  .nav.active, .nav:hover {
    background: rgba(28, 110, 203, 0.2);
    border-color: rgba(78, 166, 255, 0.36);
    color: #e8f7ff;
  }

  .shell {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 92px minmax(0, 1fr);
  }
  .topbar {
    min-width: 0;
    border-bottom: 1px solid var(--line);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 18px;
    align-items: center;
    padding: 18px 24px;
    background: rgba(5, 10, 16, 0.8);
  }
  .title-stack {
    min-width: 0;
    display: grid;
    gap: 8px;
  }
  .title-row {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .title-row h1 {
    margin: 0;
    min-width: 0;
    color: #f4fbff;
    font-size: 25px;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    flex: 0 0 auto;
    border: 1px solid rgba(103, 230, 138, 0.28);
    border-radius: 999px;
    padding: 4px 10px;
    background: rgba(103, 230, 138, 0.12);
    color: #7cf095;
    font-size: 12px;
    font-weight: 700;
  }
  .meta {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    color: #a2adb5;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
  }
  .meta span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .url-form {
    min-width: 460px;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) 116px 128px;
    gap: 10px;
  }
  .url-form input {
    min-width: 0;
    border: 1px solid rgba(131, 174, 201, 0.24);
    border-radius: 8px;
    background: rgba(1, 5, 9, 0.84);
    color: #eaf7ff;
    padding: 12px 13px;
    outline: none;
  }
  .url-form input:focus {
    border-color: rgba(78, 166, 255, 0.76);
    box-shadow: 0 0 0 3px rgba(78, 166, 255, 0.12);
  }
  .btn {
    border: 1px solid rgba(132, 176, 203, 0.24);
    border-radius: 8px;
    background: rgba(16, 26, 38, 0.9);
    color: #dcecf4;
    cursor: pointer;
    font-weight: 700;
  }
  .btn.primary {
    border-color: rgba(78, 166, 255, 0.56);
    background: linear-gradient(180deg, #0d7dff, #075fe4);
    color: white;
    box-shadow: 0 0 24px rgba(13, 125, 255, 0.2);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .workspace {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(520px, 45%) minmax(580px, 55%);
    overflow: hidden;
  }
  .left, .right {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .left {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    border-right: 1px solid var(--line);
  }
  .files {
    min-width: 0;
    border-right: 1px solid var(--line);
    padding: 18px 10px;
    overflow: auto;
  }
  .tabs {
    display: flex;
    gap: 22px;
    padding: 0 4px 14px;
    border-bottom: 1px solid rgba(130, 171, 198, 0.12);
    margin-bottom: 14px;
    color: #aab5bd;
    font-size: 13px;
  }
  .tabs strong {
    color: #f3fbff;
    position: relative;
  }
  .tabs strong::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -15px;
    height: 2px;
    background: var(--blue);
  }
  .filter {
    width: 100%;
    border: 1px solid rgba(131, 174, 201, 0.2);
    border-radius: 7px;
    background: rgba(1, 5, 9, 0.66);
    color: #c9d7df;
    padding: 10px 11px;
    outline: none;
    margin-bottom: 14px;
  }
  .file-list {
    display: grid;
    gap: 5px;
  }
  .file-item {
    width: 100%;
    min-width: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: #c5d2da;
    cursor: pointer;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 9px 8px;
    text-align: left;
  }
  .file-item:hover, .file-item.active {
    background: rgba(78, 166, 255, 0.14);
    border-color: rgba(78, 166, 255, 0.22);
  }
  .file-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
  .file-stats {
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
  .plus { color: var(--green); }
  .minus { color: var(--red); }

  .diff-pane {
    min-width: 0;
    min-height: 0;
    padding: 18px 14px;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .diff-header {
    min-width: 0;
    border: 1px solid var(--line);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    background: rgba(8, 13, 20, 0.82);
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: #b9c7cf;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }
  .diff-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff-code {
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--line);
    border-radius: 0 0 8px 8px;
    overflow: auto;
    background: rgba(2, 6, 10, 0.72);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.48;
  }
  .diff-line {
    min-width: max-content;
    display: grid;
    grid-template-columns: 54px minmax(760px, 1fr);
    border-bottom: 1px solid rgba(255,255,255,0.018);
  }
  .line-no {
    color: #667680;
    text-align: right;
    padding: 2px 12px 2px 6px;
    user-select: none;
    border-right: 1px solid rgba(132, 176, 203, 0.08);
  }
  .line-code { white-space: pre; padding: 2px 12px; color: #bbc9d1; }
  .diff-line.add { background: rgba(39, 174, 96, 0.15); }
  .diff-line.del { background: rgba(255, 75, 100, 0.16); }
  .diff-line.hunk { background: rgba(78, 166, 255, 0.11); color: #84c7ff; }
  .diff-line.add .line-code { color: #c7f8d3; }
  .diff-line.del .line-code { color: #ffc1ca; }

  .right {
    padding: 18px 16px;
    overflow: auto;
  }
  .review-card {
    min-width: 0;
    min-height: calc(100vh - 128px);
    border: 1px solid var(--line);
    border-radius: 11px;
    background: linear-gradient(180deg, rgba(12, 18, 28, 0.96), rgba(6, 10, 16, 0.98));
    box-shadow: 0 0 0 1px rgba(255,255,255,0.018) inset, 0 24px 80px rgba(0,0,0,0.32);
    padding: 14px;
    display: grid;
    grid-template-rows: auto auto auto auto minmax(220px, 1fr) auto;
    gap: 12px;
  }
  .review-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 2px 8px;
  }
  .bot-title {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #f0fbff;
    font-size: 18px;
    font-weight: 800;
  }
  .bot-mark {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(78, 166, 255, 0.14);
    border: 1px solid rgba(78, 166, 255, 0.34);
    color: #a5d6ff;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
  .model {
    color: #9facb6;
    font-size: 13px;
  }
  .run-box {
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(6, 10, 16, 0.72);
    padding: 14px;
  }
  .run-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .run-title {
    display: grid;
    gap: 4px;
  }
  .run-title strong { font-size: 22px; color: #f4fbff; }
  .run-title span { color: #9eabb4; font-size: 13px; }
  .confidence {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #aab7c0;
    font-size: 13px;
  }
  .ring {
    --score: 18%;
    width: 66px;
    height: 66px;
    border-radius: 999px;
    background:
      radial-gradient(circle at center, #071019 58%, transparent 59%),
      conic-gradient(var(--green) var(--score), rgba(78, 166, 255, 0.13) 0);
    display: grid;
    place-items: center;
    color: #a7ffc0;
    font-weight: 900;
    font-size: 18px;
  }
  .lanes {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .lane {
    border: 1px solid rgba(132, 176, 203, 0.15);
    border-radius: 8px;
    background: rgba(11, 18, 27, 0.78);
    padding: 11px;
  }
  .lane.security { background: linear-gradient(180deg, rgba(78, 166, 255, 0.12), rgba(11, 18, 27, 0.78)); }
  .lane.tests { background: linear-gradient(180deg, rgba(244, 178, 58, 0.12), rgba(11, 18, 27, 0.78)); }
  .lane.writer { background: linear-gradient(180deg, rgba(181, 121, 255, 0.12), rgba(11, 18, 27, 0.78)); }
  .lane-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-weight: 800;
    font-size: 13px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: var(--green);
    box-shadow: 0 0 13px rgba(103, 230, 138, 0.48);
  }
  .lane.security .dot { background: var(--blue); }
  .lane.tests .dot { background: var(--amber); }
  .lane.writer .dot { background: var(--violet); }
  .lane-status { color: #9eabb4; font-size: 12px; margin-bottom: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 5px; border-radius: 999px; background: rgba(255,255,255,0.09); overflow: hidden; }
  .bar span { display: block; width: 0%; height: 100%; background: var(--green); transition: width 240ms ease; }
  .lane.security .bar span { background: var(--blue); }
  .lane.tests .bar span { background: var(--amber); }
  .lane.writer .bar span { background: var(--violet); }
  .lane-percent { margin-top: 6px; text-align: right; color: #d6e3ea; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .summary-card {
    border: 1px solid rgba(132, 176, 203, 0.15);
    border-radius: 8px;
    padding: 12px;
    background: rgba(9, 15, 23, 0.76);
  }
  .summary-card strong {
    display: block;
    color: #eaf5fa;
    font-size: 26px;
    margin-top: 8px;
  }
  .summary-card span {
    color: #a6b3bd;
    font-size: 12px;
  }
  .summary-card.security { border-color: rgba(255, 95, 119, 0.22); }
  .summary-card.correctness { border-color: rgba(78, 166, 255, 0.22); }
  .summary-card.performance { border-color: rgba(103, 230, 138, 0.22); }
  .summary-card.maintainability { border-color: rgba(181, 121, 255, 0.22); }

  .findings {
    min-height: 0;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(3, 7, 12, 0.52);
    overflow: hidden;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .findings-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(132, 176, 203, 0.12);
  }
  .findings-head strong { font-size: 18px; }
  .findings-head span { color: #9cabb5; font-size: 12px; }
  .finding-list {
    min-height: 0;
    overflow: auto;
    padding: 10px;
    display: grid;
    align-content: start;
    gap: 8px;
  }
  .empty {
    color: #7d8b95;
    border: 1px dashed rgba(132, 176, 203, 0.18);
    border-radius: 8px;
    padding: 18px;
    text-align: center;
  }
  .finding {
    border: 1px solid rgba(132, 176, 203, 0.14);
    border-radius: 8px;
    background: rgba(12, 18, 27, 0.82);
    padding: 11px 12px;
    display: grid;
    gap: 8px;
  }
  .finding-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .severity {
    border-radius: 6px;
    padding: 3px 7px;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .severity.high { background: rgba(255, 95, 119, 0.16); color: #ff9bad; border: 1px solid rgba(255, 95, 119, 0.28); }
  .severity.medium { background: rgba(244, 178, 58, 0.16); color: #ffd37a; border: 1px solid rgba(244, 178, 58, 0.28); }
  .severity.low { background: rgba(103, 230, 138, 0.12); color: #9df5b2; border: 1px solid rgba(103, 230, 138, 0.25); }
  .category {
    color: #a7b5be;
    font-size: 12px;
    text-transform: capitalize;
  }
  .finding-title {
    min-width: 0;
    color: #f0f7fb;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .location {
    margin-left: auto;
    color: #7fc3ff;
    background: rgba(78, 166, 255, 0.12);
    border-radius: 5px;
    padding: 3px 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
  }
  .finding p {
    margin: 0;
    color: #b9c7cf;
    font-size: 13px;
    line-height: 1.45;
  }
  .suggestion {
    border-left: 2px solid rgba(78, 166, 255, 0.54);
    padding-left: 9px;
    color: #9ed1ff;
    font-size: 12px;
  }
  .final {
    display: grid;
    gap: 8px;
    color: #b7c5cd;
    font-size: 13px;
    line-height: 1.45;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .toast {
    color: #88f29e;
    font-size: 13px;
  }
  .post {
    min-width: 220px;
    min-height: 48px;
    border: 1px solid rgba(78, 166, 255, 0.6);
    border-radius: 8px;
    background: linear-gradient(180deg, #1684ff, #075fe4);
    color: white;
    font-size: 16px;
    font-weight: 900;
    cursor: pointer;
  }
  .post:disabled { opacity: 0.5; cursor: not-allowed; }

  @media (max-width: 1180px) {
    body { overflow: auto; }
    .app { min-height: 100vh; height: auto; grid-template-columns: 1fr; }
    .rail { display: none; }
    .shell { height: auto; grid-template-rows: auto auto; }
    .topbar { grid-template-columns: 1fr; }
    .url-form { min-width: 0; grid-template-columns: 1fr; }
    .workspace { grid-template-columns: 1fr; overflow: visible; }
    .left { min-height: 620px; }
    .right { overflow: visible; }
    .review-card { min-height: 720px; }
  }
</style>
</head>
<body>
<main class="app">
  <aside class="rail" aria-label="Navigation">
    <div class="logo">C</div>
    <button class="nav" type="button"><strong>O</strong><span>Overview</span></button>
    <button class="nav active" type="button"><strong>R</strong><span>Review</span></button>
    <button class="nav" type="button"><strong>C</strong><span>Commits</span></button>
    <button class="nav" type="button"><strong>K</strong><span>Checks</span></button>
    <button class="nav" type="button"><strong>F</strong><span>Files</span></button>
  </aside>
  <section class="shell">
    <header class="topbar">
      <div class="title-stack">
        <div class="title-row">
          <h1 id="pr-title">Real Pull Request Review</h1>
          <span id="pr-state" class="pill">Ready</span>
        </div>
        <div class="meta">
          <span id="branch-meta">Paste a GitHub pull request URL to inspect real files and run the review bot.</span>
          <span id="comments-meta"></span>
          <span id="checks-meta"></span>
        </div>
      </div>
      <form id="url-form" class="url-form">
        <input id="pr-url" type="url" placeholder="https://github.com/owner/repo/pull/123" autocomplete="off" />
        <button id="load" class="btn" type="button">Load PR</button>
        <button id="review" class="btn primary" type="submit">Run Review</button>
      </form>
    </header>
    <div class="workspace">
      <section class="left" aria-label="Pull request files">
        <aside class="files">
          <div class="tabs"><strong>Files Changed <span id="file-count">0</span></strong><span>Conversation <span id="conversation-count">0</span></span></div>
          <input id="filter" class="filter" placeholder="Filter files..." />
          <div id="file-list" class="file-list">
            <div class="empty">Load a real GitHub PR to see changed files.</div>
          </div>
        </aside>
        <section class="diff-pane">
          <div class="diff-header">
            <span id="diff-title" class="diff-title">No file selected</span>
            <span id="diff-stats"></span>
          </div>
          <div id="diff-code" class="diff-code">
            <div class="empty">The selected PR file patch will render here.</div>
          </div>
        </section>
      </section>
      <section class="right" aria-label="AI review">
        <article class="review-card">
          <div class="review-head">
            <div class="bot-title"><span class="bot-mark">AI</span><span>AI Review Bot</span><span class="pill">Real PR</span></div>
            <div id="model" class="model">Model: loading...</div>
          </div>
          <section class="run-box">
            <div class="run-top">
              <div class="run-title">
                <strong id="run-title">AI Review Ready</strong>
                <span id="run-subtitle">Fetch a PR, then stream findings from the SDK reviewer.</span>
              </div>
              <div class="confidence">
                <span>Overall Confidence</span>
                <div id="ring" class="ring">0%</div>
              </div>
            </div>
            <div class="lanes">
              <div class="lane" data-lane="diff">
                <div class="lane-title"><span class="dot"></span><span>Diff Parser</span></div>
                <div class="lane-status">Waiting for PR</div>
                <div class="bar"><span></span></div>
                <div class="lane-percent">0%</div>
              </div>
              <div class="lane security" data-lane="security">
                <div class="lane-title"><span class="dot"></span><span>Security Reviewer</span></div>
                <div class="lane-status">Queued</div>
                <div class="bar"><span></span></div>
                <div class="lane-percent">0%</div>
              </div>
              <div class="lane tests" data-lane="tests">
                <div class="lane-title"><span class="dot"></span><span>Test Analyst</span></div>
                <div class="lane-status">Queued</div>
                <div class="bar"><span></span></div>
                <div class="lane-percent">0%</div>
              </div>
              <div class="lane writer" data-lane="writer">
                <div class="lane-title"><span class="dot"></span><span>Comment Writer</span></div>
                <div class="lane-status">Queued</div>
                <div class="bar"><span></span></div>
                <div class="lane-percent">0%</div>
              </div>
            </div>
          </section>
          <div class="summary-grid">
            <div class="summary-card security"><span>Security</span><strong id="count-security">0</strong><span>Findings</span></div>
            <div class="summary-card correctness"><span>Correctness</span><strong id="count-correctness">0</strong><span>Issues</span></div>
            <div class="summary-card performance"><span>Performance</span><strong id="count-performance">0</strong><span>Improvements</span></div>
            <div class="summary-card maintainability"><span>Maintainability</span><strong id="count-maintainability">0</strong><span>Suggestions</span></div>
          </div>
          <section class="findings">
            <div class="findings-head"><strong>Review Findings</strong><span id="finding-count">0 findings</span></div>
            <div id="finding-list" class="finding-list"><div class="empty">Findings will stream here as the agent reviews the real PR diff.</div></div>
          </section>
          <section id="final" class="final"></section>
          <div class="actions">
            <span id="toast" class="toast"></span>
            <button id="post" class="post" type="button" disabled>Copy Review</button>
          </div>
        </article>
      </section>
    </div>
  </section>
</main>
<script>
const state = {
  pr: null,
  files: [],
  selectedFile: null,
  findings: [],
  summary: null,
  postingEnabled: false,
  eventSource: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function shortModel(modelId) {
  return modelId.replace('anthropic/', '').replace(/-/g, ' ');
}

async function init() {
  const config = await fetch('/api/config').then((response) => response.json());
  state.postingEnabled = config.postingEnabled;
  $('model').textContent = 'Model: ' + shortModel(config.modelId);
  $('post').textContent = state.postingEnabled ? 'Post Review' : 'Copy Review';
  const params = new URLSearchParams(window.location.search);
  const prUrl = params.get('pr');
  if (prUrl) {
    $('pr-url').value = prUrl;
    if (params.get('review') === '1') {
      setTimeout(startReview, 100);
    } else {
      loadPr().catch((error) => setStatus('Load Failed', error.message));
    }
  }
}

function setStatus(title, subtitle) {
  $('run-title').textContent = title;
  $('run-subtitle').textContent = subtitle;
}

function setLane(name, progress, status) {
  const lane = document.querySelector('[data-lane="' + name + '"]');
  if (!lane) return;
  lane.querySelector('.lane-status').textContent = status;
  lane.querySelector('.bar span').style.width = progress + '%';
  lane.querySelector('.lane-percent').textContent = progress + '%';
}

function setConfidence(score) {
  $('ring').style.setProperty('--score', score + '%');
  $('ring').textContent = score + '%';
}

function resetReview() {
  state.findings = [];
  state.summary = null;
  $('finding-list').innerHTML = '<div class="empty">Findings will stream here as the agent reviews the real PR diff.</div>';
  $('final').innerHTML = '';
  $('finding-count').textContent = '0 findings';
  ['security', 'correctness', 'performance', 'maintainability'].forEach((category) => {
    $('count-' + category).textContent = '0';
  });
  setConfidence(0);
  setLane('diff', 0, 'Waiting for PR');
  setLane('security', 0, 'Queued');
  setLane('tests', 0, 'Queued');
  setLane('writer', 0, 'Queued');
  $('post').disabled = true;
  $('toast').textContent = '';
}

function renderPr(pr) {
  state.pr = pr;
  state.files = pr.files || [];
  $('pr-title').textContent = 'Pull Request #' + pr.number + ' - ' + pr.title;
  $('pr-state').textContent = pr.state;
  $('branch-meta').textContent = pr.owner + '/' + pr.repo + '  ' + pr.headRef + ' -> ' + pr.baseRef;
  $('comments-meta').textContent = (pr.comments + pr.reviewComments) + ' comments';
  $('checks-meta').textContent = 'Checks ' + pr.checks;
  $('file-count').textContent = pr.files.length;
  $('conversation-count').textContent = pr.comments + pr.reviewComments;
  renderFiles();
  if (state.files.length > 0) selectFile(state.files[0].filename);
}

function renderFiles() {
  const query = $('filter').value.toLowerCase();
  const files = state.files.filter((file) => file.filename.toLowerCase().includes(query));
  if (files.length === 0) {
    $('file-list').innerHTML = '<div class="empty">No files match.</div>';
    return;
  }
  $('file-list').innerHTML = files.map((file) => {
    const active = state.selectedFile && state.selectedFile.filename === file.filename ? ' active' : '';
    return '<button class="file-item' + active + '" type="button" data-file="' + escapeHtml(file.filename) + '">' +
      '<span class="file-path">' + escapeHtml(file.filename) + '</span>' +
      '<span class="file-stats"><span class="plus">+' + file.additions + '</span> <span class="minus">-' + file.deletions + '</span></span>' +
    '</button>';
  }).join('');
}

function selectFile(filename) {
  const file = state.files.find((item) => item.filename === filename);
  if (!file) return;
  state.selectedFile = file;
  $('diff-title').textContent = file.filename;
  $('diff-stats').innerHTML = '<span class="plus">+' + file.additions + '</span> <span class="minus">-' + file.deletions + '</span>';
  renderFiles();
  renderPatch(file);
}

function renderPatch(file) {
  const patch = file.patch || 'No textual patch available for this file.';
  const lines = patch.split('\\n');
  $('diff-code').innerHTML = lines.map((line, index) => {
    const cls = line.startsWith('+') ? ' add' : line.startsWith('-') ? ' del' : line.startsWith('@@') ? ' hunk' : '';
    return '<div class="diff-line' + cls + '">' +
      '<span class="line-no">' + (index + 1) + '</span>' +
      '<code class="line-code">' + escapeHtml(line) + '</code>' +
    '</div>';
  }).join('');
}

async function loadPr() {
  const prUrl = $('pr-url').value.trim();
  if (!prUrl) {
    setStatus('Paste a PR URL', 'Use a GitHub pull request URL like https://github.com/owner/repo/pull/123.');
    return;
  }
  setStatus('Loading real PR', 'Fetching metadata and changed files from GitHub...');
  setLane('diff', 35, 'Fetching PR');
  const response = await fetch('/api/pr?url=' + encodeURIComponent(prUrl));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Failed to load PR');
  renderPr(payload.pr);
  setStatus('PR Loaded', 'Ready to run AI review against the real pull request diff.');
  setLane('diff', 100, 'Parsed ' + payload.pr.files.length + ' files');
  setConfidence(18);
}

function startReview() {
  const prUrl = $('pr-url').value.trim();
  if (!prUrl) {
    setStatus('Paste a PR URL', 'Use a GitHub pull request URL before running review.');
    return;
  }
  if (state.eventSource) state.eventSource.close();
  resetReview();
  $('review').disabled = true;
  $('load').disabled = true;
  $('pr-url').disabled = true;
  setStatus('AI Review Running', 'Analyzing real PR changes and generating review...');
  setLane('diff', 20, 'Fetching diff');
  state.eventSource = new EventSource('/api/review?url=' + encodeURIComponent(prUrl));
  state.eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleReviewEvent(data);
  };
  state.eventSource.onerror = () => {
    stopReviewControls();
    setStatus('Review Stream Closed', 'The stream ended or the server returned an error.');
  };
}

function stopReviewControls() {
  $('review').disabled = false;
  $('load').disabled = false;
  $('pr-url').disabled = false;
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function handleReviewEvent(data) {
  if (data.type === 'pr') {
    renderPr(data.pr);
    setLane('diff', 100, 'Parsed real diff');
    setLane('security', 38, 'Scanning vulnerabilities');
    setLane('tests', 28, 'Reviewing test coverage');
    setLane('writer', 18, 'Waiting for findings');
    setConfidence(28);
  }
  if (data.type === 'stage') {
    setLane(data.lane, data.progress, data.status);
  }
  if (data.type === 'activity') {
    setStatus('AI Review Running', data.message);
  }
  if (data.type === 'finding') {
    addFinding(data.finding);
  }
  if (data.type === 'summary') {
    state.summary = data.summary;
    renderSummary();
  }
  if (data.type === 'done') {
    setLane('security', 100, 'Complete');
    setLane('tests', 100, 'Complete');
    setLane('writer', 100, 'Review drafted');
    setConfidence(data.findings.length > 0 ? 82 : 91);
    setStatus('Review Complete', data.summary && data.summary.approve ? 'No blocking findings. Draft is ready.' : 'Findings drafted for this PR.');
    $('post').disabled = false;
    stopReviewControls();
  }
  if (data.type === 'error') {
    setStatus('Review Failed', data.message);
    stopReviewControls();
  }
}

function addFinding(finding) {
  state.findings.push(finding);
  if (state.findings.length === 1) $('finding-list').innerHTML = '';
  $('finding-list').insertAdjacentHTML('beforeend', renderFinding(finding));
  updateCounts();
  const security = Math.min(100, 45 + count('security') * 18);
  const tests = Math.min(100, 36 + (count('correctness') + count('performance')) * 14);
  const writer = Math.min(90, 25 + state.findings.length * 11);
  setLane('security', security, 'Scanning vulnerabilities');
  setLane('tests', tests, 'Reviewing impact');
  setLane('writer', writer, 'Drafting comments');
  setConfidence(Math.min(84, 38 + state.findings.length * 7));
}

function renderFinding(finding) {
  const suggestion = finding.suggestion ? '<div class="suggestion">' + escapeHtml(finding.suggestion) + '</div>' : '';
  return '<article class="finding">' +
    '<div class="finding-top">' +
      '<span class="severity ' + finding.severity + '">' + finding.severity + '</span>' +
      '<span class="category">' + escapeHtml(finding.category) + '</span>' +
      '<span class="finding-title">' + escapeHtml(finding.title) + '</span>' +
      '<span class="location">' + escapeHtml(finding.file) + ':' + finding.line + '</span>' +
    '</div>' +
    '<p>' + escapeHtml(finding.comment) + '</p>' +
    suggestion +
  '</article>';
}

function count(category) {
  return state.findings.filter((finding) => finding.category === category).length;
}

function updateCounts() {
  ['security', 'correctness', 'performance', 'maintainability'].forEach((category) => {
    $('count-' + category).textContent = count(category);
  });
  $('finding-count').textContent = state.findings.length + (state.findings.length === 1 ? ' finding' : ' findings');
}

function renderSummary() {
  if (!state.summary) return;
  $('final').innerHTML =
    '<strong>Decision</strong>' +
    '<span>' + escapeHtml(state.summary.summary) + '</span>' +
    '<span>Status: ' + (state.summary.approve ? 'Looks safe to merge after review.' : 'Needs changes before merge.') + '</span>';
}

function reviewMarkdown() {
  const lines = [];
  lines.push('AI Review Bot');
  lines.push('');
  if (state.summary) {
    lines.push(state.summary.summary);
    lines.push('');
  }
  for (const finding of state.findings) {
    lines.push('- [' + finding.severity.toUpperCase() + '] ' + finding.category + ' - ' + finding.file + ':' + finding.line);
    lines.push('  ' + finding.title + ': ' + finding.comment);
    if (finding.suggestion) lines.push('  Suggestion: ' + finding.suggestion);
  }
  if (state.findings.length === 0) lines.push('No actionable findings.');
  return lines.join('\\n');
}

async function postOrCopyReview() {
  $('toast').textContent = '';
  if (!state.postingEnabled) {
    await navigator.clipboard.writeText(reviewMarkdown());
    $('toast').textContent = 'Review copied to clipboard.';
    return;
  }
  const response = await fetch('/api/post-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prUrl: $('pr-url').value.trim(),
      summary: state.summary,
      findings: state.findings,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    $('toast').textContent = payload.error || 'Failed to post review.';
    return;
  }
  $('toast').innerHTML = 'Posted review: <a href="' + escapeHtml(payload.url) + '" target="_blank" rel="noreferrer">open comment</a>';
}

$('url-form').addEventListener('submit', (event) => {
  event.preventDefault();
  startReview();
});
$('load').addEventListener('click', () => {
  loadPr().catch((error) => setStatus('Load Failed', error.message));
});
$('filter').addEventListener('input', renderFiles);
$('file-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-file]');
  if (button) selectFile(button.getAttribute('data-file'));
});
$('post').addEventListener('click', () => {
  postOrCopyReview().catch((error) => {
    $('toast').textContent = error.message;
  });
});

init().catch((error) => setStatus('Config Failed', error.message));
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

		if (req.method === "GET" && url.pathname === "/") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(HTML);
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/config") {
			sendJson(res, 200, {
				modelId: MODEL_ID,
				postingEnabled: POSTING_ENABLED,
			});
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/pr") {
			const prUrl = requiredSearchParam(url, "url");
			const bundle = await loadPullRequest(prUrl);
			sendJson(res, 200, { pr: serializePullRequest(bundle) });
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/review") {
			await handleReview(url, res);
			return;
		}

		if (req.method === "POST" && url.pathname === "/api/post-review") {
			await handlePostReview(req, res);
			return;
		}

		sendJson(res, 404, { error: "Not found" });
	} catch (error) {
		const status = error instanceof HttpError ? error.status : 500;
		const message = error instanceof Error ? error.message : "Unknown error";
		sendJson(res, status, { error: message });
	}
});

async function handleReview(url: URL, res: ServerResponse) {
	const prUrl = requiredSearchParam(url, "url");
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const send = (data: Record<string, unknown>) => {
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	try {
		send({ type: "stage", lane: "diff", progress: 25, status: "Fetching PR" });
		const bundle = await loadPullRequest(prUrl);
		send({ type: "pr", pr: serializePullRequest(bundle) });
		send({
			type: "stage",
			lane: "diff",
			progress: 100,
			status: `Parsed ${bundle.files.length} files`,
		});

		const result = await runAiReview(bundle, send);
		send({
			type: "done",
			findings: result.findings,
			summary: result.summary,
			usage: result.usage,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		send({ type: "error", message });
	} finally {
		res.end();
	}
}

async function runAiReview(
	bundle: PullRequestBundle,
	send: (data: Record<string, unknown>) => void,
) {
	const findings: ReviewFinding[] = [];
	let summary: ReviewSummary | undefined;

	const agent = new Agent({
		providerId: "cline",
		modelId: MODEL_ID,
		apiKey: process.env.CLINE_API_KEY,
		systemPrompt: `You are a senior code reviewer reviewing real GitHub pull requests.

Use get_file_context when a hunk needs surrounding file context.
Use add_review_finding only for actionable findings grounded in the diff.
Severity rules:
- high: security, data loss, broken auth, broken correctness, or likely production incident
- medium: real bug risk, missing validation, test gap, or meaningful maintainability issue
- low: small improvement that still helps the author

Prefer 2-5 findings. If the PR is clean, add no findings and submit an approving summary.
When finished, call submit_review exactly once.`,
		maxIterations: 12,
		tools: [
			createTool({
				name: "get_file_context",
				description:
					"Read the full file contents from the pull request head commit for more context.",
				inputSchema: z.object({
					path: z.string().describe("Path relative to the repository root"),
				}),
				async execute(input) {
					send({
						type: "activity",
						message: `Reading context for ${input.path}`,
					});
					return fetchFileContext(bundle, input.path);
				},
			}),
			createTool({
				name: "add_review_finding",
				description: "Add a structured review finding for this pull request.",
				inputSchema: ReviewFindingInputSchema,
				async execute(input) {
					const finding = {
						id: `F-${String(findings.length + 1).padStart(2, "0")}`,
						...input,
					};
					findings.push(finding);
					send({ type: "finding", finding });
					return `Finding ${finding.id} added`;
				},
			}),
			createTool({
				name: "submit_review",
				description: "Submit the completed pull request review.",
				inputSchema: ReviewSummarySchema,
				lifecycle: { completesRun: true },
				async execute(input) {
					summary = input;
					send({ type: "summary", summary });
					return JSON.stringify({
						approve: input.approve,
						findingCount: findings.length,
					});
				},
			}),
		],
	});

	agent.subscribe((event) => {
		if (event.type === "assistant-text-delta") {
			send({ type: "activity", message: "Reviewing diff with AI reviewer..." });
		}
		if (event.type === "tool-started") {
			send({
				type: "stage",
				lane: "writer",
				progress: Math.min(92, 30 + findings.length * 10),
				status: `Calling ${event.toolCall.toolName}`,
			});
		}
	});

	send({
		type: "stage",
		lane: "security",
		progress: 44,
		status: "Scanning vulnerabilities",
	});
	send({
		type: "stage",
		lane: "tests",
		progress: 36,
		status: "Reviewing tests",
	});
	send({
		type: "stage",
		lane: "writer",
		progress: 22,
		status: "Drafting findings",
	});

	const diff = truncateText(bundle.diff, MAX_DIFF_CHARS);
	const fileSummary = bundle.files
		.map(
			(file) =>
				`- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
		)
		.join("\n");

	const result = await agent.run(`Review this real GitHub pull request.

Repository: ${bundle.ref.owner}/${bundle.ref.repo}
Pull Request: #${bundle.pr.number} ${bundle.pr.title}
Author: ${bundle.pr.user.login}
Branch: ${bundle.pr.head.ref} -> ${bundle.pr.base.ref}
URL: ${bundle.pr.html_url}
Files:
${fileSummary}

Diff:
\`\`\`diff
${diff}
\`\`\`
`);

	return {
		findings,
		summary,
		usage: result.usage,
	};
}

async function handlePostReview(req: IncomingMessage, res: ServerResponse) {
	if (!POSTING_ENABLED) {
		throw new HttpError(
			403,
			"Posting is disabled. Set ENABLE_GITHUB_REVIEW_POSTING=1 and GITHUB_TOKEN to enable it.",
		);
	}

	const input = PostReviewRequestSchema.parse(await readJson(req));
	const ref = parsePullRequestUrl(input.prUrl);
	const body = formatReviewComment(input.summary, input.findings);
	const posted = await githubJson<{ html_url: string }>(
		`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ body }),
		},
	);

	sendJson(res, 200, { url: posted.html_url });
}

async function loadPullRequest(prUrl: string): Promise<PullRequestBundle> {
	const ref = parsePullRequestUrl(prUrl);
	const pr = await githubJson<GitHubPullRequest>(
		`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
	);
	const [files, diff, checks] = await Promise.all([
		githubPaged<GitHubPullFile>(
			`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`,
		),
		githubText(
			`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
			{
				headers: { Accept: "application/vnd.github.v3.diff" },
			},
		),
		loadChecks(ref, pr.head.sha),
	]);

	return { ref, pr, files, diff, checks };
}

async function loadChecks(ref: PullRequestRef, sha: string) {
	try {
		const [status, checks] = await Promise.all([
			githubJson<CombinedStatusResponse>(
				`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}/status`,
			),
			githubJson<CheckRunsResponse>(
				`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs`,
			),
		]);
		const failedChecks = checks.check_runs.filter((run) =>
			["failure", "timed_out", "cancelled"].includes(run.conclusion ?? ""),
		);
		const pendingChecks = checks.check_runs.filter(
			(run) => run.status !== "completed",
		);
		if (failedChecks.length > 0 || status.state === "failure") return "failing";
		if (pendingChecks.length > 0 || status.state === "pending")
			return "pending";
		if (checks.total_count > 0 || status.total_count > 0) return "passing";
		return "unknown";
	} catch {
		return "unknown";
	}
}

async function fetchFileContext(bundle: PullRequestBundle, filePath: string) {
	if (filePath.startsWith("/") || filePath.includes("..")) {
		return `Error: invalid file path ${filePath}`;
	}

	const encodedPath = filePath
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
	const response = await githubFetch(
		`https://api.github.com/repos/${bundle.ref.owner}/${bundle.ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(bundle.pr.head.sha)}`,
		{ headers: { Accept: "application/vnd.github.raw" } },
	);
	const text = await response.text();
	return truncateText(text, MAX_FILE_CONTEXT_CHARS);
}

function serializePullRequest(bundle: PullRequestBundle) {
	return {
		owner: bundle.ref.owner,
		repo: bundle.ref.repo,
		number: bundle.pr.number,
		title: bundle.pr.title,
		state: bundle.pr.draft ? "draft" : bundle.pr.state,
		url: bundle.pr.html_url,
		author: bundle.pr.user.login,
		baseRef: bundle.pr.base.ref,
		headRef: bundle.pr.head.ref,
		headSha: bundle.pr.head.sha,
		additions: bundle.pr.additions,
		deletions: bundle.pr.deletions,
		changedFiles: bundle.pr.changed_files,
		comments: bundle.pr.comments,
		reviewComments: bundle.pr.review_comments,
		commits: bundle.pr.commits,
		checks: bundle.checks,
		files: bundle.files.map((file) => ({
			filename: file.filename,
			status: file.status,
			additions: file.additions,
			deletions: file.deletions,
			changes: file.changes,
			patch: file.patch ?? "",
		})),
	};
}

function parsePullRequestUrl(input: string): PullRequestRef {
	const trimmed = input.trim();
	const urlMatch = trimmed.match(
		/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/,
	);
	const shortMatch = trimmed.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
	const match = urlMatch ?? shortMatch;

	if (!match) {
		throw new HttpError(
			400,
			"Expected a GitHub PR URL like https://github.com/owner/repo/pull/123",
		);
	}

	return {
		owner: match[1],
		repo: match[2].replace(/\.git$/, ""),
		number: Number(match[3]),
	};
}

async function githubPaged<T>(baseUrl: string): Promise<T[]> {
	const results: T[] = [];
	for (let page = 1; page <= 5; page++) {
		const separator = baseUrl.includes("?") ? "&" : "?";
		const pageResults = await githubJson<T[]>(
			`${baseUrl}${separator}per_page=100&page=${page}`,
		);
		results.push(...pageResults);
		if (pageResults.length < 100) break;
	}
	return results;
}

async function githubJson<T>(url: string, init: RequestInit = {}): Promise<T> {
	const response = await githubFetch(url, init);
	return (await response.json()) as T;
}

async function githubText(url: string, init: RequestInit = {}) {
	const response = await githubFetch(url, init);
	return response.text();
}

async function githubFetch(url: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	if (!headers.has("Accept"))
		headers.set("Accept", "application/vnd.github+json");
	headers.set("User-Agent", "cline-sdk-code-review-bot-example");
	headers.set("X-GitHub-Api-Version", "2022-11-28");
	if (GITHUB_TOKEN) headers.set("Authorization", `Bearer ${GITHUB_TOKEN}`);

	const response = await fetch(url, { ...init, headers });
	if (!response.ok) {
		const body = await response.text();
		throw new HttpError(
			response.status,
			`GitHub request failed (${response.status}): ${body.slice(0, 300)}`,
		);
	}
	return response;
}

function requiredSearchParam(url: URL, key: string) {
	const value = url.searchParams.get(key);
	if (!value) throw new HttpError(400, `Missing query parameter: ${key}`);
	return value;
}

async function readJson(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8");
	return text ? JSON.parse(text) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function truncateText(value: string, maxChars: number) {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} characters]`;
}

function formatReviewComment(
	summary: ReviewSummary | undefined,
	findings: ReviewFindingInput[],
) {
	const lines = ["## AI Review Bot", ""];
	if (summary) {
		lines.push(summary.summary, "");
		lines.push(
			summary.approve
				? "**Status:** Looks safe to merge."
				: "**Status:** Changes requested.",
			"",
		);
	}

	if (findings.length === 0) {
		lines.push("No actionable findings.");
		return lines.join("\n");
	}

	for (const finding of findings) {
		lines.push(
			`- **${finding.severity.toUpperCase()} ${finding.category}** \`${finding.file}:${finding.line}\``,
		);
		lines.push(`  - ${finding.title}`);
		lines.push(`  - ${finding.comment}`);
		if (finding.suggestion) lines.push(`  - Suggestion: ${finding.suggestion}`);
	}

	return lines.join("\n");
}

server.listen(PORT, () => {
	console.log(`Code review bot dashboard running at http://localhost:${PORT}`);
	console.log("Paste a GitHub pull request URL to review a real PR.");
});
