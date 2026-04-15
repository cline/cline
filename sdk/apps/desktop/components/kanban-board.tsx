"use client";

import { formatDisplayUserInput } from "@clinebot/shared";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardHeader } from "@/components/board-header";
import { KanbanColumn } from "@/components/kanban-column";
import {
	type Agent,
	COLUMNS,
	createNewAgent,
	type FileDiff,
} from "@/lib/agent-data";
import { summarizeSessionReason } from "@/lib/parse";
import type {
	AgentStatus,
	CliDiscoveredSession,
	ProcessContext,
	SessionEndedEvent,
	SessionHookEvent,
	StartSessionRequest,
	StreamChunkEvent,
} from "@/lib/session-types";
import { cn } from "@/lib/utils";

function columnDotColor(status: AgentStatus): string {
	switch (status) {
		case "queued":
			return "bg-muted-foreground";
		case "running":
			return "bg-primary";
		case "completed":
			return "bg-success";
		case "failed":
			return "bg-destructive";
		case "cancelled":
			return "bg-warning";
	}
}

function toStartSessionRequest(agent: Agent): StartSessionRequest {
	return {
		workspaceRoot: agent.workspaceRoot,
		cwd: agent.cwd,
		provider: agent.provider,
		model: agent.model,
		apiKey: agent.apiKey ?? "",
		prompt: agent.prompt,
		systemPrompt: agent.systemPrompt,
		maxIterations: agent.maxIterations,
		enableTools: agent.enableTools,
		enableSpawn: agent.enableSpawn,
		enableTeams: agent.enableTeams,
		autoApproveTools: agent.autoApproveTools ?? true,
		teamName: agent.teamName,
		missionStepInterval: 3,
		missionTimeIntervalMs: 120000,
	};
}

function normalizeDiscoveredStatus(status: string): AgentStatus {
	const normalized = status.toLowerCase();
	if (normalized.includes("complete")) return "completed";
	if (normalized.includes("cancel")) return "cancelled";
	if (normalized.includes("fail")) return "failed";
	if (normalized.includes("error")) return "failed";
	if (normalized.includes("stop")) return "completed";
	if (normalized.includes("done")) return "completed";
	if (normalized.includes("success")) return "completed";
	if (normalized.includes("idle")) return "running";
	if (normalized.includes("run")) return "running";
	return "queued";
}

function normalizePromptPreview(value: string | undefined): string {
	if (!value) {
		return "";
	}
	return formatDisplayUserInput(value).trim();
}

function deriveDiscoveredDisplayName(session: CliDiscoveredSession): string {
	const backendTitle = session.title?.trim();
	if (backendTitle) {
		return backendTitle.slice(0, 80);
	}
	const promptLine = normalizePromptPreview(session.prompt)
		.split("\n")[0]
		?.trim();
	if (promptLine) {
		return promptLine.slice(0, 60);
	}
	if (session.isSubagent) {
		return `Subagent ${session.agentId?.slice(-6) || session.sessionId.slice(-6)}`;
	}
	return `Session ${session.sessionId.slice(-6)}`;
}

function hookEventNameOf(event: SessionHookEvent): string {
	return (event.hookEventName ?? event.hookName ?? "").toLowerCase();
}

function sumHookTokens(events: SessionHookEvent[]): number {
	return events.reduce(
		(total, event) =>
			total + (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
		0,
	);
}

function sanitizeSessionToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function makeSubSessionId(rootSessionId: string, agentId: string): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const joined = `${root}__${agent}`;
	return joined.length > 180 ? joined.slice(0, 180) : joined;
}

function deriveSubagentStatus(events: SessionHookEvent[]): AgentStatus {
	if (events.length === 0) {
		return "running";
	}
	const last = events[events.length - 1];
	const lastHookName = hookEventNameOf(last);
	if (lastHookName === "agent_end") {
		return "completed";
	}
	if (lastHookName === "session_shutdown") {
		const reason = (last.toolName || "").toLowerCase();
		if (
			reason.includes("cancel") ||
			reason.includes("abort") ||
			reason.includes("interrupt")
		) {
			return "cancelled";
		}
		return "failed";
	}
	return "running";
}

function formatDisplayTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value
			.replace("T", " ")
			.replace("Z", "")
			.replace(/\.\d+$/, "");
	}
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
		date.getMinutes(),
	)}:${pad(date.getSeconds())}`;
}

function nowDisplayTimestamp(): string {
	return formatDisplayTimestamp(new Date().toISOString());
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function countAddedLines(value: string | undefined): number {
	if (!value) {
		return 0;
	}
	return value.split("\n").filter((line) => line.length > 0).length;
}

function parseDiffFromEditorResult(
	resultText: string,
): Pick<FileDiff, "additions" | "deletions" | "hunks"> {
	const lines = resultText.split("\n");
	const startIdx = lines.findIndex((line) => line.trim() === "```diff");
	if (startIdx < 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}
	const endIdx = lines.findIndex(
		(line, idx) => idx > startIdx && line.trim() === "```",
	);
	const body = lines.slice(
		startIdx + 1,
		endIdx > startIdx ? endIdx : undefined,
	);

	const old: string[] = [];
	const next: string[] = [];
	let additions = 0;
	let deletions = 0;
	let oldStart: number | undefined;
	let newStart: number | undefined;

	for (const raw of body) {
		const match = raw.match(/^([+-])(\d+):\s?(.*)$/);
		if (!match) {
			continue;
		}
		const op = match[1];
		const lineNo = Number.parseInt(match[2], 10);
		const text = match[3] ?? "";
		if (op === "-") {
			deletions += 1;
			old.push(text);
			oldStart = oldStart ?? lineNo;
			continue;
		}
		additions += 1;
		next.push(text);
		newStart = newStart ?? lineNo;
	}

	if (additions + deletions === 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}

	return {
		additions,
		deletions,
		hunks: [
			{
				oldStart: oldStart ?? 1,
				newStart: newStart ?? 1,
				old: old.join("\n"),
				new: next.join("\n"),
			},
		],
	};
}

function parseEditorFileDiff(event: SessionHookEvent): FileDiff | null {
	if (
		hookEventNameOf(event) !== "tool_result" ||
		event.toolName !== "editor" ||
		event.toolError
	) {
		return null;
	}

	const input = asRecord(event.toolInput);
	const output = asRecord(event.toolOutput);
	if (!input || !output) {
		return null;
	}
	if (output.success === false) {
		return null;
	}

	const command = toStringValue(input.command);
	const pathFromInput = toStringValue(input.path);
	const query = toStringValue(output.query);
	const pathFromQuery = query?.includes(":")
		? query.split(":").slice(1).join(":")
		: undefined;
	const path = pathFromInput || pathFromQuery;
	if (!path) {
		return null;
	}

	if (command === "str_replace") {
		const parsed = parseDiffFromEditorResult(
			toStringValue(output.result) ?? "",
		);
		return {
			path,
			additions: parsed.additions,
			deletions: parsed.deletions,
			hunks: parsed.hunks,
			committed: false,
		};
	}

	if (command === "create" || command === "insert") {
		const newContent =
			toStringValue(input.file_text) ?? toStringValue(input.new_str) ?? "";
		return {
			path,
			additions: countAddedLines(newContent),
			deletions: 0,
			hunks: newContent
				? [
						{
							oldStart: 1,
							newStart: 1,
							old: "",
							new: newContent,
						},
					]
				: [],
			committed: false,
		};
	}

	return null;
}

function mergeEditorDiffs(
	events: SessionHookEvent[],
	previous: FileDiff[],
): { fileDiffs: FileDiff[]; currentFile?: string } {
	const previousCommitted = new Set(
		previous.filter((diff) => diff.committed).map((diff) => diff.path),
	);
	const byPath = new Map<string, FileDiff>();
	let currentFile: string | undefined;

	for (const event of events) {
		const diff = parseEditorFileDiff(event);
		if (!diff) {
			continue;
		}
		currentFile = diff.path;
		const existing = byPath.get(diff.path);
		if (!existing) {
			byPath.set(diff.path, {
				...diff,
				committed: previousCommitted.has(diff.path),
			});
			continue;
		}
		byPath.set(diff.path, {
			...existing,
			additions: existing.additions + diff.additions,
			deletions: existing.deletions + diff.deletions,
			hunks: [...existing.hunks, ...diff.hunks].slice(-30),
			committed: existing.committed,
		});
	}

	return {
		fileDiffs: Array.from(byPath.values()),
		currentFile,
	};
}

