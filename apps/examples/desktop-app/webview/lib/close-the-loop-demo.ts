import type {
	ChatMessage,
	ChatSessionStatus,
	WorkVerification,
} from "./chat-schema";

/**
 * Scripted "close the loop" cloud session used by `/demo/close-the-loop`.
 *
 * Nothing here is live: the transcript and screenshots are canned so the team
 * can see what a cloud session looks like once the sandbox agent can launch
 * the app it just changed, drive it, screenshot it, and ship those frames
 * back to the client alongside the completion summary.
 */

export const DEMO_SESSION_ID = "demo-close-the-loop";
export const DEMO_REPO = "acme/habitat";
export const DEMO_BRANCH = "cline/add-weekly-heatmap";

const SHOT = (file: string) => `/demo/close-the-loop/${file}`;

export const DEMO_VERIFICATION: WorkVerification = {
	summary: "Verified in sandbox",
	target: "localhost:5173",
	durationMs: 38_000,
	screenshots: [
		{
			id: "shot-light",
			src: SHOT("01-light.webp"),
			title: "Dashboard renders the new weekly heatmap",
			note: "24 weeks of completions, five intensity levels, today outlined.",
			action: "launch",
			outcome: "pass",
		},
		{
			id: "shot-dark",
			src: SHOT("02-dark.webp"),
			title: "Dark mode toggle switches the whole theme",
			note: "Clicked the header switch; preference persisted across a reload.",
			action: "click",
			outcome: "pass",
		},
		{
			id: "shot-journal",
			src: SHOT("03-journal.webp"),
			title: "Marking a habit done updates streak and progress",
			note: "Journal 3 → 4 day streak, counter 5 / 6, confirmation toast shown.",
			action: "click",
			outcome: "pass",
		},
		{
			id: "shot-mobile",
			src: SHOT("04-mobile.webp"),
			title: "Layout stacks cleanly at 390px",
			note: "Heatmap scrolls horizontally; nav collapses; toggle keeps its label hidden.",
			action: "resize",
			outcome: "pass",
		},
		{
			id: "shot-tests",
			src: SHOT("05-terminal.webp"),
			title: "6 tests pass, branch pushed, PR #142 opened",
			note: "bun test · git push · gh pr create --fill --base main",
			action: "screenshot",
			outcome: "pass",
		},
	],
};

export const DEMO_COMPLETION_TEXT = [
	"Added the weekly activity heatmap and a dark mode toggle, verified both in the running app, and opened [PR #142](https://github.com/acme/habitat/pull/142).",
	"",
	"- `ActivityHeatmap` renders 24 weeks of completions on a five-level scale",
	"- The header toggle persists the theme in `localStorage`",
	"- 6 tests pass; layout verified at desktop and 390px widths",
].join("\n");

export type DemoNarration = {
	eyebrow: string;
	title: string;
	body: string;
};

export const DEMO_NARRATION: DemoNarration[] = [
	{
		eyebrow: "Today",
		title: "A cloud session starts in a fresh sandbox",
		body: `The task runs against a clean clone of ${DEMO_REPO}; the client streams every tool call as it happens.`,
	},
	{
		eyebrow: "Today",
		title: "Cline implements the feature and runs the tests",
		body: "Reads, edits, and commands show up exactly as they do now. Green tests are where the loop ends today.",
	},
	{
		eyebrow: "Next",
		title: "Close the loop: Cline uses the app it just built",
		body: "It launches the dev server on a virtual display, then clicks, types, resizes, and screenshots to confirm the work actually works.",
	},
	{
		eyebrow: "Next",
		title: "The proof ships with the summary",
		body: "Screenshots stream back as session artifacts and land in the transcript next to the PR link, so you can review without pulling the branch.",
	},
];

type Beat =
	| { delay: number; append: ChatMessage; narration?: number }
	| { delay: number; patch: Pick<ChatMessage, "id"> & Partial<ChatMessage> }
	| { delay: number; status: ChatSessionStatus; narration?: number }
	| { delay: number; streaming: string | null };

