import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import qaBoard from "./screenshots/qa-01-board.webp";
import qaPalette from "./screenshots/qa-02-palette.webp";
import qaSettings from "./screenshots/qa-03-settings.webp";
import qaDark from "./screenshots/qa-04-dark.webp";
import qaShortcuts from "./screenshots/qa-05-shortcut.webp";
import qaSaved from "./screenshots/qa-06-saved.webp";

/*
 * Scripted agent-team run for the dev-only team demo. The shapes mirror the
 * SDK team model (`@cline/shared` team types: tasks with dependencies, mission
 * log kinds, mailbox messages, outcome fragments) so the views can later be
 * fed by real `team_progress` data.
 */

export type MemberStatus =
	| "planning"
	| "working"
	| "blocked"
	| "reviewing"
	| "waiting"
	| "done";

export type TeamMember = {
	id: string;
	name: string;
	role: string;
	lead?: boolean;
	status: MemberStatus;
	activity: string;
	recent: string[];
	/** Latest screenshot this teammate captured, for agents that drive the app. */
	shot?: string;
};

export type TeamTaskStatus =
	| "pending"
	| "in_progress"
	| "blocked"
	| "completed";

export type TeamTask = {
	id: string;
	title: string;
	assignee: string;
	status: TeamTaskStatus;
	dependsOn: string[];
	note?: string;
};

export type FeedKind =
	| "progress"
	| "handoff"
	| "blocked"
	| "decision"
	| "done"
	| "message";

export type FeedEntry = {
	id: string;
	agentId: string;
	kind: FeedKind;
	text: string;
	to?: string;
	at: number;
	image?: string;
};

export type OutcomeSection = {
	id: string;
	title: string;
	author: string;
	status: "missing" | "draft" | "reviewed";
	text?: string;
};

export type TeamState = {
	name: string;
	members: TeamMember[];
	tasks: TeamTask[];
	feed: FeedEntry[];
	outcome: {
		title: string;
		sections: OutcomeSection[];
		finalized: boolean;
	} | null;
	startedAt: number;
};

export type TranscriptItem =
	| {
			kind: "message";
			message: ChatMessage;
			reasoning?: string;
			thoughtMs?: number;
	  }
	| { kind: "plan" }
	| { kind: "lanes" };

export type DemoSnapshot = {
	status: ChatSessionStatus;
	transcript: TranscriptItem[];
	streamingMessageId: string | null;
	team: TeamState;
};

export const SESSION_ID = "team-demo";
export const TITLE = "Add a Settings panel: theme, notifications, shortcuts";
export const PROMPT =
	"Add a Settings panel to Tidepool with a light / dark / system theme, notification preferences (due-soon reminders, daily digest time), and a customizable shortcut for the command palette. Persist everything in localStorage and open Settings from the palette and a gear button. Use a team for this.";

const MEMBERS: TeamMember[] = [
	{
		id: "lead",
		name: "Cline",
		role: "Lead · plans, delegates, reviews",
		lead: true,
		status: "planning",
		activity: "Reading the codebase",
		recent: [],
	},
	{
		id: "backend-dev",
		name: "backend-dev",
		role: "State and persistence",
		status: "waiting",
		activity: "Joined the team",
		recent: [],
	},
	{
		id: "ui-dev",
		name: "ui-dev",
		role: "Panel UI and styles",
		status: "waiting",
		activity: "Joined the team",
		recent: [],
	},
	{
		id: "integration-dev",
		name: "integration-dev",
		role: "Theme, palette, and shortcuts",
		status: "waiting",
		activity: "Joined the team",
		recent: [],
	},
	{
		id: "qa-engineer",
		name: "qa-engineer",
		role: "Runs the app and verifies",
		status: "waiting",
		activity: "Joined the team",
		recent: [],
	},
];

