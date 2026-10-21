import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import {
	AgentComposer,
	AgentComposerActions,
	AgentComposerBody,
	AgentComposerField,
	AgentComposerSettings,
	AgentComposerSettingsEnd,
	AgentComposerSettingsGroup,
	AgentComposerStopButton,
	AgentComposerTextarea,
	type AgentTeamLiveActivity,
	type AgentTeamMember,
	AgentTeamPanel,
	type AgentTeamRun,
	buildAgentTeamMembers,
} from "../components/index.js";

const START = Date.parse("2026-10-20T20:00:00.000Z");
const at = (seconds: number) => START + seconds * 1000;

function member(
	overrides: Partial<AgentTeamMember> & { agentId: string },
): AgentTeamMember {
	return {
		sessionId: `session-${overrides.agentId}`,
		phase: "thinking",
		startedAt: START,
		...overrides,
	};
}

const workingTeam: AgentTeamMember[] = [
	member({
		agentId: "architect",
		task: "Design the sync protocol and ordering model",
		phase: "done",
		endedAt: at(66),
	}),
	member({
		agentId: "server-dev",
		task: "Build the WebSocket hub and event persistence",
		phase: "running",
		step: "Running commands",
	}),
	member({
		agentId: "client-dev",
		task: "Replace polling with an optimistic sync store",
		phase: "editing",
		step: "Editing files",
	}),
	member({
		agentId: "presence-dev",
		task: "Show who is viewing the board",
		phase: "reading",
		step: "Reading files",
		startedAt: at(12),
	}),
	member({
		agentId: "reviewer",
		task: "Review each change as it lands",
		phase: "waiting",
		step: "Waiting for the first change",
		startedAt: at(20),
	}),
];

const meta = {
	title: "Agent/Team panel",
	component: AgentTeamPanel,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Live view of an agent team, made to sit at the top of the composer. Build `members` with `buildAgentTeamMembers` from the host's teammate-session roster and `team_progress` lifecycle events; selecting a row asks the host to open that teammate's session.",
			},
		},
	},
	args: {
		teamName: "team-Shp9t",
		members: workingTeam,
		now: at(95),
		onOpenSession: () => {},
	},
} satisfies Meta<typeof AgentTeamPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

function frame(story: ReactElement) {
	return (
		<div className="w-[min(100%,48rem)] overflow-hidden rounded-cline-ui-lg border border-cline-ui-border bg-cline-ui-background">
			{story}
		</div>
	);
}

export const Working: Story = {
	render: (args) => frame(<AgentTeamPanel {...args} />),
};

export const EveryonePlanning: Story = {
	args: {
		members: [
			member({
				agentId: "ui-dev",
				task: "Add a light/dark theme toggle that persists",
				step: "Reading the task",
			}),
			member({
				agentId: "search-dev",
				task: "Filter cards by title as you type",
				phase: "reading",
				step: "Searching the codebase",
			}),
			member({
				agentId: "reviewer",
				task: "Review both changes",
				phase: "waiting",
				step: "Queued",
			}),
		],
		now: at(8),
	},
	render: Working.render,
};

export const TeammateOpen: Story = {
	args: { activeSessionId: "session-client-dev" },
	render: Working.render,
};

export const NeedsAttention: Story = {
	args: {
		members: [
			member({
				agentId: "server-dev",
				task: "Build the WebSocket hub",
				phase: "failed",
				step: "Tests failed: 2 of 9",
				endedAt: at(140),
			}),
			member({
				agentId: "client-dev",
				task: "Optimistic sync store",
				phase: "stopped",
				endedAt: at(90),
			}),
			member({
				agentId: "reviewer",
				task: "Review each change",
				phase: "coordinating",
				step: "Sent “Hub tests are failing”",
			}),
		],
		now: at(150),
	},
	render: Working.render,
};

export const Finished: Story = {
	args: {
		members: workingTeam.map((teammate) => ({
			...teammate,
			phase: "done",
			step: undefined,
			endedAt: at(135),
		})),
		now: at(400),
	},
	render: Working.render,
};

export const LargeTeam: Story = {
	args: {
		members: Array.from({ length: 10 }, (_, index) =>
			member({
				agentId: `worker-${index + 1}`,
				task: `Migrate package ${index + 1} to the new API`,
				phase: (["reading", "editing", "running", "done"] as const)[index % 4],
				step: ["Reading files", "Editing files", "Running commands", undefined][
					index % 4
				],
				startedAt: at(index * 3),
				endedAt: index % 4 === 3 ? at(60 + index) : undefined,
			}),
		),
		now: at(120),
	},
	render: Working.render,
};