export type DemoBeat = Beat;

let clock = 0;
const nextTimestamp = () => {
	clock += 1_000;
	return clock;
};

function userMessage(id: string, content: string): ChatMessage {
	return {
		id,
		sessionId: DEMO_SESSION_ID,
		role: "user",
		content,
		createdAt: nextTimestamp(),
	};
}

function toolMessage(
	id: string,
	toolName: string,
	input: unknown,
): ChatMessage {
	return {
		id,
		sessionId: DEMO_SESSION_ID,
		role: "tool",
		content: JSON.stringify({ toolName, input }),
		createdAt: nextTimestamp(),
		meta: { toolName, toolCallId: id },
	};
}

function finishTool(
	id: string,
	toolName: string,
	input: unknown,
	result: unknown,
): Pick<ChatMessage, "id" | "content"> {
	return { id, content: JSON.stringify({ toolName, input, result }) };
}

/** Appends an in-progress tool row, then completes it after `runMs`. */
function toolBeats(
	id: string,
	toolName: string,
	input: unknown,
	result: unknown,
	{ startDelay = 350, runMs = 900 } = {},
): Beat[] {
	return [
		{ delay: startDelay, append: toolMessage(id, toolName, input) },
		{ delay: runMs, patch: finishTool(id, toolName, input, result) },
	];
}

const COMPLETION_ID = "assistant-completion";

