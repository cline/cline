import type { TeamRuntimeState, TeamTask } from "@cline/shared";

/**
 * Demo team snapshot: Drive plan features from
 * `docs/plans/cline-drivemode/` with TASK-GRAPH dependency edges.
 * Used for docs screenshots, hub `?demoPlans=1`, and TUI `/status` demos.
 */
const now = new Date("2026-07-29T12:00:00.000Z");

function task(
	id: string,
	title: string,
	status: TeamTask["status"],
	dependsOn: string[],
	description: string,
): TeamTask {
	return {
		id,
		title,
		description,
		status,
		createdAt: now,
		updatedAt: now,
		createdBy: "plan",
		dependsOn,
		assignee: status === "pending" ? undefined : "drive-team",
	};
}

const planTasks: TeamTask[] = [
	task("DRV-ADR", "Architecture decision record", "completed", [], "Phase 0 · DRV-ADR"),
	task("DRV-EVENTS", "Versioned room and drive event schemas", "completed", [], "Phase 0 · DRV-EVENTS"),
	task("DRV-KERNEL", "The @cline/drive kernel package", "completed", ["DRV-EVENTS"], "Phase 0 · DRV-KERNEL"),
	task("DRV-HOOK-POLICY", "Runtime hooks with an honest override path", "completed", ["DRV-KERNEL"], "Phase 0 · DRV-HOOK-POLICY"),
	task("DRV-PRIVACY", "Privacy-strict defaults", "completed", ["DRV-EVENTS"], "Phase 0 · DRV-PRIVACY"),
	task("DRV-PLATFORM-CONFIG", "Facet catalog and durable config store", "completed", ["DRV-EVENTS", "DRV-KERNEL", "DRV-PRIVACY"], "Phase 0 · DRV-PLATFORM-CONFIG"),
	task("DRV-ROOM-MVP", "The smallest room and the joinCall façade", "completed", ["DRV-EVENTS", "DRV-KERNEL", "DRV-PRIVACY"], "Phase 1 · DRV-ROOM-MVP"),
	task("DRV-DRIVE-TAB", "Drive tab (channels + call rooms)", "completed", ["DRV-ROOM-MVP", "DRV-EVENTS"], "Phase 1 · DRV-DRIVE-TAB"),
	task("DRV-ROSTER", "Agent roster as participants", "in_progress", ["DRV-ROOM-MVP", "DRV-EVENTS", "DRV-DRIVE-TAB"], "Phase 1 · DRV-ROSTER"),
	task("DRV-AGENT-PROFILE", "Agent display name and two ink channels", "in_progress", ["DRV-ROSTER", "DRV-EVENTS", "DRV-PLATFORM-CONFIG"], "Phase 1 · DRV-AGENT-PROFILE"),
	task("DRV-PARTICIPANT-SHEET", "Transcript vs profile on roster click", "pending", ["DRV-ROSTER", "DRV-AGENT-PROFILE"], "Phase 1 · DRV-PARTICIPANT-SHEET"),
	task("DRV-DRIVEAGENT-HOME", "`.driveagent/<slug>/` agent home", "pending", ["DRV-PLATFORM-CONFIG", "DRV-AGENT-PROFILE"], "Phase 1 · DRV-DRIVEAGENT-HOME"),
	task("DRV-TOGGLE", "Chat Join call (shortcut into Drive room)", "completed", ["DRV-ROOM-MVP", "DRV-DRIVE-TAB", "DRV-EVENTS"], "Phase 1 · DRV-TOGGLE"),
	task("DRV-PERSONA-CHIP", "Partner presence chip", "pending", ["DRV-ROOM-MVP", "DRV-TOGGLE", "DRV-EVENTS"], "Phase 1 · DRV-PERSONA-CHIP"),
	task("DRV-NARRATION", "Narration messages in the feed", "in_progress", ["DRV-KERNEL", "DRV-ROOM-MVP", "DRV-TOGGLE", "DRV-EVENTS"], "Phase 1 · DRV-NARRATION"),
	task("DRV-MODE-OVERLAY", "Ask/debug overlays on the mode pill", "in_progress", ["DRV-KERNEL", "DRV-HOOK-POLICY", "DRV-ROOM-MVP", "DRV-TOGGLE"], "Phase 1 · DRV-MODE-OVERLAY"),
	task("DRV-TASK-BANK", "Task bank and Drive loop", "in_progress", ["DRV-EVENTS", "DRV-HOOK-POLICY", "DRV-KERNEL", "DRV-MODE-OVERLAY"], "Phase 1 · DRV-TASK-BANK"),
	task("DRV-LEAVE-END", "Leave the call, end the session", "pending", ["DRV-ROOM-MVP", "DRV-NARRATION"], "Phase 1 · DRV-LEAVE-END"),
	task("DRV-PARTNER-MVP", "One pair partner, end to end", "in_progress", ["DRV-ROOM-MVP", "DRV-DRIVE-TAB", "DRV-ROSTER", "DRV-TOGGLE", "DRV-PERSONA-CHIP", "DRV-NARRATION", "DRV-MODE-OVERLAY", "DRV-LEAVE-END"], "Phase 1 · DRV-PARTNER-MVP"),
	task("DRV-GATES", "High-impact approval and policy blocks", "pending", ["DRV-EVENTS", "DRV-HOOK-POLICY", "DRV-PRIVACY", "DRV-ROOM-MVP"], "Phase 1 · DRV-GATES"),
	task("DRV-SDLC-GUIDE", "Senior engineering leadership on the call", "pending", ["DRV-KERNEL", "DRV-NARRATION", "DRV-DRIVEAGENT-HOME"], "Phase 1 · DRV-SDLC-GUIDE"),
	task("DRV-STAGE", "The Call Stage", "completed", ["DRV-ROOM-MVP", "DRV-DRIVE-TAB", "DRV-PARTNER-MVP", "DRV-EVENTS"], "Phase 2 · DRV-STAGE"),
	task("DRV-SHARE", "Bidirectional stage share", "completed", ["DRV-STAGE", "DRV-ROOM-MVP", "DRV-DRIVE-TAB"], "Phase 2 · DRV-SHARE"),
	task("DRV-TRANSCRIPT", "Room transcript vs per-agent focus", "pending", ["DRV-PARTNER-MVP", "DRV-ROSTER", "DRV-DRIVE-TAB"], "Phase 2 · DRV-TRANSCRIPT"),
	task("DRV-ADDRESS", "Address set (one / many / everyone)", "pending", ["DRV-ROOM-MVP", "DRV-ROSTER", "DRV-EVENTS"], "Phase 2 · DRV-ADDRESS"),
	task("DRV-ROSTER-PACK", "Curated roster presets, added to a call in one action", "pending", ["DRV-ROSTER", "DRV-ROOM-MVP", "DRV-PLATFORM-CONFIG"], "Phase 2 · DRV-ROSTER-PACK"),
	task("DRV-CALL-STRIP", "Pinned call controls", "in_progress", ["DRV-ROOM-MVP", "DRV-STAGE"], "Phase 2 · DRV-CALL-STRIP"),
	task("DRV-NOWNEXT", "Now/next plan cursor strip", "pending", ["DRV-STAGE", "DRV-NARRATION", "DRV-EVENTS"], "Phase 2 · DRV-NOWNEXT"),
	task("DRV-STEER-QUEUE", "Steering while the partner works", "in_progress", ["DRV-HOOK-POLICY", "DRV-NARRATION", "DRV-ROOM-MVP"], "Phase 2 · DRV-STEER-QUEUE"),
	task("DRV-INTERRUPT", "Raise hand", "in_progress", ["DRV-KERNEL", "DRV-STEER-QUEUE", "DRV-CALL-STRIP"], "Phase 2 · DRV-INTERRUPT"),
	task("DRV-PIP", "PiP Partner companion widget", "blocked", ["DRV-CALL-STRIP", "DRV-DRIVE-TAB", "DRV-ROOM-MVP", "DRV-TOGGLE"], "Phase 2 · DRV-PIP"),
	task("DRV-SKILL-PORT", "Port the Drive persona and mode skills", "pending", ["DRV-KERNEL", "DRV-MODE-OVERLAY"], "Phase 2 · DRV-SKILL-PORT"),
	task("DRV-AGENT-GRAPH", "Per-agent portfolio knowledge graph", "pending", ["DRV-DRIVEAGENT-HOME", "DRV-PARTICIPANT-SHEET"], "Phase 2 · DRV-AGENT-GRAPH"),
	task("DRV-RECRUIT", "Rank agents (and suggest packs) for a need", "blocked", ["DRV-AGENT-GRAPH", "DRV-ROSTER", "DRV-ROSTER-PACK"], "Phase 2 · DRV-RECRUIT"),
	task("DRV-DEMO-SHARE", "Demo artifact share on the Call Stage", "pending", ["DRV-SHARE", "DRV-STAGE", "DRV-PRIVACY"], "Phase 2 · DRV-DEMO-SHARE"),
	task("DRV-MIC", "Mic input and mute", "pending", ["DRV-CALL-STRIP", "DRV-PARTNER-MVP", "DRV-PRIVACY"], "Phase 3 · DRV-MIC"),
	task("DRV-TTS", "Partner voice out", "pending", ["DRV-CALL-STRIP", "DRV-NARRATION", "DRV-MIC"], "Phase 3 · DRV-TTS"),
	task("DRV-CAPTIONS", "Live captions", "pending", ["DRV-MIC", "DRV-TTS"], "Phase 3 · DRV-CAPTIONS"),
	task("DRV-CLI-PARITY", "Drive in the TUI", "pending", ["DRV-PARTNER-MVP", "DRV-STAGE"], "Phase 4 · DRV-CLI-PARITY"),
	task("DRV-ISOLATION", "Worktree isolation for multi-agent seats", "pending", ["DRV-ROOM-MVP", "DRV-ROSTER", "DRV-PRIVACY"], "Phase 4 · DRV-ISOLATION"),
	task("DRV-TEAM-OPT", "Optional specialist agents (flagged)", "pending", ["DRV-ISOLATION", "DRV-ROSTER-PACK", "DRV-STAGE"], "Phase 4 · DRV-TEAM-OPT"),
	task("DRV-AGENT-ROUTER", "Route utterances among seated agents", "pending", ["DRV-ADDRESS", "DRV-ROSTER", "DRV-TEAM-OPT"], "Phase 4 · DRV-AGENT-ROUTER"),
];

export const PLAN_DEPENDENCY_DEMO_TEAM: TeamRuntimeState = {
	teamId: "cline-drivemode",
	teamName: "cline-drivemode plans",
	members: [
		{ agentId: "lead", role: "lead", status: "running", description: "Drive planning lead" },
		{ agentId: "drive-team", role: "teammate", status: "running", description: "Feature implementers" },
	],
	tasks: planTasks,
	mailbox: [],
	missionLog: [],
	runs: [],
	outcomes: [],
	outcomeFragments: [],
};

export const PLAN_DEPENDENCY_DEMO_TEAMS: TeamRuntimeState[] = [PLAN_DEPENDENCY_DEMO_TEAM];