export const InComposer: Story = {
	render: (args) => (
		<div className="w-[min(100%,48rem)]">
			<AgentComposer variant="conversation">
				<AgentTeamPanel {...args} />
				<AgentComposerBody variant="conversation">
					<AgentComposerField variant="conversation">
						<AgentComposerTextarea
							aria-label="Prompt"
							placeholder="Agent is working... submit to queue another message"
							rows={3}
							variant="conversation"
						/>
						<AgentComposerActions variant="conversation">
							<AgentComposerStopButton
								aria-label="Stop agent"
								type="button"
								variant="conversation"
							>
								<span aria-hidden>■</span>
							</AgentComposerStopButton>
						</AgentComposerActions>
					</AgentComposerField>
				</AgentComposerBody>
				<AgentComposerSettings>
					<AgentComposerSettingsGroup>
						<button type="button">Host model controls</button>
					</AgentComposerSettingsGroup>
					<AgentComposerSettingsEnd>Host workspace</AgentComposerSettingsEnd>
				</AgentComposerSettings>
			</AgentComposer>
		</div>
	),
};

type TimelineStep = {
	at: number;
	run?: Partial<AgentTeamRun> & { agentId: string };
	live?: Omit<AgentTeamLiveActivity, "at"> & { agentId: string };
};

const run = (agentId: string, prompt: string, startedAt: number) => ({
	agentId,
	prompt,
	kind: "teamtask" as const,
	status: "running",
	sessionId: `session-${agentId}`,
	startedAt: new Date(at(startedAt)).toISOString(),
});

const progress = (agentId: string, message: string) => ({
	agentId,
	eventType: "run_progress",
	message,
});

/** A small team's run, as roster updates and `team_progress` events. */
const TIMELINE: TimelineStep[] = [
	{ at: 0, run: run("ui-dev", "Add a theme toggle that persists", 0) },
	{ at: 0, run: run("search-dev", "Filter cards by title as you type", 0) },
	{ at: 1, live: progress("ui-dev", "running_tool_read_files") },
	{ at: 2, live: progress("search-dev", "running_tool_search_codebase") },
	{ at: 4, live: progress("ui-dev", "running_tool_editor") },
	{ at: 6, live: progress("search-dev", "running_tool_editor") },
	{ at: 8, live: progress("ui-dev", "running_tool_run_commands") },
	{
		at: 10,
		run: {
			agentId: "ui-dev",
			status: "completed",
			endedAt: new Date(at(10)).toISOString(),
		},
	},
	{ at: 11, run: run("reviewer", "Review both changes", 11) },
	{ at: 12, live: progress("reviewer", "running_tool_read_files") },
	{ at: 13, live: progress("search-dev", "running_tool_run_commands") },
	{
		at: 15,
		run: {
			agentId: "search-dev",
			status: "completed",
			endedAt: new Date(at(15)).toISOString(),
		},
	},
	{
		at: 17,
		live: {
			agentId: "reviewer",
			eventType: "team_message",
			message: "Search input needs styles",
		},
	},
	{
		at: 19,
		run: {
			agentId: "reviewer",
			status: "completed",
			endedAt: new Date(at(19)).toISOString(),
		},
	},
];

function LiveTeam() {
	const [elapsed, setElapsed] = useState(0);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	useEffect(() => {
		if (elapsed > 22) return;
		const timer = setTimeout(() => setElapsed((value) => value + 1), 1000);
		return () => clearTimeout(timer);
	}, [elapsed]);

	const members = useMemo(() => {
		const runs = new Map<string, AgentTeamRun>();
		const live = new Map<string, AgentTeamLiveActivity>();
		for (const step of TIMELINE) {
			if (step.at > elapsed) break;
			if (step.run) {
				const previous = runs.get(step.run.agentId);
				runs.set(step.run.agentId, {
					...previous,
					...step.run,
				} as AgentTeamRun);
			}
			if (step.live) {
				const { agentId, ...activity } = step.live;
				live.set(agentId, { ...activity, at: at(step.at) });
			}
		}
		return buildAgentTeamMembers([...runs.values()], live);
	}, [elapsed]);

	return (
		<div className="flex w-[min(100%,48rem)] flex-col gap-3">
			{frame(
				<AgentTeamPanel
					activeSessionId={activeSessionId}
					members={members}
					now={at(elapsed)}
					onOpenSession={setActiveSessionId}
					teamName="team-live"
				/>,
			)}
			<div className="flex items-center gap-3 text-cline-ui-xs text-cline-ui-muted-foreground">
				<button
					className="cursor-pointer rounded-cline-ui-md border border-cline-ui-border bg-transparent px-2 py-1 text-cline-ui-foreground"
					onClick={() => {
						setElapsed(0);
						setActiveSessionId(null);
					}}
					type="button"
				>
					Replay
				</button>
				<span>
					{activeSessionId
						? `Host would open ${activeSessionId}`
						: "Select a teammate to open its session"}
				</span>
			</div>
		</div>
	);
}

export const Live: Story = {
	render: () => <LiveTeam />,
	parameters: {
		docs: {
			description: {
				story:
					"Replays a small team through `buildAgentTeamMembers`: roster updates and `team_progress` events drive each row's phase, the panel folds when everyone is done.",
			},
		},
	},
};
