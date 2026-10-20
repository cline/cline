"use client";

import { AgentConversationLayout } from "@cline/ui";
import { useEffect, useMemo, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { ChatInputBar } from "@/components/views/chat/chat-input-bar";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import {
	buildSessionAgentActivity,
	mergeAgentActivity,
	type SessionAgentEntry,
} from "@/lib/session-agents";
import { ChatMessages } from "../chat-messages";
import { TeamPanel, type TeamPanelMember } from "./team-panel";
import {
	buildBeats,
	FINAL_DIFF,
	LEAD,
	PROMPT,
	type SessionKey,
	TEAM_NAME,
	TEAMMATE_IDS,
	TEAMMATES,
	type TeammateId,
	type TeammatePhase,
	TITLE,
} from "./team-script";

/*
 * Scripted preview of an agent team. The lead session and every teammate
 * session replay through the real transcript, the header's agent roster is
 * derived from those transcripts, and opening a teammate behaves like opening
 * a real child session. The team panel attached to the chat input is the one
 * piece that does not exist yet: a live view of what each teammate is doing.
 */

const WORKSPACE_ROOT = "~/code/tidepool";
const WORKSPACE = {
	workspaceRoot: WORKSPACE_ROOT,
	workspaces: [WORKSPACE_ROOT],
	listWorkspaces: async () => [WORKSPACE_ROOT],
	refreshWorkspaces: async () => {},
	switchWorkspace: async () => false,
	pickWorkspaceDirectory: async () => null,
	selectChat: async () => false,
};
const PROMPT_DRAFT = { version: 0, value: "" };
const NO_ATTACHMENTS: [] = [];
const NO_QUEUE: [] = [];
const noop = () => {};
const listBranches = async () => ({
	current: "cline/realtime-sync",
	branches: ["cline/realtime-sync", "main"],
});

function useStoredModel() {
	const [selection, setSelection] = useState(() => {
		const stored = readModelSelectionStorageFromWindow();
		const provider = stored.lastProvider || "cline";
		return { provider, model: stored.lastModelByProvider[provider] ?? "" };
	});
	return {
		...selection,
		setProvider: (provider: string) =>
			setSelection((current) => ({ ...current, provider })),
		setModel: (model: string) =>
			setSelection((current) => ({ ...current, model })),
	};
}

const sessionIdFor = (key: SessionKey) => `team-demo/${key}`;
const keyForSessionId = (sessionId: string): SessionKey | undefined =>
	[LEAD, ...TEAMMATE_IDS].find((key) => sessionIdFor(key) === sessionId);

type SessionState = {
	messages: ChatMessage[];
	status: ChatSessionStatus;
	streamingMessageId: string | null;
	phase?: TeammatePhase;
	step?: string;
	startedAt?: number;
	endedAt?: number;
};

type DemoState = {
	sessions: Record<SessionKey, SessionState>;
	/** Demo clock, which runs faster than playback. */
	now: number;
};

const idleSession = (): SessionState => ({
	messages: [],
	status: "idle",
	streamingMessageId: null,
});

function initialState(now = Date.now()): DemoState {
	const sessions = {
		[LEAD]: { ...idleSession(), status: "starting" },
	} as Record<SessionKey, SessionState>;
	for (const id of TEAMMATE_IDS) sessions[id] = idleSession();
	return { sessions, now };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useTeamPlayback(): DemoState {
	const [state, setState] = useState<DemoState>(() => initialState());

	useEffect(() => {
		let cancelled = false;
		// Timestamps advance faster than playback so durations read like a real run.
		let clock = Date.now() - 20 * 60_000;
		const tick = (ms: number) => {
			clock += ms * 6;
			setState((current) => ({ ...current, now: clock }));
		};
		const message = (
			key: SessionKey,
			id: string,
			role: ChatMessage["role"],
			content: string,
			extra?: Partial<ChatMessage>,
		): ChatMessage => ({
			id,
			sessionId: sessionIdFor(key),
			role,
			content,
			createdAt: clock,
			...extra,
		});
		const update = (
			key: SessionKey,
			next: (session: SessionState) => Partial<SessionState>,
		) =>
			setState((current) => ({
				...current,
				sessions: {
					...current.sessions,
					[key]: { ...current.sessions[key], ...next(current.sessions[key]) },
				},
			}));
		const push = (key: SessionKey, next: ChatMessage) =>
			update(key, (session) => ({ messages: [...session.messages, next] }));
		const replace = (key: SessionKey, next: ChatMessage) =>
			update(key, (session) => ({
				messages: session.messages.map((item) =>
					item.id === next.id ? next : item,
				),
			}));
		const toolMessage = (
			key: SessionKey,
			id: string,
			tool: string,
			input: unknown,
			result: unknown,
		) =>
			message(
				key,
				id,
				"tool",
				JSON.stringify({ toolName: tool, input, result: result ?? null }),
				{
					meta: {
						toolName: tool,
						toolCallId: id,
						...(result == null ? { hookEventName: "tool_call_start" } : {}),
					},
				},
			);

		void (async () => {
			const fresh = initialState(clock);
			fresh.sessions[LEAD].messages = [message(LEAD, "prompt", "user", PROMPT)];
			setState(fresh);

			const open = new Map<string, { key: SessionKey; message: ChatMessage }>();
			let index = 0;
			for (const beat of buildBeats()) {
				await sleep(beat.wait);
				if (cancelled) return;
				tick(beat.wait);
				const key = beat.in;
				const id = `${key}-${index++}`;
				if (beat.phase || beat.step) {
					update(key, (session) => ({
						phase: beat.phase ?? session.phase,
						step: beat.step ?? session.step,
					}));
				}
				if ("note" in beat) continue;
				if ("status" in beat) {
					update(key, () => ({
						status: beat.status,
						...(beat.status === "completed"
							? { phase: "done" as const, endedAt: clock }
							: {}),
					}));
				} else if ("start" in beat) {
					const teammate = TEAMMATES[key as TeammateId];
					push(key, message(key, id, "user", teammate.task));
					update(key, () => ({ status: "running", startedAt: clock }));
				} else if ("say" in beat) {
					if (beat.thinkMs) clock += beat.thinkMs;
					const reasoning = beat.reasoning
						? { reasoning: beat.reasoning }
						: undefined;
					if (!beat.stream) {
						push(key, message(key, id, "assistant", beat.say, reasoning));
						continue;
					}
					const words = beat.say.split(/(?<=\s)/);
					push(key, message(key, id, "assistant", "", reasoning));
					update(key, () => ({ streamingMessageId: id }));
					for (let count = 4; count < words.length + 4; count += 4) {
						await sleep(40);
						if (cancelled) return;
						replace(
							key,
							message(
								key,
								id,
								"assistant",
								words.slice(0, count).join(""),
								reasoning,
							),
						);
					}
					update(key, () => ({ streamingMessageId: null }));
				} else if ("tool" in beat) {
					const started = toolMessage(key, id, beat.tool, beat.input, null);
					push(key, started);
					if (beat.ref) {
						open.set(beat.ref, { key, message: started });
						continue;
					}
					await sleep(beat.runMs ?? 300);
					if (cancelled) return;
					tick(beat.runMs ?? 300);
					replace(
						key,
						toolMessage(key, id, beat.tool, beat.input, beat.result),
					);
				} else {
					const pending = open.get(beat.complete);
					if (!pending) continue;
					open.delete(beat.complete);
					const payload = JSON.parse(pending.message.content) as {
						toolName: string;
						input: unknown;
					};
					replace(
						pending.key,
						toolMessage(
							pending.key,
							pending.message.id,
							payload.toolName,
							payload.input,
							beat.result,
						),
					);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}

function rosterOf(state: DemoState): SessionAgentEntry[] {
	return TEAMMATE_IDS.flatMap((id) => {
		const session = state.sessions[id];
		if (!session.startedAt) return [];
		const teammate = TEAMMATES[id];
		return [
			{
				sessionId: sessionIdFor(id),
				agentId: id,
				kind: "teamtask" as const,
				status: session.status === "completed" ? "completed" : "running",
				prompt: teammate.title,
				lastAction: session.step,
				teamName: TEAM_NAME,
				startedAt: new Date(session.startedAt).toISOString(),
				hasMessages: session.messages.length > 0,
			},
		];
	});
}

function panelMembersOf(state: DemoState): TeamPanelMember[] {
	return TEAMMATE_IDS.flatMap((id) => {
		const session = state.sessions[id];
		if (!session.startedAt) return [];
		return [
			{
				id,
				title: TEAMMATES[id].title,
				phase: session.phase ?? "planning",
				step: session.step,
				startedAt: session.startedAt,
				endedAt: session.endedAt,
			},
		];
	});
}

const isActive = (status: ChatSessionStatus) =>
	status === "starting" || status === "running" || status === "stopping";

export function TeamDemo({ onExit }: { onExit: () => void }) {
	const [view, setView] = useState<SessionKey>(LEAD);
	const state = useTeamPlayback();
	const stored = useStoredModel();
	const lead = state.sessions[LEAD];
	const session = state.sessions[view];
	const leadCompleted = lead.status === "completed";

	const agents = useMemo(() => rosterOf(state), [state]);
	const members = useMemo(() => panelMembersOf(state), [state]);
	const agentActivity = useMemo(
		() =>
			mergeAgentActivity(
				agents,
				buildSessionAgentActivity(lead.messages, {
					sessionActive: isActive(lead.status),
				}),
				{ sessionActive: isActive(lead.status) },
			),
		[agents, lead.messages, lead.status],
	);

	const toolCalls = lead.messages.filter((m) => m.role === "tool").length;
	const summary = useMemo(
		() => ({
			toolCalls,
			tokensIn: 18_400 + toolCalls * 2_150,
			tokensOut: 2_100 + toolCalls * 340,
			cacheReadTokens: 9_800 + toolCalls * 1_600,
		}),
		[toolCalls],
	);

	const openSession = (sessionId: string) => {
		const key = keyForSessionId(sessionId);
		if (key) setView(key);
	};

	return (
		<div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
			<WindowTitleBarContent>
				<div className="cline-view-enter z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
					{view === LEAD ? (
						<AgentHeader
							agentActivity={agentActivity}
							agents={agents}
							diff={leadCompleted ? FINAL_DIFF : undefined}
							onNewThread={onExit}
							onOpenAgentSession={openSession}
							status={lead.status}
							title={TITLE}
						/>
					) : (
						<AgentHeader
							onOpenParentSession={openSession}
							parentSession={{ sessionId: sessionIdFor(LEAD), title: TITLE }}
							status={session.status}
							title={TEAMMATES[view].title}
						/>
					)}
				</div>
			</WindowTitleBarContent>
			<AgentConversationLayout
				body={
					<ChatMessages
						chatTransportState="connected"
						error={null}
						key={view}
						messages={session.messages}
						onAnswerAskQuestion={() => {}}
						onApproveToolApproval={() => {}}
						onRejectToolApproval={() => {}}
						pendingAskQuestions={[]}
						pendingToolApprovals={[]}
						sessionId={sessionIdFor(view)}
						status={session.status}
						streamingMessageId={session.streamingMessageId}
					/>
				}
				bodyClassName="cline-view-enter"
				composer={
					<WorkspaceProvider value={WORKSPACE}>
						<ChatInputBar
							aboveInput={
								<TeamPanel
									activeId={view === LEAD ? undefined : view}
									members={members}
									name={TEAM_NAME}
									now={state.now}
									onOpen={(id) => setView(id as TeammateId)}
								/>
							}
							attachments={NO_ATTACHMENTS}
							environmentId="local"
							gitBranch="cline/realtime-sync"
							hasActiveSession
							hasRunningAgents={agentActivity.running > 0}
							mode="act"
							model={stored.model}
							onAbort={noop}
							onAttachFiles={noop}
							onEditPromptInQueue={noop}
							onListGitBranches={listBranches}
							onModeToggle={noop}
							onModelChange={stored.setModel}
							onPromptInputChange={noop}
							onProviderChange={stored.setProvider}
							onReasoningChange={noop}
							onRemoveAttachment={noop}
							onRemovePromptInQueue={noop}
							onSend={noop}
							onSteerPromptInQueue={noop}
							onSwitchGitBranch={async () => false}
							placeholder={
								view === LEAD
									? undefined
									: `Message ${view}, or type / for commands`
							}
							promptDraft={PROMPT_DRAFT}
							promptsInQueue={NO_QUEUE}
							provider={stored.provider}
							reasoningEffort="medium"
							status={session.status}
							summary={summary}
							thinking={true}
							variant="conversation"
						/>
					</WorkspaceProvider>
				}
				welcome={false}
			/>
		</div>
	);
}
