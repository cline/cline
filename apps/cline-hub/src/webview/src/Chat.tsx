"use client";

import { buildVoiceAckNarration } from "@cline/drive";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import type {
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewReasonLevel,
	WebviewSessionSummary,
} from "../../webview-protocol";
import {
	appendAssistantDelta,
	appendReasoningDelta,
	appendToolEvent,
	buildUserMessageLabel,
	type ChatMessage,
	createMessage,
	finalizeAssistantTurn,
	mergeHydratedMessagesWithLive,
} from "./chatMessageState";
import { Composer } from "./components/Composer";
import { ConversationPanel } from "./components/ConversationPanel";
import {
	type PendingApproval,
	PendingApprovalsPanel,
} from "./components/PendingApprovalsPanel";
import { PlanEditor, removeTask } from "./components/PlanEditor";
import {
	listPlanTasks,
	mutateBankCreateTask,
	mutateBankEditPlanTasks,
} from "./drive/bankSession";
import { DriveHeaderControls } from "./drive/DriveCallChrome";
import { DriveRoomChrome, DriveVoiceBar } from "./drive/DriveRoomChrome";
import {
	ChatForkAuditPanel,
	isChatForkSession,
} from "./drive/ChatForkAuditPanel";
import { Spotlight } from "./drive/Spotlight";
import { StickyStagePane } from "./drive/StickyStagePane";
import {
	applyBankSnapshot,
	drivePersonaSystemHint,
	toNativeMode,
} from "./drive/types";
import { isDriveHumanId } from "./drive/participantIds";
import { useDriveSession } from "./drive/useDriveSession";
import { createVoiceStack } from "./drive/voice/createVoiceStack";
import { shouldSpeakDriveTts } from "./drive/voice/driveVoiceUi";
import { clearVoiceCaptionAfterSend } from "./drive/voice/voiceCaptionState";
import { getVsCodeApi, postToHost } from "./vscode";

type ProviderOption = Extract<
	WebviewOutboundMessage,
	{ type: "providers" }
>["providers"][number];
type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

const EMPTY_SELECTION: ModelSelectionStorage = {
	lastProvider: "",
	lastModelByProvider: {},
};

function readModelSelection(): ModelSelectionStorage {
	try {
		const state = getVsCodeApi()?.getState() as
			| { modelSelection?: ModelSelectionStorage }
			| undefined;
		if (state?.modelSelection) {
			return state.modelSelection;
		}
	} catch {
		// ignore persisted state issues in the webview
	}
	return EMPTY_SELECTION;
}

function writeModelSelection(selection: ModelSelectionStorage): void {
	try {
		const api = getVsCodeApi();
		if (!api) {
			return;
		}
		const state = (api.getState() as Record<string, unknown>) ?? {};
		api.setState({ ...state, modelSelection: selection });
	} catch {
		// ignore persisted state issues in the webview
	}
}