export function KanbanBoard() {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [defaultWorkspaceRoot, setDefaultWorkspaceRoot] = useState("");
	const [defaultCwd, setDefaultCwd] = useState("");
	const [isRefreshing, setIsRefreshing] = useState(false);
	const agentsRef = useRef<Agent[]>([]);
	const refreshInFlightRef = useRef<Promise<void> | null>(null);
	const hydratedSessionMetricsRef = useRef<Set<string>>(new Set());
	const suppressedSessionIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		agentsRef.current = agents;
	}, [agents]);

	useEffect(() => {
		let active = true;
		invoke<ProcessContext>("get_process_context")
			.then((context) => {
				if (!active) {
					return;
				}
				setDefaultWorkspaceRoot(context.workspaceRoot);
				setDefaultCwd(context.cwd || context.workspaceRoot);
			})
			.catch(() => {
				// Running in plain web mode without tauri backend.
			});

		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		let unlistenChunk: UnlistenFn | undefined;
		let unlistenEnded: UnlistenFn | undefined;

		listen<StreamChunkEvent>("agent://chunk", (event) => {
			const payload = event.payload;
			if (!payload) {
				return;
			}
			setAgents((prev) =>
				prev.map((agent) => {
					if (agent.sessionId !== payload.sessionId) {
						return agent;
					}
					const lines = payload.chunk
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
					const nextLogs = [...agent.logs, ...lines].slice(-80);

					return {
						...agent,
						logs: nextLogs,
						status:
							agent.status === "completed" ||
							agent.status === "failed" ||
							agent.status === "cancelled"
								? agent.status
								: "running",
						progress: Math.min(98, Math.max(agent.progress, 5)),
						tasks: agent.tasks.map((task, index) => {
							if (index === 0) {
								return {
									...task,
									status:
										agent.status === "completed" ||
										agent.status === "failed" ||
										agent.status === "cancelled"
											? task.status
											: "running",
									progress: Math.max(task.progress, 5),
									startedAt: task.startedAt ?? nowDisplayTimestamp(),
								};
							}
							return task;
						}),
					};
				}),
			);
		}).then((fn) => {
			unlistenChunk = fn;
		});

		listen<SessionEndedEvent>("agent://session-ended", (event) => {
			const payload = event.payload;
			if (!payload) {
				return;
			}
			suppressedSessionIdsRef.current.add(payload.sessionId);
			setAgents((prev) =>
				prev.map((agent) => {
					if (agent.sessionId !== payload.sessionId) {
						return agent;
					}
					const finalStatus = summarizeSessionReason(payload.reason);
					return {
						...agent,
						status: finalStatus,
						progress:
							finalStatus === "completed" ? 100 : Math.max(agent.progress, 10),
						completedAt: nowDisplayTimestamp(),
						logs: [...agent.logs, payload.reason].slice(-100),
						tasks: agent.tasks.map((task) => ({
							...task,
							status:
								finalStatus === "completed"
									? "completed"
									: finalStatus === "cancelled"
										? "cancelled"
										: task.status === "completed"
											? "completed"
											: "failed",
							progress: finalStatus === "completed" ? 100 : task.progress,
							completedAt: nowDisplayTimestamp(),
						})),
					};
				}),
			);

			void invoke<SessionHookEvent[]>("read_session_hooks", {
				sessionId: payload.sessionId,
				limit: 800,
			})
				.then((events) => {
					const tokensUsed = sumHookTokens(events);
					const hookEvents = events.length;
					setAgents((prev) =>
						prev.map((agent) => {
							if (agent.sessionId !== payload.sessionId) {
								return agent;
							}
							const diffState = mergeEditorDiffs(events, agent.fileDiffs);
							return {
								...agent,
								tokensUsed,
								hookEvents: Math.max(agent.hookEvents, hookEvents),
								fileDiffs: diffState.fileDiffs,
								filesModified: diffState.fileDiffs.length,
								currentFile: diffState.currentFile ?? agent.currentFile,
							};
						}),
					);
				})
				.catch(() => {
					// Ignore unavailable command in non-tauri mode.
				});
		}).then((fn) => {
			unlistenEnded = fn;
		});

		return () => {
			if (unlistenChunk) {
				unlistenChunk();
			}
			if (unlistenEnded) {
				unlistenEnded();
			}
		};
	}, []);

	const refreshSessions = useCallback(
		(options?: { force?: boolean }): Promise<void> => {
			const force = options?.force === true;
			if (force) {
				refreshInFlightRef.current = null;
				hydratedSessionMetricsRef.current.clear();
			}

			if (refreshInFlightRef.current) {
				return refreshInFlightRef.current;
			}

			const refreshPromise = (async () => {
				const listPromise = invoke<CliDiscoveredSession[]>(
					"list_cli_sessions",
					{
						limit: 300,
					},
				)
					.then(async (sessions) => {
						const discoveredById = new Map(
							sessions
								.map((session) => [session.sessionId?.trim(), session] as const)
								.filter((entry): entry is [string, CliDiscoveredSession] =>
									Boolean(entry[0]),
								),
						);
						for (const sessionId of [...suppressedSessionIdsRef.current]) {
							const discovered = discoveredById.get(sessionId);
							if (!discovered) {
								suppressedSessionIdsRef.current.delete(sessionId);
								continue;
							}
							if (normalizeDiscoveredStatus(discovered.status) !== "running") {
								suppressedSessionIdsRef.current.delete(sessionId);
							}
						}

						setAgents((prev) => {
							const next = force
								? prev.filter((agent) => !agent.sessionId)
								: [...prev];
							for (const session of sessions) {
								const sessionId = session.sessionId?.trim();
								if (!sessionId) {
									continue;
								}
								const idx = next.findIndex(
									(agent) => agent.sessionId === sessionId,
								);
								const status = normalizeDiscoveredStatus(session.status);
								const isSuppressedRunning =
									suppressedSessionIdsRef.current.has(sessionId) &&
									status === "running";
								if (idx >= 0) {
									const current = next[idx];
									if (isSuppressedRunning) {
										continue;
									}
									const nextProgress =
										status === "completed"
											? 100
											: status === "running"
												? Math.min(current.progress, 95)
												: current.progress;
									next[idx] = {
										...current,
										name:
											current.prompt?.trim().length ||
											!session.prompt?.trim().length
												? current.name
												: deriveDiscoveredDisplayName(session),
										status,
										model: session.model || current.model,
										provider: session.provider || current.provider,
										workspaceRoot:
											session.workspaceRoot || current.workspaceRoot,
										cwd: session.cwd || current.cwd,
										teamName: session.teamName ?? current.teamName,
										parentSessionId:
											session.parentSessionId ?? current.parentSessionId,
										parentAgentId:
											session.parentAgentId ?? current.parentAgentId,
										agentId: session.agentId ?? current.agentId,
										conversationId:
											session.conversationId ?? current.conversationId,
										isSubagent: session.isSubagent ?? current.isSubagent,
										prompt: session.prompt ?? current.prompt,
										startedAt:
											formatDisplayTimestamp(session.startedAt) ||
											current.startedAt,
										completedAt:
											status === "running"
												? undefined
												: formatDisplayTimestamp(session.endedAt) ||
													current.completedAt,
										progress: nextProgress,
									};
									continue;
								}
								if (isSuppressedRunning) {
									continue;
								}

								const displayName = deriveDiscoveredDisplayName(session);
								next.push(
									createNewAgent({
										name: displayName,
										type: session.isSubagent
											? "Subagent Task"
											: session.interactive
												? "CLI Interactive"
												: "CLI Task",
										model: session.model || "unknown",
										provider: session.provider || "anthropic",
										branch: "",
										taskNames: [
											session.prompt?.trim() ||
												(session.isSubagent
													? "Imported subagent task"
													: "Imported external CLI session"),
										],
										workspaceRoot:
											session.workspaceRoot ||
											defaultWorkspaceRoot ||
											session.cwd ||
											".",
										cwd: session.cwd || defaultCwd || ".",
										teamName: session.teamName || "cli-team",
										enableTools: true,
										enableSpawn: true,
										enableTeams: true,
										prompt: session.prompt || "",
									}),
								);
								const newIndex = next.length - 1;
								next[newIndex] = {
									...next[newIndex],
									sessionId,
									parentSessionId: session.parentSessionId,
									parentAgentId: session.parentAgentId,
									agentId: session.agentId,
									conversationId: session.conversationId,
									isSubagent: session.isSubagent,
									status,
									startedAt:
										formatDisplayTimestamp(session.startedAt) ||
										next[newIndex].startedAt,
									completedAt:
										formatDisplayTimestamp(session.endedAt) || undefined,
									logs: [`Imported from CLI registry: ${sessionId}`],
								};
							}
							return next;
						});

						const sessionsToHydrate = sessions
							.map((session) => session.sessionId?.trim())
							.filter((sessionId): sessionId is string => Boolean(sessionId))
							.filter(
								(sessionId) =>
									!hydratedSessionMetricsRef.current.has(sessionId),
							);

						if (sessionsToHydrate.length === 0) {
							return;
						}

						await Promise.allSettled(
							sessionsToHydrate.map((sessionId) =>
								invoke<SessionHookEvent[]>("read_session_hooks", {
									sessionId,
									limit: 800,
								})
									.then((events) => {
										const tokensUsed = sumHookTokens(events);
										setAgents((prev) =>
											prev.map((agent) =>
												agent.sessionId === sessionId
													? (() => {
															const diffState = mergeEditorDiffs(
																events,
																agent.fileDiffs,
															);
															return {
																...agent,
																hookEvents: Math.max(
																	agent.hookEvents,
																	events.length,
																),
																tokensUsed: Math.max(
																	agent.tokensUsed,
																	tokensUsed,
																),
																fileDiffs: diffState.fileDiffs,
																filesModified: diffState.fileDiffs.length,
																currentFile:
																	diffState.currentFile ?? agent.currentFile,
															};
														})()
													: agent,
											),
										);
									})
									.finally(() => {
										hydratedSessionMetricsRef.current.add(sessionId);
									}),
							),
						);
					})
					.catch((error) => {
						const message =
							error instanceof Error ? error.message : String(error);
						console.error(`Failed to discover CLI sessions: ${message}`);
					});

				const runningSessions = agentsRef.current
					.filter((agent) => agent.status === "running" && agent.sessionId)
					.map((agent) => agent.sessionId as string);

				if (runningSessions.length === 0) {
					await listPromise;
					return;
				}

				const pollPromise = invoke("poll_sessions").catch(() => {
					// Ignore failures when not in tauri runtime.
				});

				const transcriptPromises = runningSessions.map((sessionId) =>
					invoke<string>("read_session_transcript", {
						sessionId,
						maxChars: 12000,
					})
						.then((transcript) => {
							const lines = transcript
								.split("\n")
								.map((line) => line.trim())
								.filter(Boolean)
								.slice(-80);
							if (lines.length === 0) {
								return;
							}
							setAgents((prev) =>
								prev.map((agent) =>
									agent.sessionId === sessionId
										? {
												...agent,
												logs: lines,
											}
										: agent,
								),
							);
						})
						.catch(() => {
							// No transcript yet.
						}),
				);

				const hookPromises = runningSessions.map((sessionId) =>
					invoke<SessionHookEvent[]>("read_session_hooks", {
						sessionId,
						limit: 400,
					})
						.then((events) => {
							const toolCalls = events.filter(
								(event) => hookEventNameOf(event) === "tool_call",
							).length;
							const tokensUsed = sumHookTokens(events);
							const subagentEventMap = new Map<string, SessionHookEvent[]>();
							for (const event of events) {
								if (!event.parentAgentId || !event.agentId) {
									continue;
								}
								const bucket = subagentEventMap.get(event.agentId) ?? [];
								bucket.push(event);
								subagentEventMap.set(event.agentId, bucket);
							}

							setAgents((prev) => {
								const next = prev.map((agent) => {
									if (agent.sessionId !== sessionId) {
										return agent;
									}
									const nextProgress = Math.min(95, 5 + toolCalls * 7);
									const runningProgress =
										agent.status === "running"
											? Math.min(agent.progress, 95)
											: agent.progress;
									const diffState = mergeEditorDiffs(events, agent.fileDiffs);
									return {
										...agent,
										hookEvents: events.length,
										tokensUsed,
										fileDiffs: diffState.fileDiffs,
										filesModified: diffState.fileDiffs.length,
										currentFile: diffState.currentFile ?? agent.currentFile,
										progress: Math.max(runningProgress, nextProgress),
										tasks: agent.tasks.map((task, index) => {
											if (index !== 0) {
												return task;
											}
											return {
												...task,
												status:
													agent.status === "running" ? "running" : task.status,
												progress: Math.max(task.progress, nextProgress),
												startedAt: task.startedAt ?? nowDisplayTimestamp(),
											};
										}),
									};
								});

								const parentAgent = next.find(
									(agent) => agent.sessionId === sessionId,
								);
								for (const [
									agentId,
									subagentEvents,
								] of subagentEventMap.entries()) {
									const subSessionId = makeSubSessionId(sessionId, agentId);
									const subagentStatus = deriveSubagentStatus(subagentEvents);
									const subagentTokensUsed = sumHookTokens(subagentEvents);
									const subagentToolCalls = subagentEvents.filter(
										(event) => hookEventNameOf(event) === "tool_call",
									).length;
									const subagentProgress =
										subagentStatus === "completed"
											? 100
											: subagentStatus === "running"
												? Math.min(95, 5 + subagentToolCalls * 7)
												: Math.max(15, 5 + subagentToolCalls * 7);
									const latestEvent = subagentEvents[subagentEvents.length - 1];
									const idx = next.findIndex(
										(agent) => agent.sessionId === subSessionId,
									);

									if (idx >= 0) {
										const current = next[idx];
										next[idx] = {
											...current,
											status: subagentStatus,
											progress: Math.max(current.progress, subagentProgress),
											completedAt:
												subagentStatus === "running"
													? undefined
													: (current.completedAt ?? nowDisplayTimestamp()),
											parentSessionId: sessionId,
											parentAgentId:
												latestEvent.parentAgentId ?? current.parentAgentId,
											agentId,
											conversationId:
												latestEvent.conversationId ?? current.conversationId,
											isSubagent: true,
											hookEvents: subagentEvents.length,
											tokensUsed: Math.max(
												current.tokensUsed,
												subagentTokensUsed,
											),
										};
										continue;
									}

									const name = `Subagent ${agentId.slice(-6)}`;
									next.push(
										createNewAgent({
											name,
											type: "Subagent Task",
											model: parentAgent?.model || "unknown",
											provider: parentAgent?.provider || "anthropic",
											branch: "",
											taskNames: ["Imported subagent task"],
											workspaceRoot:
												parentAgent?.workspaceRoot ||
												defaultWorkspaceRoot ||
												".",
											cwd: parentAgent?.cwd || defaultCwd || ".",
											teamName: parentAgent?.teamName || "cli-team",
											enableTools: parentAgent?.enableTools ?? true,
											enableSpawn: parentAgent?.enableSpawn ?? true,
											enableTeams: parentAgent?.enableTeams ?? true,
											prompt: "Imported subagent task",
										}),
									);
									const newIndex = next.length - 1;
									next[newIndex] = {
										...next[newIndex],
										sessionId: subSessionId,
										parentSessionId: sessionId,
										parentAgentId: latestEvent.parentAgentId,
										agentId,
										conversationId: latestEvent.conversationId,
										isSubagent: true,
										status: subagentStatus,
										progress: subagentProgress,
										hookEvents: subagentEvents.length,
										tokensUsed: subagentTokensUsed,
										logs: [
											`Imported subagent from hook events: ${subSessionId}`,
										],
									};
								}
								return next;
							});
						})
						.catch(() => {
							// Ignore unavailable command in non-tauri mode.
						}),
				);

				await Promise.allSettled([
					listPromise,
					pollPromise,
					...transcriptPromises,
					...hookPromises,
				]);
			})();

			refreshInFlightRef.current = refreshPromise.finally(() => {
				refreshInFlightRef.current = null;
			});
			return refreshInFlightRef.current;
		},
		[defaultCwd, defaultWorkspaceRoot],
	);

	useEffect(() => {
		refreshSessions();
		const timer = setInterval(refreshSessions, 1200);
		return () => clearInterval(timer);
	}, [refreshSessions]);

	const handleRefresh = useCallback(() => {
		if (isRefreshing) {
			return;
		}
		setIsRefreshing(true);
		void refreshSessions({ force: true }).finally(() => setIsRefreshing(false));
	}, [isRefreshing, refreshSessions]);

	const handleCreateAgent = useCallback(
		(data: {
			name: string;
			type: string;
			model: string;
			provider: string;
			branch: string;
			taskNames: string[];
			workspaceRoot: string;
			cwd: string;
			teamName: string;
			enableTools: boolean;
			enableSpawn: boolean;
			enableTeams: boolean;
			autoApproveTools?: boolean;
			prompt: string;
			apiKey?: string;
			systemPrompt?: string;
			maxIterations?: number;
		}) => {
			const agent = createNewAgent(data);
			setAgents((prev) => [agent, ...prev]);
		},
		[],
	);

	const handleStartAgent = useCallback(
		(id: string) => {
			setAgents((prev) =>
				prev.map((agent) => {
					if (agent.id !== id || agent.status !== "queued") {
						return agent;
					}
					return {
						...agent,
						status: "running",
						startedAt: nowDisplayTimestamp(),
						logs: [...agent.logs, "Starting subprocess..."],
						tasks: agent.tasks.map((task, index) =>
							index === 0
								? {
										...task,
										status: "running",
										progress: 5,
										startedAt: nowDisplayTimestamp(),
									}
								: task,
						),
					};
				}),
			);

			const start = async () => {
				const agent = agents.find((item) => item.id === id);
				if (!agent) {
					return;
				}

				try {
					const request = toStartSessionRequest(agent);
					const sessionId = await invoke<string>("start_session", { request });
					setAgents((prev) =>
						prev.map((item) =>
							item.id === id
								? {
										...item,
										sessionId,
										status: "running",
										logs: [...item.logs, `Session started: ${sessionId}`],
									}
								: item,
						),
					);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					setAgents((prev) =>
						prev.map((item) =>
							item.id === id
								? {
										...item,
										status: "failed",
										completedAt: nowDisplayTimestamp(),
										logs: [...item.logs, `Failed to start: ${message}`],
										tasks: item.tasks.map((task) => ({
											...task,
											status: "failed",
										})),
									}
								: item,
						),
					);
				}
			};

			void start();
		},
		[agents],
	);

	const handleStopAgent = useCallback(
		(id: string) => {
			const agent = agents.find((item) => item.id === id);
			if (!agent?.sessionId) {
				return;
			}

			setAgents((prev) =>
				prev.map((item) =>
					item.id === id
						? {
								...item,
								status: "cancelled",
								completedAt: nowDisplayTimestamp(),
								logs: [...item.logs, "Abort requested from desktop..."],
								tasks: item.tasks.map((task) => ({
									...task,
									status:
										task.status === "completed" ? "completed" : "cancelled",
									completedAt: nowDisplayTimestamp(),
								})),
							}
						: item,
				),
			);
			suppressedSessionIdsRef.current.add(agent.sessionId);

			void invoke("abort_session", { sessionId: agent.sessionId }).catch(
				(error) => {
					const message =
						error instanceof Error ? error.message : String(error);
					suppressedSessionIdsRef.current.delete(agent.sessionId as string);
					setAgents((prev) =>
						prev.map((item) =>
							item.id === id
								? {
										...item,
										status: "running",
										completedAt: undefined,
										logs: [...item.logs, `Stop failed: ${message}`],
										tasks: item.tasks.map((task) => ({
											...task,
											status:
												task.status === "completed" ? "completed" : "running",
											completedAt:
												task.status === "completed"
													? task.completedAt
													: undefined,
										})),
									}
								: item,
						),
					);
				},
			);
		},
		[agents],
	);

	const handleCommitFile = useCallback((agentId: string, filePath: string) => {
		setAgents((prev) =>
			prev.map((agent) => {
				if (agent.id !== agentId) return agent;
				return {
					...agent,
					fileDiffs: agent.fileDiffs.map((diff) =>
						diff.path === filePath ? { ...diff, committed: true } : diff,
					),
					logs: [...agent.logs, `Committed: ${filePath}`],
				};
			}),
		);
	}, []);

	const handleCommitAll = useCallback((agentId: string) => {
		setAgents((prev) =>
			prev.map((agent) => {
				if (agent.id !== agentId) return agent;
				return {
					...agent,
					fileDiffs: agent.fileDiffs.map((diff) => ({
						...diff,
						committed: true,
					})),
					logs: [...agent.logs, "Committed all file diffs"],
				};
			}),
		);
	}, []);

	const handleDeleteAgent = useCallback(
		(id: string) => {
			const agent = agents.find((item) => item.id === id);
			if (!agent || agent.status !== "completed") {
				return;
			}
			const sessionId = agent.sessionId;
			setAgents((prev) => prev.filter((item) => item.id !== id));

			if (!sessionId) {
				return;
			}

			void invoke("delete_cli_session", { sessionId }).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					`Failed to delete persisted history for session ${sessionId}: ${message}`,
				);
			});
		},
		[agents],
	);

	const handleDeleteTerminalAgents = useCallback(() => {
		const removableAgents = agents.filter(
			(agent) =>
				agent.status === "completed" ||
				agent.status === "failed" ||
				agent.status === "cancelled",
		);
		if (removableAgents.length === 0) {
			return;
		}

		const removableIds = new Set(removableAgents.map((agent) => agent.id));
		const sessionIds = removableAgents
			.map((agent) => agent.sessionId)
			.filter((sessionId): sessionId is string => Boolean(sessionId));

		setAgents((prev) => prev.filter((agent) => !removableIds.has(agent.id)));
		for (const sessionId of sessionIds) {
			hydratedSessionMetricsRef.current.delete(sessionId);
		}

		void Promise.allSettled(
			sessionIds.map((sessionId) =>
				invoke("delete_cli_session", { sessionId }).catch((error) => {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(
						`Failed to delete persisted history for session ${sessionId}: ${message}`,
					);
				}),
			),
		);
	}, [agents]);

	const filteredAgents = useMemo(
		() =>
			searchQuery
				? agents.filter(
						(agent) =>
							agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
							agent.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
							agent.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
							agent.branch?.toLowerCase().includes(searchQuery.toLowerCase()),
					)
				: agents,
		[agents, searchQuery],
	);

	const agentsByStatus = useMemo(
		() =>
			COLUMNS.reduce(
				(acc, col) => {
					acc[col.id] =
						col.id === "completed"
							? filteredAgents.filter(
									(agent) =>
										agent.status === "completed" ||
										agent.status === "cancelled",
								)
							: col.id === "failed"
								? filteredAgents.filter((agent) => agent.status === "failed")
								: filteredAgents.filter((agent) => agent.status === col.id);
					return acc;
				},
				{} as Record<AgentStatus, Agent[]>,
			),
		[filteredAgents],
	);

	const agentCounts = useMemo(
		() => ({
			queued: agents.filter((agent) => agent.status === "queued").length,
			running: agents.filter((agent) => agent.status === "running").length,
			completed: agents.filter(
				(agent) => agent.status === "completed" || agent.status === "cancelled",
			).length,
			failed: agents.filter((agent) => agent.status === "failed").length,
		}),
		[agents],
	);

	const [activeTab, setActiveTab] = useState<AgentStatus>("running");

	useEffect(() => {
		const hasActiveTabItems = agentsByStatus[activeTab].length > 0;
		if (hasActiveTabItems) {
			return;
		}

		const fallbackOrder: AgentStatus[] = [
			"running",
			"failed",
			"completed",
			"queued",
		];
		const nextTab = fallbackOrder.find(
			(status) => agentsByStatus[status].length > 0,
		);
		if (nextTab && nextTab !== activeTab) {
			setActiveTab(nextTab);
		}
	}, [activeTab, agentsByStatus]);

	return (
		<div className="flex h-[100dvh] flex-col overflow-hidden">
			<BoardHeader
				agentCounts={agentCounts}
				defaultCwd={defaultCwd}
				defaultWorkspaceRoot={defaultWorkspaceRoot}
				isRefreshing={isRefreshing}
				onCreateAgent={handleCreateAgent}
				onDeleteTerminalAgents={handleDeleteTerminalAgents}
				onRefresh={handleRefresh}
				onSearchChange={setSearchQuery}
				searchQuery={searchQuery}
			/>

			<nav
				aria-label="Column tabs"
				className="flex border-b border-border md:hidden"
			>
				{COLUMNS.map((col) => (
					<button
						className={cn(
							"relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors",
							activeTab === col.id
								? "text-foreground"
								: "text-muted-foreground",
						)}
						key={col.id}
						onClick={() => setActiveTab(col.id)}
						type="button"
					>
						<span
							className={cn(
								"h-1.5 w-1.5 shrink-0 rounded-full",
								columnDotColor(col.id),
								col.id === "running" && "animate-pulse-dot",
							)}
						/>
						<span className="truncate">{col.label}</span>
						<span className="flex h-4 min-w-4 items-center justify-center rounded-md bg-muted px-1 text-[10px] text-muted-foreground">
							{agentsByStatus[col.id].length}
						</span>
						{activeTab === col.id && (
							<span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
						)}
					</button>
				))}
			</nav>

			<main className="flex flex-1 flex-col overflow-hidden p-3 md:hidden">
				{COLUMNS.filter((col) => col.id === activeTab).map((col) => (
					<KanbanColumn
						agents={agentsByStatus[col.id]}
						key={col.id}
						label={col.label}
						onCommitAll={handleCommitAll}
						onCommitFile={handleCommitFile}
						onDeleteAgent={handleDeleteAgent}
						onStartAgent={handleStartAgent}
						onStopAgent={handleStopAgent}
						status={col.id}
					/>
				))}
			</main>

			<main className="hidden flex-1 gap-4 overflow-x-auto p-4 md:flex">
				{COLUMNS.map((col) => (
					<KanbanColumn
						agents={agentsByStatus[col.id]}
						key={col.id}
						label={col.label}
						onCommitAll={handleCommitAll}
						onCommitFile={handleCommitFile}
						onDeleteAgent={handleDeleteAgent}
						onStartAgent={handleStartAgent}
						onStopAgent={handleStopAgent}
						status={col.id}
					/>
				))}
			</main>
		</div>
	);
}
