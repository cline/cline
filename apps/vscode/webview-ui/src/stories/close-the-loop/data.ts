import type { ClineMessage, WorkVerification } from "@shared/ExtensionMessage"
import shotLight from "./01-light.webp"
import shotDark from "./02-dark.webp"
import shotJournal from "./03-journal.webp"
import shotMobile from "./04-mobile.webp"
import shotTests from "./05-terminal.webp"

/**
 * Canned "close the loop" session for Storybook: the agent implements a
 * feature in a cloud sandbox, launches the app it changed, drives it, and
 * ships screenshots back with the completion summary. Nothing here is live.
 */

export const CLOSE_THE_LOOP_VERIFICATION: WorkVerification = {
	summary: "Verified in sandbox",
	target: "localhost:5173",
	durationMs: 38_000,
	screenshots: [
		{
			id: "shot-light",
			src: shotLight,
			title: "Dashboard renders the new weekly heatmap",
			note: "24 weeks of completions, five intensity levels, today outlined.",
			action: "launch",
			outcome: "pass",
		},
		{
			id: "shot-dark",
			src: shotDark,
			title: "Dark mode toggle switches the whole theme",
			note: "Clicked the header switch; preference persisted across a reload.",
			action: "click",
			outcome: "pass",
		},
		{
			id: "shot-journal",
			src: shotJournal,
			title: "Marking a habit done updates streak and progress",
			note: "Journal 3 → 4 day streak, counter 5 / 6, confirmation toast shown.",
			action: "click",
			outcome: "pass",
		},
		{
			id: "shot-mobile",
			src: shotMobile,
			title: "Layout stacks cleanly at 390px",
			note: "Heatmap scrolls horizontally; nav collapses behind the toggle.",
			action: "resize",
			outcome: "pass",
		},
		{
			id: "shot-tests",
			src: shotTests,
			title: "6 tests pass, branch pushed, PR #142 opened",
			note: "bun test · git push · gh pr create --fill --base main",
			action: "screenshot",
			outcome: "pass",
		},
	],
}

export const CLOSE_THE_LOOP_COMPLETION_TEXT = [
	"Added the weekly activity heatmap and a dark mode toggle, verified both in the running app, and opened [PR #142](https://github.com/acme/habitat/pull/142).",
	"",
	"- `ActivityHeatmap` renders 24 weeks of completions on a five-level scale",
	"- The header toggle persists the theme in `localStorage`",
	"- 6 tests pass; layout verified at desktop and 390px widths",
].join("\n")

export type CloseTheLoopNarration = { eyebrow: "Today" | "Next"; title: string; body: string }

export const CLOSE_THE_LOOP_NARRATION: CloseTheLoopNarration[] = [
	{
		eyebrow: "Today",
		title: "A cloud session starts in a fresh sandbox",
		body: "The task runs against a clean clone of acme/habitat; the extension streams every step as it happens.",
	},
	{
		eyebrow: "Today",
		title: "Cline implements the feature and runs the tests",
		body: "Reads, edits, and commands show up exactly as they do now. Green tests are where the loop ends today.",
	},
	{
		eyebrow: "Next",
		title: "Close the loop: Cline uses the app it just built",
		body: "It launches the dev server on a virtual display, then clicks, resizes, and screenshots to confirm the work actually works.",
	},
	{
		eyebrow: "Next",
		title: "The proof ships with the summary",
		body: "Screenshots stream back as session artifacts and land in the Completed card next to the PR link.",
	},
]

export type CloseTheLoopBeat = {
	delay: number
	message?: ClineMessage
	narration?: number
	/** Marks the most recent `command` message as finished when this beat lands. */
	completesCommand?: boolean
}

let ts = 0
const say = (sayType: ClineMessage["say"], text: string, overrides: Partial<ClineMessage> = {}): ClineMessage => {
	ts += 1000
	return { ts, type: "say", say: sayType, text, ...overrides }
}
const tool = (payload: Record<string, unknown>) =>
	say("tool", JSON.stringify({ operationIsLocatedInWorkspace: true, ...payload }))
const apiReq = () => say("api_req_started", JSON.stringify({ request: "…", tokensIn: 4200, tokensOut: 610, cost: 0.012 }))