function buildScript(): Beat[] {
	// Rough wall-clock timestamps so message times and "Worked for Ns" read
	// like a session that finished a minute ago.
	clock = Date.now() - 60_000;
	const completion: ChatMessage = {
		id: COMPLETION_ID,
		sessionId: DEMO_SESSION_ID,
		role: "assistant",
		content: "",
		createdAt: 0,
	};
	const completionParagraphs = DEMO_COMPLETION_TEXT.split("\n");

	return [
		{
			delay: 400,
			append: userMessage(
				"user-task",
				"Add a weekly activity heatmap to the dashboard and a dark mode toggle in the header. Open a PR when it's done.",
			),
			narration: 0,
		},
		{ delay: 700, status: "running" },
		...toolBeats(
			"tool-read",
			"read_files",
			{
				paths: [
					"src/pages/Dashboard.tsx",
					"src/components/StatCard.tsx",
					"src/styles/theme.css",
				],
			},
			{ files: 3 },
			{ startDelay: 900, runMs: 1100 },
		),
		{ delay: 0, status: "running", narration: 1 },
		...toolBeats(
			"tool-search",
			"search_codebase",
			{ queries: ["prefers-color-scheme", "localStorage"] },
			{ matches: 4 },
		),
		...toolBeats(
			"tool-edit-heatmap",
			"editor",
			{
				path: "src/components/ActivityHeatmap.tsx",
				new_text:
					'export function ActivityHeatmap({ days }: { days: DayCount[] }) {\n  const weeks = chunk(days, 7)\n  return (\n    <div className="heatmap" role="img" aria-label="Weekly activity">\n      {weeks.map((week) => week.map((day) => (\n        <span data-level={levelFor(day.count)} key={day.date} title={day.count + " habits"} />\n      )))}\n    </div>\n  )\n}\n',
			},
			{ additions: 38, deletions: 0 },
			{ runMs: 1300 },
		),
		...toolBeats(
			"tool-edit-dashboard",
			"editor",
			{
				path: "src/pages/Dashboard.tsx",
				old_text: "      <TodayList habits={habits} />\n",
				new_text:
					'      <Panel title="Weekly activity" badge="New">\n        <ActivityHeatmap days={last24Weeks(completions)} />\n      </Panel>\n      <TodayList habits={habits} />\n',
			},
			{ additions: 3, deletions: 0 },
			{ runMs: 1000 },
		),
		...toolBeats(
			"tool-edit-header",
			"editor",
			{
				path: "src/components/Header.tsx",
				old_text: "      <Avatar user={user} />\n",
				new_text:
					"      <ThemeToggle value={theme} onChange={setTheme} />\n      <Avatar user={user} />\n",
			},
			{ additions: 1, deletions: 0 },
			{ runMs: 900 },
		),
		...toolBeats(
			"tool-test",
			"run_commands",
			{ commands: ["bun test"] },
			{
				output:
					"bun test v1.3.13\n\ntests/heatmap.test.ts:\n✓ weekly activity heatmap > maps completion counts to five intensity levels\n✓ weekly activity heatmap > renders 24 weeks of cells\n✓ weekly activity heatmap > marks the final cell as today\n✓ weekly activity heatmap > keeps the legend ordered from less to more\n✓ dark mode > persists the chosen theme\n✓ dark mode > defaults to light when nothing is stored\n\n 6 pass\n 0 fail\nRan 6 tests across 1 file. [12.00ms]",
			},
			{ runMs: 1600 },
		),
		{ delay: 600, status: "running", narration: 2 },
		...toolBeats(
			"tool-dev-server",
			"run_commands",
			{ commands: ["bun run dev --port 5173 &"] },
			{
				output:
					"  VITE v6.3.5  ready in 312 ms\n\n  ➜  Local:   http://localhost:5173/",
			},
		),
		...toolBeats(
			"tool-cu-launch",
			"computer_use",
			{ action: "launch", url: "http://localhost:5173", viewport: "1280x800" },
			{ query: "Opened http://localhost:5173 on display :1 (1280×800)" },
			{ runMs: 1200 },
		),
		...toolBeats(
			"tool-cu-shot-1",
			"computer_use",
			{ action: "screenshot" },
			{ query: "Screenshot 1 · dashboard renders the weekly heatmap" },
		),
		...toolBeats(
			"tool-cu-click-dark",
			"computer_use",
			{ action: "click", target: "Dark mode toggle", coordinate: [1166, 153] },
			{ query: 'Clicked "Dark mode" · screenshot 2 · theme switched' },
		),
		...toolBeats(
			"tool-cu-click-journal",
			"computer_use",
			{ action: "click", target: "Journal habit row", coordinate: [901, 682] },
			{ query: 'Clicked "Journal" · screenshot 3 · streak 3 → 4, toast shown' },
		),
		...toolBeats(
			"tool-cu-resize",
			"computer_use",
			{ action: "resize", width: 390, height: 844 },
			{ query: "Resized to 390×844 · screenshot 4 · layout stacks" },
		),
		...toolBeats(
			"tool-pr",
			"run_commands",
			{
				commands: [
					`git push -u origin ${DEMO_BRANCH}`,
					"gh pr create --fill --base main",
				],
			},
			{
				output: `branch '${DEMO_BRANCH}' set up to track 'origin/${DEMO_BRANCH}'.\nCreating pull request for ${DEMO_BRANCH} into main in ${DEMO_REPO}\n\nhttps://github.com/acme/habitat/pull/142`,
			},
			{ runMs: 1400 },
		),
		{ delay: 500, append: { ...completion, createdAt: nextTimestamp() } },
		{ delay: 0, streaming: COMPLETION_ID },
		...completionParagraphs.map((_, index) => ({
			delay: index === 0 ? 150 : 260,
			patch: {
				id: COMPLETION_ID,
				content: completionParagraphs.slice(0, index + 1).join("\n"),
			},
		})),
		{ delay: 300, streaming: null },
		{
			delay: 200,
			patch: {
				id: COMPLETION_ID,
				meta: { verification: DEMO_VERIFICATION },
			},
		},
		{ delay: 0, status: "completed", narration: 3 },
	];
}

export const DEMO_SCRIPT: DemoBeat[] = buildScript();

export const DEMO_SCRIPT_DURATION_MS = DEMO_SCRIPT.reduce(
	(total, beat) => total + beat.delay,
	0,
);