const TASKS: TeamTask[] = [
	{
		id: "#1",
		title: "Build Settings Manager & localStorage persistence",
		assignee: "backend-dev",
		status: "pending",
		dependsOn: [],
	},
	{
		id: "#2",
		title: "Design & implement Settings panel UI",
		assignee: "ui-dev",
		status: "pending",
		dependsOn: [],
	},
	{
		id: "#3",
		title: "Apply theme: Light, Dark, or Auto",
		assignee: "integration-dev",
		status: "pending",
		dependsOn: ["#1"],
	},
	{
		id: "#4",
		title: "Rebindable palette shortcut",
		assignee: "integration-dev",
		status: "pending",
		dependsOn: ["#1", "#2"],
	},
	{
		id: "#5",
		title: "Notification preferences",
		assignee: "ui-dev",
		status: "pending",
		dependsOn: ["#1", "#2"],
	},
	{
		id: "#6",
		title: "Settings command and gear button",
		assignee: "integration-dev",
		status: "pending",
		dependsOn: ["#2"],
	},
	{
		id: "#7",
		title: "Test Settings feature & validate requirements",
		assignee: "qa-engineer",
		status: "pending",
		dependsOn: ["#3", "#4", "#5", "#6"],
	},
];

const SECTIONS: OutcomeSection[] = [
	{
		id: "feature_summary",
		title: "Feature summary",
		author: "lead",
		status: "missing",
	},
	{
		id: "technical_changes",
		title: "Technical changes",
		author: "backend-dev",
		status: "missing",
	},
	{
		id: "integration_notes",
		title: "Integration notes",
		author: "integration-dev",
		status: "missing",
	},
	{
		id: "testing_results",
		title: "Testing results",
		author: "qa-engineer",
		status: "missing",
	},
];

const FINAL_ANSWER = `The Settings panel is in, built by a team of four and verified in the browser.

- **backend-dev** added \`src/settings.js\`: defaults, \`localStorage\` under \`tidepool.settings.v1\`, and change events
- **ui-dev** built the dialog: theme picker, daily digest time, and an editable Keyboard Shortcuts section
- **integration-dev** wired theme (including live OS changes for "Auto"), the rebindable palette shortcut, a gear button, and an "Open settings" palette command
- **qa-engineer** ran the app, caught that "Auto" ignored OS theme changes, and re-verified after the fix

The team's write-up is finalized in the outcome, section by section.`;

type Mutator = (state: DemoSnapshot, now: number) => void;
/** A tool call. With `ref` and no `runMs` it stays running until a later beat completes it. */
type ToolBeat = {
	tool: string;
	input: unknown;
	result: unknown;
	runMs?: number;
	ref?: string;
};
export type Beat = {
	wait: number;
	do?: Mutator;
	tool?: ToolBeat;
	complete?: { ref: string; result: unknown };
	say?: {
		text: string;
		reasoning?: string;
		thoughtMs?: number;
		stream?: boolean;
	};
};

const member = (s: DemoSnapshot, id: string) => {
	const found = s.team.members.find((m) => m.id === id);
	if (!found) throw new Error(`unknown member ${id}`);
	return found;
};
const act =
	(id: string, status: MemberStatus, activity: string): Mutator =>
	(s) => {
		const m = member(s, id);
		if (
			m.activity &&
			m.activity !== activity &&
			m.activity !== "Joined the team"
		)
			m.recent = [m.activity, ...m.recent].slice(0, 3);
		m.status = status;
		m.activity = activity;
	};
const shot =
	(id: string, src: { src: string }): Mutator =>
	(s) => {
		member(s, id).shot = src.src;
	};
const task =
	(id: string, status: TeamTaskStatus, note?: string): Mutator =>
	(s) => {
		const t = s.team.tasks.find((x) => x.id === id);
		if (t) Object.assign(t, { status, note });
	};
let feedSeq = 0;
const feed =
	(agentId: string, kind: FeedKind, text: string, to?: string): Mutator =>
	(s, now) => {
		s.team.feed.push({ id: `f${feedSeq++}`, agentId, kind, text, to, at: now });
	};
const section =
	(id: string, status: OutcomeSection["status"], text?: string): Mutator =>
	(s) => {
		const sec = s.team.outcome?.sections.find((x) => x.id === id);
		if (sec) Object.assign(sec, { status, ...(text ? { text } : {}) });
	};