export function buildCloseTheLoopBeats(): CloseTheLoopBeat[] {
	ts = Date.now() - 60_000
	return [
		{
			delay: 400,
			narration: 0,
			message: say(
				"task",
				"Add a weekly activity heatmap to the dashboard and a dark mode toggle in the header. Open a PR when it's done.",
			),
		},
		{ delay: 800, message: apiReq() },
		{ delay: 900, narration: 1, message: tool({ tool: "readFile", path: "src/pages/Dashboard.tsx" }) },
		{ delay: 500, message: tool({ tool: "readFile", path: "src/components/Header.tsx" }) },
		{ delay: 600, message: tool({ tool: "searchFiles", path: "src", regex: "prefers-color-scheme|localStorage" }) },
		{
			delay: 900,
			message: tool({
				tool: "newFileCreated",
				path: "src/components/ActivityHeatmap.tsx",
				content:
					'export function ActivityHeatmap({ days }: { days: DayCount[] }) {\n  const weeks = chunk(days, 7)\n  return (\n    <div className="heatmap" role="img" aria-label="Weekly activity">\n      {weeks.map((week) => week.map((day) => (\n        <span data-level={levelFor(day.count)} key={day.date} />\n      )))}\n    </div>\n  )\n}\n',
			}),
		},
		{
			delay: 1000,
			message: tool({
				tool: "editedExistingFile",
				path: "src/pages/Dashboard.tsx",
				content:
					'------- SEARCH\n      <TodayList habits={habits} />\n=======\n      <Panel title="Weekly activity" badge="New">\n        <ActivityHeatmap days={last24Weeks(completions)} />\n      </Panel>\n      <TodayList habits={habits} />\n+++++++ REPLACE',
			}),
		},
		{
			delay: 900,
			message: tool({
				tool: "editedExistingFile",
				path: "src/components/Header.tsx",
				content:
					"------- SEARCH\n      <Avatar user={user} />\n=======\n      <ThemeToggle value={theme} onChange={setTheme} />\n      <Avatar user={user} />\n+++++++ REPLACE",
			}),
		},
		{ delay: 700, message: say("command", "bun test") },
		{
			delay: 1400,
			completesCommand: true,
			message: say(
				"command_output",
				"bun test v1.3.13\n\ntests/heatmap.test.ts:\n✓ weekly activity heatmap > maps completion counts to five intensity levels\n✓ weekly activity heatmap > renders 24 weeks of cells\n✓ dark mode > persists the chosen theme\n\n 6 pass\n 0 fail\nRan 6 tests across 1 file. [12.00ms]",
			),
		},
		{
			delay: 800,
			narration: 2,
			message: say(
				"text",
				"Tests pass. Launching the app on the sandbox display to verify the heatmap and the theme toggle end to end.",
			),
		},
		{ delay: 600, message: say("command", "bun run dev --port 5173 &") },
		{
			delay: 700,
			completesCommand: true,
			message: say("command_output", "  VITE v6.3.5  ready in 312 ms\n\n  ➜  Local:   http://localhost:5173/"),
		},
		{
			delay: 700,
			message: say(
				"command",
				[
					"computer launch http://localhost:5173 --viewport 1280x800",
					"computer screenshot              # 1 · dashboard renders the heatmap",
					'computer click "Dark mode"       # 2 · theme switched',
					'computer click "Journal"         # 3 · streak 3 → 4, toast shown',
					"computer resize 390x844          # 4 · layout stacks",
				].join("\n"),
			),
		},
		{
			delay: 2400,
			completesCommand: true,
			message: say(
				"command_output",
				"display :1 ready (Xvfb 1280x800)\nsaved .cline/verification/01-dashboard.png\nsaved .cline/verification/02-dark-mode.png\nsaved .cline/verification/03-journal.png\nsaved .cline/verification/04-mobile.png",
			),
		},
		{ delay: 700, message: say("command", "git push -u origin cline/add-weekly-heatmap && gh pr create --fill --base main") },
		{
			delay: 1200,
			completesCommand: true,
			message: say(
				"command_output",
				"Creating pull request for cline/add-weekly-heatmap into main in acme/habitat\n\nhttps://github.com/acme/habitat/pull/142",
			),
		},
		{ delay: 600, message: apiReq() },
		{
			delay: 700,
			narration: 3,
			message: say("completion_result", CLOSE_THE_LOOP_COMPLETION_TEXT, {
				verification: CLOSE_THE_LOOP_VERIFICATION,
			}),
		},
	]
}