function parseMaxIterations(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatSessionLabel(session: WebviewSessionSummary): string {
	const title = session.title?.trim() || session.sessionId.slice(0, 12);
	const workspaceName = session.workspaceRoot?.trim()
		? session.workspaceRoot.trim().split("/").pop()
		: undefined;
	return [title, workspaceName].filter(Boolean).join(" • ");
}

type ChatProps = {
	initialSessionId?: string;
	onSessionSelected?: (sessionId?: string) => void;
};

export default function Chat({
	initialSessionId,
	onSessionSelected,
}: ChatProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState("Waiting for RPC initialization...");
	const [sessionId, setSessionId] = useState<string>();
	const [hydratingSessionId, setHydratingSessionId] = useState<string>();
	const [sending, setSending] = useState(false);
	const [providers, setProviders] = useState<ProviderOption[]>([]);
	const [modelsByProvider, setModelsByProvider] = useState<
		Record<string, WebviewProviderModel[]>
	>({});
	const [defaults, setDefaults] = useState<WebviewDefaults>({
		workspaceRoot: "",
		cwd: "",
	});
	const [sessions, setSessions] = useState<WebviewSessionSummary[]>([]);
	const [sessionTitleDraft, setSessionTitleDraft] = useState("");
	const [lastSelection, setLastSelection] =
		useState<ModelSelectionStorage>(readModelSelection);
	const [provider, setProvider] = useState(() => lastSelection.lastProvider);
	const [model, setModel] = useState(
		() => lastSelection.lastModelByProvider[lastSelection.lastProvider] ?? "",
	);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [maxIterations, setMaxIterations] = useState("");
	const [mode, setMode] = useState<"act" | "plan">("act");
	const [reasonLevel, setReasonLevel] = useState<WebviewReasonLevel>("none");
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(false);
	const [enableTeams, setEnableTeams] = useState(true);
	const [autoApproveTools, setAutoApproveTools] = useState(true);
	const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
		[],
	);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const [titleEditing, setTitleEditing] = useState(false);
	const [forking, setForking] = useState(false);
	const [forkError, setForkError] = useState<string | null>(null);
	const activeAssistantIdRef = useRef<string | undefined>(undefined);
	const initialSessionIdRef = useRef<string | undefined>(undefined);
	const hydratingSessionIdRef = useRef<string | undefined>(undefined);
	const sessionIdRef = useRef<string | undefined>(undefined);
	const onSessionSelectedRef = useRef(onSessionSelected);
	const lastSelectionRef = useRef(lastSelection);
	const sessionsRef = useRef(sessions);
	const defaultsRef = useRef(defaults);

	const isHydrating = Boolean(hydratingSessionId);
	const driveSession = useDriveSession({
		providerId: provider,
		sending,
		disabled: isHydrating,
		onModeChange: setMode,
		onAbort: () => {
			postToHost({ type: "abort" });
		},
		onStatus: setStatus,
		sessionId: sessionId ?? null,
		workspaceRoot: defaults.workspaceRoot,
	});
	const {
		drive,
		setDrive,
		driveVoice,
		driveJoinNote,
		setDriveJoinNote,
		setVoiceCaption,
		planEditorTasks,
		setPlanEditorTasks,
		bankSessionRef,
		driveVoiceResolved,
		toggleDrive,
		toggleStage,
		presentedShow,
		chatForks,
		workersPanelOpen,
		focusedAuditHandle,
		auditMessages,
		auditSummaryOnly,
		toggleWorkersPanel,
		openForkAudit,
		setForkRetain,
	} = driveSession;

	const visibleSessions = useMemo(
		() => sessions.filter((session) => !isChatForkSession(session)),
		[sessions],
	);

	const attachSession = useCallback(
		(nextSessionId: string) => {
			if (
				hydratingSessionIdRef.current === nextSessionId ||
				(sessionIdRef.current === nextSessionId &&
					!hydratingSessionIdRef.current)
			) {
				return;
			}
			sessionIdRef.current = nextSessionId;
			hydratingSessionIdRef.current = nextSessionId;
			setSessionId(nextSessionId);
			setHydratingSessionId(nextSessionId);
			setMessages([]);
			setSending(false);
			setPendingApprovals([]);
			activeAssistantIdRef.current = undefined;
			setStatus(`Loading chat history for ${nextSessionId}...`);
			onSessionSelected?.(nextSessionId);
			postToHost({
				type: "attachSession",
				sessionId: nextSessionId,
			});
		},
		[onSessionSelected],
	);

	useEffect(() => {
		hydratingSessionIdRef.current = hydratingSessionId;
	}, [hydratingSessionId]);

	useEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

	useEffect(() => {
		onSessionSelectedRef.current = onSessionSelected;
	}, [onSessionSelected]);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		defaultsRef.current = defaults;
	}, [defaults]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object" || !("type" in message)) {
				return;
			}

			switch (message.type) {
				case "status":
					setStatus(message.text);
					return;
				case "error":
					setStatus(`Error: ${message.text}`);
					setSending(false);
					setHydratingSessionId(undefined);
					hydratingSessionIdRef.current = undefined;
					activeAssistantIdRef.current = undefined;
					setMessages((current) => {
						if (current.length === 0) {
							return current;
						}
						const nextText = `Error: ${message.text}`;
						const last = current.at(-1);
						if (last?.role === "error" && last.text === nextText) {
							return current;
						}
						return [...current, createMessage("error", nextText)];
					});
					return;
				case "defaults":
					setDefaults(message.defaults);
					if (message.defaults.provider) {
						setProvider(message.defaults.provider);
					}
					if (message.defaults.model) {
						setModel(message.defaults.model);
					}
					return;
				case "sessions":
					setSessions(message.sessions);
					return;
				case "providers":
					setProviders(message.providers);
					setProvider((current) => {
						const currentProvider =
							current && message.providers.some((item) => item.id === current)
								? current
								: "";
						const savedProvider = readModelSelection().lastProvider;
						const nextProvider =
							currentProvider ||
							(savedProvider &&
							message.providers.some((item) => item.id === savedProvider)
								? savedProvider
								: "") ||
							message.providers.find((item) => item.enabled)?.id ||
							message.providers[0]?.id ||
							"";
						if (nextProvider) {
							postToHost({ type: "loadModels", providerId: nextProvider });
						}
						return nextProvider;
					});
					return;
				case "models":
					setModelsByProvider((current) => ({
						...current,
						[message.providerId]: message.models,
					}));
					setModel((current) => {
						if (current && message.models.some((item) => item.id === current)) {
							return current;
						}
						const nextDefaults = defaultsRef.current;
						if (
							nextDefaults.provider === message.providerId &&
							nextDefaults.model &&
							message.models.some((item) => item.id === nextDefaults.model)
						) {
							return nextDefaults.model;
						}
						const saved = readModelSelection();
						const rememberedModel =
							saved.lastModelByProvider[message.providerId];
						if (
							rememberedModel &&
							message.models.some((item) => item.id === rememberedModel)
						) {
							return rememberedModel;
						}
						return message.models[0]?.id || "";
					});
					return;
				case "session_started":
					sessionIdRef.current = message.sessionId;
					setSessionId(message.sessionId);
					onSessionSelectedRef.current?.(message.sessionId);
					setTitleEditing(false);
					setSessionTitleDraft("");
					return;
				case "session_hydrated":
					if (
						hydratingSessionIdRef.current &&
						hydratingSessionIdRef.current !== message.sessionId
					) {
						return;
					}
					sessionIdRef.current = message.sessionId;
					hydratingSessionIdRef.current = undefined;
					setSessionId(message.sessionId);
					setHydratingSessionId(undefined);
					setSending(message.status === "running");
					if (message.providerId) {
						setProvider(message.providerId);
					}
					if (message.providerId && message.modelId) {
						const nextSelection: ModelSelectionStorage = {
							lastProvider: message.providerId,
							lastModelByProvider: {
								...lastSelectionRef.current.lastModelByProvider,
								[message.providerId]: message.modelId,
							},
						};
						lastSelectionRef.current = nextSelection;
						setLastSelection(nextSelection);
						writeModelSelection(nextSelection);
						setModel(message.modelId);
					}
					setTitleEditing(false);
					setSessionTitleDraft(
						sessionsRef.current
							.find((item) => item.sessionId === message.sessionId)
							?.title?.trim() || "",
					);
					setMessages((current) => {
						const merged =
							message.status === "running"
								? mergeHydratedMessagesWithLive(
										message.messages as ChatMessage[],
										current,
									)
								: (message.messages as ChatMessage[]);
						activeAssistantIdRef.current =
							message.status === "running"
								? [...merged]
										.reverse()
										.find((item) => item.role === "assistant")?.id
								: undefined;
						return merged;
					});
					setStatus(
						message.status === "running"
							? `Attached to ${message.sessionId} (running)`
							: `Attached to ${message.sessionId}`,
					);
					return;
				case "assistant_delta":
					setMessages((current) =>
						appendAssistantDelta(current, message.text, activeAssistantIdRef),
					);
					return;
				case "reasoning_delta":
					setMessages((current) =>
						appendReasoningDelta(
							current,
							message.text,
							message.redacted,
							activeAssistantIdRef,
						),
					);
					return;
				case "tool_event":
					setMessages((current) =>
						appendToolEvent(
							current,
							message.text,
							message.event,
							activeAssistantIdRef,
						),
					);
					return;
				case "approval_request":
					setPendingApprovals((current) => {
						const existingIndex = current.findIndex(
							(item) => item.approvalId === message.approvalId,
						);
						const next = { ...message, responding: false };
						if (existingIndex === -1) {
							return [...current, next];
						}
						return current.map((item, index) =>
							index === existingIndex ? next : item,
						);
					});
					setStatus(`Waiting for approval: ${message.toolName}`);
					return;
				case "approval_resolved":
					setPendingApprovals((current) =>
						current.filter((item) => item.approvalId !== message.approvalId),
					);
					return;
				case "turn_done":
					setStatus(`Done (${message.finishReason})`);
					setSending(false);
					setPendingApprovals([]);
					activeAssistantIdRef.current = undefined;
					setMessages((current) =>
						finalizeAssistantTurn(
							current,
							message.finishReason,
							message.iterations,
							message.usage,
						),
					);
					return;
				case "reset_done":
					sessionIdRef.current = undefined;
					hydratingSessionIdRef.current = undefined;
					setSessionId(undefined);
					setHydratingSessionId(undefined);
					setSending(false);
					setPendingApprovals([]);
					setTitleEditing(false);
					setSessionTitleDraft("");
					activeAssistantIdRef.current = undefined;
					onSessionSelectedRef.current?.(undefined);
					setStatus("Started a new chat session.");
					setMessages([]);
					return;
				case "fork_done":
					setForking(false);
					setForkError(null);
					setStatus(`Forked → new session ${message.newSessionId}`);
					return;
				case "fork_error":
					setForking(false);
					setForkError(message.text);
					setStatus(`Fork failed: ${message.text}`);
					return;
			}
		};

		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, []);

	useEffect(() => {
		if (!initialSessionId || initialSessionIdRef.current === initialSessionId) {
			return;
		}
		initialSessionIdRef.current = initialSessionId;
		attachSession(initialSessionId);
	}, [attachSession, initialSessionId]);

	useEffect(() => {
		if (provider) {
			postToHost({ type: "loadModels", providerId: provider });
		}
	}, [provider]);

	useEffect(() => {
		if (!provider || !model) {
			return;
		}
		const previous = lastSelectionRef.current;
		if (
			previous.lastProvider === provider &&
			previous.lastModelByProvider[provider] === model
		) {
			return;
		}
		const nextSelection: ModelSelectionStorage = {
			lastProvider: provider,
			lastModelByProvider: {
				...previous.lastModelByProvider,
				[provider]: model,
			},
		};
		lastSelectionRef.current = nextSelection;
		setLastSelection(nextSelection);
		writeModelSelection(nextSelection);
	}, [provider, model]);

	const models = modelsByProvider[provider] ?? [];
	const modelSupportsReasoning =
		models.find((item) => item.id === model)?.supportsThinking === true;
	const effectiveReasonLevel = modelSupportsReasoning ? reasonLevel : "none";
	const visibleMessages = useMemo(
		() => messages.filter((message) => message.role !== "meta" || message.text),
		[messages],
	);
	const sessionTitle =
		sessionId &&
		typeof sessions.find((item) => item.sessionId === sessionId)?.title ===
			"string"
			? sessions.find((item) => item.sessionId === sessionId)?.title?.trim() ||
				""
			: "";
	const displayedSessionTitle = titleEditing ? sessionTitleDraft : sessionTitle;

	const commitSessionTitle = () => {
		if (!sessionId) {
			setTitleEditing(false);
			return;
		}
		const normalized = sessionTitleDraft.replace(/\s+/g, " ").trim();
		setTitleEditing(false);
		if (normalized === sessionTitle) {
			return;
		}
		setSessionTitleDraft(normalized);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: {
				title: normalized,
			},
		});
	};

	const sendDrivePrompt = useCallback(
		(prompt: string) => {
			const trimmed = prompt.trim();
			if (!trimmed || isHydrating) {
				return;
			}

			if (drive.muted) {
				setStatus(
					"Mic is muted. Unmute on the call strip before sending spoken input.",
				);
				return;
			}

			if (
				driveVoiceResolved.ok &&
				shouldSpeakDriveTts({
					facets: driveVoice.facets,
					muted: drive.muted,
					partnerMuted: drive.partnerMuted,
				})
			) {
				const ack = buildVoiceAckNarration({
					profile: driveVoice.profile === "local" ? "local" : "cloud",
					partnerName: drive.partnerName,
					utterance: trimmed,
				});
				setDriveJoinNote(ack.text);
				void createVoiceStack(driveVoiceResolved.topology).tts.speak(
					ack.text,
					{
						volume: driveVoice.hardware.outputVolume,
						sinkId: driveVoice.hardware.speakerDeviceId,
					},
				);
			} else if (driveVoice.profile === "local") {
				const ack = buildVoiceAckNarration({
					profile: "local",
					partnerName: drive.partnerName,
					utterance: trimmed,
				});
				setDriveJoinNote(ack.text);
			}

			const assistantMessage = createMessage("assistant", "");
			activeAssistantIdRef.current = assistantMessage.id;
			setMessages((current) => [
				...current,
				createMessage("user", trimmed),
				assistantMessage,
			]);
			setSending(true);
			setStatus("Running...");
			postToHost({
				type: "send",
				prompt: trimmed,
				source: "voice",
				config: {
					autoApproveTools,
					enableSpawn,
					enableTeams,
					enableTools,
					maxIterations: parseMaxIterations(maxIterations),
					model: model || undefined,
					mode: drive.active ? toNativeMode(drive.subMode) : mode,
					provider: provider || undefined,
					reasonLevel: effectiveReasonLevel,
					systemPrompt: (() => {
						const driveHint = drivePersonaSystemHint(drive);
						const base = systemPrompt.trim();
						if (driveHint && base) {
							return `${driveHint}\n\n${base}`;
						}
						return driveHint || base || undefined;
					})(),
				},
			});
			setVoiceCaption(clearVoiceCaptionAfterSend());
		},
		[
			autoApproveTools,
			drive,
			driveVoice.facets,
			driveVoice.hardware.outputVolume,
			driveVoice.hardware.speakerDeviceId,
			driveVoice.profile,
			driveVoiceResolved,
			effectiveReasonLevel,
			enableSpawn,
			enableTeams,
			enableTools,
			isHydrating,
			maxIterations,
			model,
			mode,
			provider,
			setDriveJoinNote,
			setVoiceCaption,
			systemPrompt,
		],
	);

	const respondToApproval = (approvalId: string, approved: boolean) => {
		setPendingApprovals((current) =>
			current.map((item) =>
				item.approvalId === approvalId ? { ...item, responding: true } : item,
			),
		);
		postToHost({
			type: "approval_response",
			approvalId,
			approved,
			reason: approved ? "Approved in Cline Hub." : "Rejected in Cline Hub.",
		});
		setStatus(approved ? "Approval sent." : "Rejection sent.");
	};

	return (
		<PromptInputProvider>
			<div className="relative flex h-screen flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div className="min-w-0">
						{visibleSessions.length > 0 ? (
							<select
								className="max-w-48 rounded-md border bg-background px-2 py-1 text-xs"
								disabled={isHydrating}
								onChange={(event) => {
									const nextSessionId = event.target.value;
									if (!nextSessionId) {
										postToHost({ type: "reset" });
										setStatus("Resetting session...");
										setPendingApprovals([]);
										return;
									}
									attachSession(nextSessionId);
								}}
								value={sessionId ?? ""}
							>
								<option value="">New session</option>
								{visibleSessions.map((item) => (
									<option key={item.sessionId} value={item.sessionId}>
										{formatSessionLabel(item)}
									</option>
								))}
							</select>
						) : null}
						{isHydrating ? (
							<span className="ml-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<Loader2Icon className="size-3 animate-spin" />
								Loading history
							</span>
						) : null}
						{sessionId ? (
							<input
								className="min-w-0 max-w-56 rounded-md border bg-muted px-2 py-1 text-xs"
								disabled={isHydrating}
								onBlur={commitSessionTitle}
								onChange={(event) => setSessionTitleDraft(event.target.value)}
								onFocus={() => {
									setTitleEditing(true);
									setSessionTitleDraft(sessionTitle);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitSessionTitle();
									}
								}}
								placeholder="Session title"
								value={displayedSessionTitle}
							/>
						) : null}
						{sessionId ? (
							<Button
								disabled={isHydrating}
								onClick={() => {
									setStatus(`Deleting ${sessionId}...`);
									postToHost({ type: "deleteSession", sessionId });
								}}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<Trash2Icon className="size-4" />
								<span className="sr-only">Delete session</span>
							</Button>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<DriveHeaderControls
							disabled={isHydrating}
							drive={drive}
							onToggleDrive={toggleDrive}
							onToggleStage={toggleStage}
						/>
						<Button
							disabled={isHydrating}
							onClick={() => {
								postToHost({ type: "reset" });
								setStatus("Resetting session...");
								setPendingApprovals([]);
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<PlusIcon className="size-4" />
							<span className="sr-only">New chat</span>
						</Button>
					</div>
				</div>
				<DriveRoomChrome
					disabled={isHydrating}
					providerId={provider}
					session={driveSession}
				/>
				<div
					className={
						drive.active && drive.stageLayout
							? "flex min-h-0 flex-1"
							: "flex min-h-0 flex-1 flex-col"
					}
				>
					<div
						className={
							drive.active && drive.stageLayout
								? "flex min-h-0 w-[42%] min-w-[280px] flex-col border-r"
								: "flex min-h-0 flex-1 flex-col"
						}
					>
						<ConversationPanel
							forkError={forkError}
							forking={forking}
							isHydrating={isHydrating}
							messages={visibleMessages}
							onFork={() => {
								setForking(true);
								setForkError(null);
								postToHost({ type: "forkSession" });
							}}
							sending={sending}
						/>
						<PendingApprovalsPanel
							approvals={pendingApprovals}
							onRespond={respondToApproval}
						/>
						<DriveVoiceBar
							disabled={isHydrating}
							onSendSpoken={sendDrivePrompt}
							onSttError={setStatus}
							sending={sending}
							session={driveSession}
						/>
						<Composer
							autoApproveTools={autoApproveTools}
							disabled={isHydrating}
							enableSpawn={enableSpawn}
							enableTeams={enableTeams}
							enableTools={enableTools}
							maxIterations={maxIterations}
							model={model}
							mode={mode}
							modelSelectorOpen={modelSelectorOpen}
							models={models}
							onAbort={() => {
								postToHost({ type: "abort" });
								setStatus("Abort requested...");
							}}
							onAutoApproveToolsChange={setAutoApproveTools}
							onEnableSpawnChange={setEnableSpawn}
							onEnableTeamsChange={setEnableTeams}
							onEnableToolsChange={setEnableTools}
							onModeChange={setMode}
							onMaxIterationsChange={setMaxIterations}
							onModelChange={setModel}
							onModelSelectorOpenChange={setModelSelectorOpen}
							onProviderChange={(nextProvider) => {
								setProvider(nextProvider);
								const rememberedModel =
									lastSelection.lastModelByProvider[nextProvider];
								const providerModelIds = (
									modelsByProvider[nextProvider] ?? []
								).map((item) => item.id);
								if (
									rememberedModel &&
									providerModelIds.includes(rememberedModel)
								) {
									setModel(rememberedModel);
									return;
								}
								setModel("");
							}}
							onSend={({ prompt, attachments, attachmentCount }) => {
								if (isHydrating) {
									return;
								}
								const assistantMessage = createMessage("assistant", "");
								activeAssistantIdRef.current = assistantMessage.id;
								setMessages((current) => [
									...current,
									createMessage(
										"user",
										buildUserMessageLabel(prompt, attachments, attachmentCount),
									),
									assistantMessage,
								]);
								setSending(true);
								setStatus("Running...");
								postToHost({
									type: "send",
									prompt,
									attachments,
									config: {
										autoApproveTools,
										enableSpawn,
										enableTeams,
										enableTools,
										maxIterations: parseMaxIterations(maxIterations),
										model: model || undefined,
										mode: drive.active ? toNativeMode(drive.subMode) : mode,
										provider: provider || undefined,
										reasonLevel: effectiveReasonLevel,
										systemPrompt: (() => {
											const driveHint = drivePersonaSystemHint(drive);
											const base = systemPrompt.trim();
											if (driveHint && base) {
												return `${driveHint}\n\n${base}`;
											}
											return driveHint || base || undefined;
										})(),
									},
								});
								if (driveJoinNote) {
									setDriveJoinNote(null);
								}
							}}
							onSystemPromptChange={setSystemPrompt}
							onReasonLevelChange={setReasonLevel}
							provider={provider}
							providers={providers}
							sending={sending}
							status={status}
							systemPrompt={systemPrompt}
							reasonLevel={effectiveReasonLevel}
							workspaceRoot={defaults.workspaceRoot}
						/>
					</div>
					{drive.active && drive.stageLayout ? (
						<Spotlight
							cards={drive.stageCards}
							className="min-h-0 flex-1"
							demo={drive.demo}
							emptyHint={
								drive.demo
									? "Demo mode — join Drive to project live hub stage cards."
									: "Waiting for partner tool activity on this session."
							}
							humanPin={
								drive.stageSharer === "you" && drive.stagePin
									? {
											kind: drive.stagePin.kind,
											label: drive.stagePin.label,
											ref: drive.stagePin.ref,
										}
									: null
							}
							humanSharing={drive.stageSharer === "you"}
							nextLabel={
								drive.bankSnapshot.nextTitle ??
								drive.bankSnapshot.nextTaskId ??
								"—"
							}
							nowLabel={
								drive.bankSnapshot.nowTitle ??
								drive.bankSnapshot.nowTaskId ??
								(sending ? "partner working" : "idle")
							}
							sharerLabel={
								drive.stageSharer === "you" ||
								isDriveHumanId(drive.spotlightParticipantId)
									? "You"
									: drive.partnerName
							}
						>
							<StickyStagePane
								caption={presentedShow?.caption}
								drive={drive}
								title={presentedShow?.title}
								uri={presentedShow?.uri}
							/>
							<ChatForkAuditPanel
								auditMessages={auditMessages}
								className="mt-3"
								focusedAuditHandle={focusedAuditHandle}
								forks={chatForks}
								onClose={toggleWorkersPanel}
								onOpenAudit={openForkAudit}
								onRetain={setForkRetain}
								open={workersPanelOpen}
								summaryOnly={auditSummaryOnly}
							/>
							<div className="space-y-3 text-xs text-muted-foreground">
								<p>
									Task bank cursor drives now/next. Edit plan refs below;
									completed tasks archive under .drive/bank/archive/.
								</p>
								<PlanEditor
									planId={drive.bankSnapshot.activePlanId}
									planTitle="Current work"
									tasks={planEditorTasks}
									onAdd={(task) => {
										void (async () => {
											const planId = drive.bankSnapshot.activePlanId;
											if (!planId) {
												return;
											}
											const { snapshot } = await mutateBankCreateTask(
												bankSessionRef.current,
												defaults.workspaceRoot,
												{
													id: task.id,
													title: task.title,
													body: "",
													planId,
												},
											);
											setPlanEditorTasks(
												await listPlanTasks(bankSessionRef.current, planId),
											);
											setDrive((current) =>
												applyBankSnapshot(current, snapshot),
											);
										})();
									}}
									onRemove={(taskId) => {
										void (async () => {
											const planId = drive.bankSnapshot.activePlanId;
											if (!planId) {
												return;
											}
											const ids = removeTask(
												planEditorTasks.map((item) => item.id),
												taskId,
											);
											const { snapshot } = await mutateBankEditPlanTasks(
												bankSessionRef.current,
												defaults.workspaceRoot,
												{ planId, taskIds: ids },
											);
											setPlanEditorTasks(
												await listPlanTasks(bankSessionRef.current, planId),
											);
											setDrive((current) =>
												applyBankSnapshot(current, snapshot),
											);
										})();
									}}
									onReorder={(taskIds) => {
										void (async () => {
											const planId = drive.bankSnapshot.activePlanId;
											if (!planId) {
												return;
											}
											const { snapshot } = await mutateBankEditPlanTasks(
												bankSessionRef.current,
												defaults.workspaceRoot,
												{ planId, taskIds },
											);
											setPlanEditorTasks(
												await listPlanTasks(bankSessionRef.current, planId),
											);
											setDrive((current) =>
												applyBankSnapshot(current, snapshot),
											);
										})();
									}}
								/>
							</div>
						</Spotlight>
					) : null}
				</div>
			</div>
		</PromptInputProvider>
	);
}