const all =
	(...fns: Mutator[]): Mutator =>
	(s, now) => {
		for (const fn of fns) fn(s, now);
	};

export function initialSnapshot(): DemoSnapshot {
	return {
		status: "starting",
		transcript: [],
		streamingMessageId: null,
		team: {
			name: "tidepool-settings",
			members: [],
			tasks: [],
			feed: [],
			outcome: null,
			startedAt: Date.now(),
		},
	};
}

export function buildBeats(): Beat[] {
	feedSeq = 0;
	const spawn = (id: string): Beat => ({
		wait: 220,
		do: (s) => {
			const m = MEMBERS.find((x) => x.id === id);
			if (m && !s.team.members.some((x) => x.id === id))
				s.team.members.push(structuredClone(m));
		},
		tool: {
			tool: "team_spawn_teammate",
			input: {
				agentId: id,
				rolePrompt: MEMBERS.find((x) => x.id === id)?.role,
			},
			result: { agentId: id, status: "idle" },
			runMs: 260,
		},
	});
	const createTask = (id: string): Beat => ({
		wait: 160,
		do: (s) => {
			const t = TASKS.find((x) => x.id === id);
			if (t && !s.team.tasks.some((x) => x.id === id))
				s.team.tasks.push(structuredClone(t));
		},
	});
	const assign = (taskId: string, agentId: string): Beat => ({
		wait: 200,
		tool: {
			tool: "team_run_task",
			input: { agentId, task: taskId, runMode: "async" },
			result: { agentId, mode: "async", status: "queued" },
			runMs: 260,
		},
	});
	const review = (sectionId: string): Beat => ({
		wait: 450,
		do: section(sectionId, "reviewed"),
		tool: {
			tool: "team_review_outcome_fragment",
			input: { fragmentId: sectionId, status: "reviewed" },
			result: { status: "reviewed" },
			runMs: 300,
		},
	});

	return [
		{
			wait: 300,
			do: (s) => {
				s.team.members.push(structuredClone(MEMBERS[0]));
				s.status = "running";
			},
		},
		{
			wait: 500,
			tool: {
				tool: "read_files",
				input: { files: ["index.html", "src/app.js", "src/styles.css"] },
				result: "ok",
				runMs: 700,
			},
		},
		{
			wait: 400,
			do: act("lead", "planning", "Drafting the plan"),
			say: {
				text: "This splits cleanly: a settings store everything depends on, the dialog UI, and the wiring into theme, the palette, and shortcuts. I'll run three builders in parallel and keep QA for the end.",
				reasoning:
					"Dependencies first. The store has to exist before theme, shortcut, and notifications can read it, but the dialog markup doesn't need it, so the store and the dialog can start in parallel. Integration should plan against the existing keydown handling while it waits. QA needs a running app with everything wired, so it goes last and should exercise the real UI.",
				thoughtMs: 8200,
			},
		},
		spawn("backend-dev"),
		spawn("ui-dev"),
		spawn("integration-dev"),
		spawn("qa-engineer"),
		{
			wait: 300,
			do: (s) => {
				s.transcript.push({ kind: "plan" });
			},
		},
		...TASKS.map((t) => createTask(t.id)),
		{
			wait: 250,
			do: all(
				feed(
					"lead",
					"progress",
					"Project kickoff: planning a 4-person team with clear role separation and phased execution.",
				),
				feed(
					"lead",
					"decision",
					"Store settings under tidepool.settings.v1 with a schema version so we can migrate later.",
				),
			),
		},
		{
			wait: 300,
			do: all(act("lead", "planning", "Assigning work"), (s) => {
				s.team.outcome = {
					title: "Settings Panel Feature Implementation",
					sections: structuredClone(SECTIONS),
					finalized: false,
				};
			}),
		},
		assign("#1", "backend-dev"),
		assign("#2", "ui-dev"),
		{
			wait: 250,
			do: all(
				(s) => {
					s.transcript.push({ kind: "lanes" });
				},
				task("#1", "in_progress"),
				task("#2", "in_progress"),
				act("backend-dev", "working", "Creating src/settings.js"),
				act("ui-dev", "working", "Adding the Settings dialog to index.html"),
				act(
					"integration-dev",
					"planning",
					"Reading keydown handling in app.js",
				),
				act("qa-engineer", "waiting", "Waiting on #3 to #6"),
			),
		},
		{
			wait: 200,
			tool: {
				tool: "team_await_runs",
				input: {
					agentIds: ["backend-dev", "ui-dev", "integration-dev", "qa-engineer"],
				},
				result: null,
				ref: "await",
			},
			do: act("lead", "waiting", "Waiting on teammates"),
		},
		{
			wait: 1400,
			do: all(
				act("backend-dev", "working", "Writing defaults and schema v1"),
				act("ui-dev", "working", "Styling the dialog with existing tokens"),
			),
		},
		{
			wait: 1200,
			do: all(
				act(
					"integration-dev",
					"planning",
					"Planning the theme and shortcut approach",
				),
				feed(
					"integration-dev",
					"decision",
					'Apply theme with data-theme on <html>; "Auto" follows prefers-color-scheme.',
				),
			),
		},
		{
			wait: 1300,
			do: all(
				act(
					"backend-dev",
					"working",
					"Adding getSettings, updateSettings, onSettingsChange",
				),
				act("integration-dev", "waiting", "Waiting on backend-dev"),
			),
		},
		{
			wait: 1500,
			do: all(
				task("#1", "completed"),
				act("backend-dev", "done", "#1 complete"),
				feed(
					"backend-dev",
					"handoff",
					'Store is ready: getSettings(), updateSettings(patch), onSettingsChange(fn). Defaults: theme "auto", shortcut "Mod+K". 11/11 validation checks pass.',
					"integration-dev",
				),
				section(
					"technical_changes",
					"draft",
					"src/settings.js owns defaults, persistence under tidepool.settings.v1, and change events.",
				),
				task("#3", "in_progress"),
				act("integration-dev", "working", "Wiring theme to data-theme"),
			),
		},
		{
			wait: 1500,
			do: all(
				task("#2", "completed"),
				feed(
					"ui-dev",
					"done",
					"Dialog markup and styles are in. Sections: Appearance, Notifications, Keyboard.",
				),
				feed(
					"lead",
					"progress",
					"Phase 1 complete: backend-dev delivered the SettingsManager and ui-dev the Settings dialog. Phase 2 is integration.",
				),
				task("#5", "in_progress"),
				act(
					"ui-dev",
					"working",
					"Building notification toggles and digest time",
				),
			),
		},
		{
			wait: 1300,
			do: all(
				task("#4", "blocked", "Needs a capture field in the dialog"),
				feed(
					"integration-dev",
					"message",
					"For shortcut capture I need a focusable field in the dialog. Can you add an input with data-shortcut-input under Keyboard?",
					"ui-dev",
				),
				act(
					"integration-dev",
					"blocked",
					"Blocked on a shortcut capture field",
				),
			),
		},
		{
			wait: 1500,
			do: all(
				feed(
					"ui-dev",
					"message",
					"Added <input data-shortcut-input> under Keyboard. It shows the current combo.",
					"integration-dev",
				),
				task("#4", "in_progress"),
				act(
					"integration-dev",
					"working",
					"Recording key combos for the palette shortcut",
				),
			),
		},
		{
			wait: 1300,
			do: all(
				task("#3", "completed"),
				feed(
					"integration-dev",
					"progress",
					"Theme switches instantly and persists across reloads.",
				),
			),
		},
		{
			wait: 1200,
			do: all(
				task("#5", "completed"),
				act("ui-dev", "done", "#2 and #5 complete"),
				section(
					"technical_changes",
					"draft",
					"New src/settings.js owns defaults, persistence under tidepool.settings.v1, and change events. The Settings dialog has Appearance, Notifications, and Keyboard sections styled with existing tokens.",
				),
			),
		},
		{
			wait: 1200,
			do: all(
				task("#4", "completed"),
				task("#6", "in_progress"),
				act(
					"integration-dev",
					"working",
					'Adding a gear button and an "Open settings" command',
				),
			),
		},
		{
			wait: 1500,
			do: all(
				task("#6", "completed"),
				act("integration-dev", "done", "#3, #4, and #6 complete"),
				section(
					"integration_notes",
					"draft",
					'Theme via data-theme, rebindable palette shortcut, gear button, and an "Open settings" palette command.',
				),
				task("#7", "in_progress"),
				act("qa-engineer", "working", "Starting the app on :5173"),
				shot("qa-engineer", qaBoard),
			),
		},
		{
			wait: 1300,
			do: all(
				act("qa-engineer", "working", "Opening Settings from the palette"),
				shot("qa-engineer", qaPalette),
			),
		},
		{
			wait: 1000,
			do: all(
				act("qa-engineer", "working", "Checking the Settings dialog"),
				shot("qa-engineer", qaSettings),
			),
		},
		{
			wait: 1200,
			do: all(
				act("qa-engineer", "working", "Switching theme to Dark, then Auto"),
				shot("qa-engineer", qaDark),
			),
		},
		{
			wait: 1400,
			do: all(
				act("qa-engineer", "blocked", "Found a bug in Auto theme"),
				task("#7", "blocked", "Auto theme ignores OS changes"),
				(s, now) => {
					s.team.feed.push({
						id: `f${feedSeq++}`,
						agentId: "qa-engineer",
						kind: "blocked",
						text: 'With theme set to "Auto", changing the OS theme doesn\'t update the app until reload.',
						to: "integration-dev",
						at: now,
						image: qaSettings.src,
					});
				},
				task("#3", "in_progress", "Reopened by qa"),
				act(
					"integration-dev",
					"working",
					"Listening for prefers-color-scheme changes",
				),
			),
		},
		{
			wait: 1700,
			do: all(
				task("#3", "completed"),
				act("integration-dev", "done", "Fix shipped"),
				feed(
					"integration-dev",
					"message",
					'Fixed: the theme now listens for matchMedia changes while set to "Auto".',
					"qa-engineer",
				),
				task("#7", "in_progress"),
				act("qa-engineer", "working", "Re-checking Auto theme"),
			),
		},
		{
			wait: 1300,
			do: all(
				act("qa-engineer", "working", "Checking keyboard shortcuts"),
				shot("qa-engineer", qaShortcuts),
			),
		},
		{
			wait: 1300,
			do: all(
				task("#7", "completed"),
				act("qa-engineer", "done", "All checks passed"),
				shot("qa-engineer", qaSaved),
				feed(
					"qa-engineer",
					"done",
					"Verified theme (Light, Dark, Auto), the daily digest, keyboard shortcuts, saving, and both ways to open Settings.",
				),
				section(
					"testing_results",
					"draft",
					"Ran the app and exercised every setting in the browser, including the OS theme change fix.",
				),
			),
		},
		{
			wait: 700,
			do: all(
				act("lead", "reviewing", "Reviewing outcome sections"),
				section(
					"feature_summary",
					"draft",
					"Settings panel with theme, notifications, and a rebindable palette shortcut, persisted locally.",
				),
			),
			complete: {
				ref: "await",
				result: [
					{ agentId: "backend-dev", status: "completed" },
					{ agentId: "ui-dev", status: "completed" },
					{ agentId: "integration-dev", status: "completed" },
					{ agentId: "qa-engineer", status: "completed" },
				],
			},
		},
		review("technical_changes"),
		review("integration_notes"),
		review("testing_results"),
		review("feature_summary"),
		{
			wait: 400,
			do: all(
				(s) => {
					if (s.team.outcome) s.team.outcome.finalized = true;
				},
				feed(
					"lead",
					"done",
					"Outcome finalized: Settings Panel Feature Implementation.",
				),
				act("lead", "done", "Writing the summary"),
			),
			tool: {
				tool: "team_finalize_outcome",
				input: { outcomeId: "settings-panel" },
				result: { status: "finalized" },
				runMs: 300,
			},
		},
		{ wait: 500, say: { text: FINAL_ANSWER, stream: true } },
		{
			wait: 300,
			do: (s) => {
				s.status = "completed";
			},
		},
	];
}
