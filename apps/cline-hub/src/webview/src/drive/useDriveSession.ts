import type { ChatForkRecord, RoomSnapshot, ShowBacklogItem } from "@cline/shared";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getVsCodeApi, postToHost } from "../vscode";
import {
	createDriveBankSession,
	type DriveBankSession,
	listPlanTasks,
	seedBankForJoin,
} from "./bankSession";
import { foldIncomingDriveEvent } from "./foldRoomSnapshot";
import {
	isDriveHumanId,
	isDrivePartnerId,
	toggleDriveSpotlightId,
} from "./participantIds";
import {
	applyBankSnapshot,
	applyRoomSnapshot,
	applySubModeIntent,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
	fromSharedDriveSubMode,
	toNativeMode,
	toSharedDriveSubMode,
} from "./types";
import { createVoiceStack } from "./voice/createVoiceStack";
import { normalizeDriveHardwarePrefs } from "./voice/driveHardwarePrefs";
import {
	applyHardwarePrefsPatch,
	applyVoiceFacetPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	type DriveVoiceUi,
	resolveDriveVoiceTopology,
	shouldSpeakDriveTts,
} from "./voice/driveVoiceUi";
import { buildDrivePersistPayload } from "./voice/voiceCaptionState";

function readPersistedDriveUi(): DriveUiState {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveUi?: DriveUiState }
			| undefined;
		if (state?.driveUi) {
			return {
				...DEFAULT_DRIVE_UI,
				...state.driveUi,
				bankSnapshot:
					state.driveUi.bankSnapshot ?? DEFAULT_DRIVE_UI.bankSnapshot,
				postureOverride: state.driveUi.postureOverride ?? null,
				spotlightParticipantId:
					state.driveUi.spotlightParticipantId ??
					DEFAULT_DRIVE_UI.spotlightParticipantId,
				partnerMuted:
					state.driveUi.partnerMuted ?? DEFAULT_DRIVE_UI.partnerMuted,
				partnerDeafened:
					state.driveUi.partnerDeafened ?? DEFAULT_DRIVE_UI.partnerDeafened,
				stageCards: state.driveUi.stageCards ?? DEFAULT_DRIVE_UI.stageCards,
				stagePin:
					state.driveUi.stagePin === undefined
						? DEFAULT_DRIVE_UI.stagePin
						: state.driveUi.stagePin,
				participants:
					state.driveUi.participants ?? DEFAULT_DRIVE_UI.participants,
				focusedParticipantId:
					state.driveUi.focusedParticipantId ??
					DEFAULT_DRIVE_UI.focusedParticipantId,
				addressFollowsFocusParticipantId:
					state.driveUi.addressFollowsFocusParticipantId ??
					DEFAULT_DRIVE_UI.addressFollowsFocusParticipantId,
				partnerNameInk:
					state.driveUi.partnerNameInk ?? DEFAULT_DRIVE_UI.partnerNameInk,
			};
		}
	} catch {
		// ignore
	}
	return DEFAULT_DRIVE_UI;
}

function readPersistedDriveVoice(): DriveVoiceUi {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveVoice?: DriveVoiceUi }
			| undefined;
		if (state?.driveVoice?.facets && state.driveVoice.profile) {
			const defaults = createDefaultDriveVoiceUi(state.driveVoice.profile);
			return {
				...defaults,
				...state.driveVoice,
				facets: {
					...defaults.facets,
					...state.driveVoice.facets,
				},
				hardware: normalizeDriveHardwarePrefs({
					...defaults.hardware,
					...state.driveVoice.hardware,
				}),
			};
		}
	} catch {
		// ignore
	}
	return createDefaultDriveVoiceUi("cloud");
}

export type UseDriveSessionArgs = {
	providerId: string;
	sending: boolean;
	disabled: boolean;
	onModeChange: (mode: "act" | "plan") => void;
	onAbort: () => void;
	onStatus: (text: string) => void;
	/** Link call_join to the active chat session when available. */
	sessionId?: string | null;
	/** Workspace root for hub durable bank seed (drive_bank_seed). */
	workspaceRoot?: string;
};

export type DriveConnectionPhase = "off" | "joining" | "on" | "error";

export type DriveCallErrorResolution =
	| {
			kind: "reset";
			note: string;
			phase: Extract<DriveConnectionPhase, "off" | "error">;
	  }
	| {
			kind: "refresh";
			note: string;
	  };

export function resolveDriveCallError({
	code,
	command,
	text,
	wasJoining,
}: {
	code?: string;
	command?: string;
	text?: string;
	wasJoining: boolean;
}): DriveCallErrorResolution {
	const detail = text?.trim();
	if (code === "room_not_found") {
		const joinFailed = wasJoining || command === "call_join";
		return {
			kind: "reset",
			note: joinFailed
				? detail
					? `Could not join Drive: ${detail}`
					: "Could not join Drive."
				: "The Drive call is no longer available.",
			phase: joinFailed ? "error" : "off",
		};
	}
	if (wasJoining) {
		return {
			kind: "reset",
			note: detail
				? `Could not join Drive: ${detail}`
				: "Could not join Drive.",
			phase: "error",
		};
	}
	return {
		kind: "refresh",
		note:
			command === "call_rename_participant"
				? detail
					? `Could not rename participant: ${detail}`
					: "Could not rename participant."
				: detail || "Drive call command failed.",
	};
}

export function shouldReattachDriveSession({
	active,
	connectionPhase,
	driveIntended,
	lastAttachedSessionId,
	sessionId,
}: {
	active: boolean;
	connectionPhase: DriveConnectionPhase;
	driveIntended: boolean;
	lastAttachedSessionId: string | null;
	sessionId?: string | null;
}): boolean {
	const normalizedSessionId = sessionId?.trim();
	return Boolean(
		normalizedSessionId &&
			connectionPhase === "on" &&
			active &&
			driveIntended &&
			lastAttachedSessionId !== normalizedSessionId,
	);
}

export type UseDriveSessionResult = {
	drive: DriveUiState;
	setDrive: Dispatch<SetStateAction<DriveUiState>>;
	connectionPhase: DriveConnectionPhase;
	driveVoice: DriveVoiceUi;
	setDriveVoice: Dispatch<SetStateAction<DriveVoiceUi>>;
	driveJoinNote: string | null;
	setDriveJoinNote: Dispatch<SetStateAction<string | null>>;
	voiceCaption: string;
	setVoiceCaption: Dispatch<SetStateAction<string>>;
	planEditorTasks: Array<{ id: string; title: string }>;
	setPlanEditorTasks: Dispatch<
		SetStateAction<Array<{ id: string; title: string }>>
	>;
	bankSessionRef: React.RefObject<DriveBankSession>;
	driveVoiceResolved: ReturnType<typeof resolveDriveVoiceTopology>;
	/** Workspace root for durable bank / agent-home hub ops. */
	workspaceRoot?: string;
	joinDrive: () => void;
	leaveDrive: () => void;
	refreshDriveRoom: () => void;
	toggleDrive: () => void;
	toggleStage: () => void;
	presentedShow: {
		showItemId: string;
		title?: string;
		caption?: string;
		uri?: string;
		ownerParticipantId?: string;
	} | null;
	chatForks: ChatForkRecord[];
	showBacklog: ShowBacklogItem[];
	workersPanelOpen: boolean;
	focusedAuditHandle: string | null;
	auditMessages: unknown[];
	auditSummaryOnly: boolean;
	toggleWorkersPanel: () => void;
	openForkAudit: (auditHandle: string) => void;
	setForkRetain: (workerSessionId: string, retain: boolean) => void;
	stripHandlers: {
		onClearOverride: () => void;
		onHandToggle: () => void;
		onMuteToggle: () => void;
		onOpenSettings: () => void;
		onTogglePartnerDeafen: () => void;
		onTogglePartnerMute: () => void;
		onToggleSpotlight: () => void;
		onToggleWorkers?: () => void;
		onSubModeChange: (mode: DriveUiState["subMode"]) => void;
	};
};

export function useDriveSession(
	args: UseDriveSessionArgs,
): UseDriveSessionResult {
	const [drive, setDrive] = useState<DriveUiState>(readPersistedDriveUi);
	const [connectionPhase, setConnectionPhase] = useState<DriveConnectionPhase>(
		() => (drive.active ? "on" : "off"),
	);
	const [driveJoinNote, setDriveJoinNote] = useState<string | null>(null);
	const [driveVoice, setDriveVoice] = useState<DriveVoiceUi>(
		readPersistedDriveVoice,
	);
	const [voiceCaption, setVoiceCaption] = useState("");
	const [presentedShow, setPresentedShow] = useState<{
		showItemId: string;
		title?: string;
		caption?: string;
		uri?: string;
		ownerParticipantId?: string;
	} | null>(null);
	const [chatForks, setChatForks] = useState<ChatForkRecord[]>([]);
	const [showBacklog, setShowBacklog] = useState<ShowBacklogItem[]>([]);
	const [workersPanelOpen, setWorkersPanelOpen] = useState(false);
	const [focusedAuditHandle, setFocusedAuditHandle] = useState<string | null>(
		null,
	);
	const [auditMessages, setAuditMessages] = useState<unknown[]>([]);
	const [auditSummaryOnly, setAuditSummaryOnly] = useState(false);
	const bankSessionRef = useRef<DriveBankSession>(createDriveBankSession());
	const [planEditorTasks, setPlanEditorTasks] = useState<
		Array<{ id: string; title: string }>
	>([]);
	/** True between call_join and the first successful room_snapshot. */
	const pendingJoinRef = useRef(false);
	/** Local RoomSnapshot for reduceRoom fold (same kernel as hub). */
	const roomSnapshotRef = useRef<RoomSnapshot | null>(null);
	/**
	 * Local intent to be on the Drive call (joining or seated).
	 * Cleared synchronously on leave/cancel so late hub snapshots cannot rejoin
	 * or sync chat mode after the user opted out.
	 */
	const driveIntentRef = useRef(drive.active);
	const sessionIdRef = useRef(args.sessionId);
	const lastAttachedSessionIdRef = useRef<string | null>(null);
	const workspaceRootRef = useRef(args.workspaceRoot);
	const onModeChangeRef = useRef(args.onModeChange);
	const driveRef = useRef(drive);
	const connectionPhaseRef = useRef(connectionPhase);
	sessionIdRef.current = args.sessionId;
	workspaceRootRef.current = args.workspaceRoot;
	onModeChangeRef.current = args.onModeChange;
	driveRef.current = drive;
	connectionPhaseRef.current = connectionPhase;

	useEffect(() => {
		try {
			const api = getVsCodeApi();
			if (!api) {
				return;
			}
			const state = (api.getState() as Record<string, unknown>) ?? {};
			api.setState(
				buildDrivePersistPayload({
					existing: state,
					driveUi: drive,
					driveVoice,
				}),
			);
		} catch {
			// ignore
		}
	}, [drive, driveVoice]);

	const resetDriveConnection = useCallback(
		({
			note,
			phase,
		}: {
			note: string | null;
			phase: Extract<DriveConnectionPhase, "off" | "error">;
		}) => {
			const current = driveRef.current;
			pendingJoinRef.current = false;
			driveIntentRef.current = false;
			roomSnapshotRef.current = null;
			lastAttachedSessionIdRef.current = null;
			connectionPhaseRef.current = phase;
			setConnectionPhase(phase);
			setDriveJoinNote(note);
			setPlanEditorTasks([]);
			setDrive({
				...DEFAULT_DRIVE_UI,
				partnerName: current.partnerName,
				partnerNameInk: current.partnerNameInk,
			});
			onModeChangeRef.current("act");
		},
		[],
	);

	const sendDriveJoin = useCallback(
		(current: DriveUiState, sessionId?: string | null) => {
			const payload: {
				type: "call_join";
				roomId: string;
				human: { id: string; displayName: string };
				agent: { id: string; displayName: string };
				activateDrive: boolean;
				sessionId?: string;
			} = {
				type: "call_join",
				roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
				human: {
					id: DRIVE_PARTICIPANT_HUMAN,
					displayName: "You",
				},
				agent: {
					id: DRIVE_PARTICIPANT_PARTNER,
					displayName: current.partnerName,
				},
				activateDrive: true,
			};
			const normalizedSessionId = sessionId?.trim();
			if (normalizedSessionId) {
				payload.sessionId = normalizedSessionId;
				lastAttachedSessionIdRef.current = normalizedSessionId;
			}
			postToHost(payload);
		},
		[],
	);

	const joinDrive = useCallback(() => {
		if (connectionPhaseRef.current === "joining") {
			return;
		}
		const current = driveRef.current;
		driveIntentRef.current = true;
		if (connectionPhaseRef.current !== "on" || !current.active) {
			pendingJoinRef.current = true;
			roomSnapshotRef.current = null;
			connectionPhaseRef.current = "joining";
			setConnectionPhase("joining");
			setDriveJoinNote("Joining Drive call…");
		}
		sendDriveJoin(current, sessionIdRef.current);
	}, [sendDriveJoin]);

	const leaveDrive = useCallback(() => {
		const current = driveRef.current;
		postToHost({
			type: "call_leave",
			roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
			participantId: DRIVE_PARTICIPANT_HUMAN,
		});
		resetDriveConnection({ note: null, phase: "off" });
	}, [resetDriveConnection]);

	const refreshDriveRoom = useCallback(() => {
		const roomId = driveRef.current.roomId;
		if (connectionPhaseRef.current !== "on") {
			return;
		}
		if (!roomId) {
			resetDriveConnection({
				note: "The Drive call is no longer available.",
				phase: "off",
			});
			return;
		}
		const payload: {
			type: "call_get_room";
			roomId: string;
			sessionId?: string;
		} = {
			type: "call_get_room",
			roomId,
		};
		const sessionId = sessionIdRef.current?.trim();
		if (sessionId) {
			payload.sessionId = sessionId;
		}
		postToHost(payload);
	}, [resetDriveConnection]);

	const toggleDrive = useCallback(() => {
		if (
			connectionPhaseRef.current === "on" ||
			connectionPhaseRef.current === "joining"
		) {
			leaveDrive();
			return;
		}
		joinDrive();
	}, [joinDrive, leaveDrive]);

	const seedBankAfterJoin = useCallback(async (partnerName: string) => {
		const { snapshot } = await seedBankForJoin(
			bankSessionRef.current,
			workspaceRootRef.current,
		);
		const tasks = snapshot.activePlanId
			? await listPlanTasks(bankSessionRef.current, snapshot.activePlanId)
			: [];
		// Leave/cancel clears intent synchronously; skip chrome if join is stale.
		if (!driveIntentRef.current) {
			return;
		}
		setPlanEditorTasks(tasks);
		setDrive((current) => {
			// Only seed bank chrome after a real hub join (demo must stay false).
			if (!current.active || current.roomId == null) {
				return current;
			}
			return applyBankSnapshot(current, snapshot);
		});
		if (!driveIntentRef.current) {
			return;
		}
		setDriveJoinNote(
			`On the call. I am ${partnerName}. Share what you want to work on and I will drive.`,
		);
	}, []);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const message = event.data as {
				type?: string;
				text?: string;
				code?: string;
				command?: string;
				showItemId?: string;
				title?: string;
				caption?: string;
				uri?: string;
				say?: string;
				ownerParticipantId?: string;
				snapshot?: RoomSnapshot;
				event?: unknown;
				auditHandle?: string;
				messages?: unknown[];
				summaryOnly?: boolean;
				room?: {
					spotlightParticipantId?: string | null;
					participantAudio?: Array<{
						participantId: string;
						muted: boolean;
						deafened: boolean;
					}>;
					director?: {
						activeShowId?: string | null;
						showBacklog?: Array<{
							id: string;
							title: string;
							caption: string;
							uri?: string;
							ownerParticipantId: string;
						}>;
					};
					chatForks?: ChatForkRecord[];
				};
			};
			if (message.type === "drive_show_presented" && message.showItemId) {
				setPresentedShow({
					showItemId: message.showItemId,
					title: message.title,
					caption: message.caption,
					uri: message.uri,
					ownerParticipantId: message.ownerParticipantId,
				});
				return;
			}
			if (message.type === "drive_script_beat") {
				const say =
					typeof message.say === "string" ? message.say.trim() : "";
				if (say) {
					setPresentedShow((current) =>
						current
							? {
									...current,
									caption: say,
								}
							: {
									showItemId: message.showItemId ?? "script-beat",
									caption: say,
								},
					);
				}
				return;
			}
			if (message.type === "call_error") {
				if (
					message.command === "call_join" &&
					!pendingJoinRef.current &&
					!driveIntentRef.current
				) {
					// Ignore a join failure that arrived after the user cancelled.
					return;
				}
				const resolution = resolveDriveCallError({
					code: message.code,
					command: message.command,
					text: message.text,
					wasJoining: pendingJoinRef.current,
				});
				if (resolution.kind === "reset") {
					resetDriveConnection({
						note: resolution.note,
						phase: resolution.phase,
					});
					return;
				}
				setDriveJoinNote(resolution.note);
				// Refresh authoritative room state (rolls back optimistic rename, etc.).
				refreshDriveRoom();
				return;
			}
			if (message.type === "drive_fork_audit") {
				setFocusedAuditHandle(message.auditHandle ?? null);
				setAuditMessages(
					Array.isArray(message.messages) ? message.messages : [],
				);
				setAuditSummaryOnly(message.summaryOnly === true);
				setWorkersPanelOpen(true);
				return;
			}
			if (
				(message.type === "room_snapshot" || message.type === "drive_event") &&
				message.snapshot
			) {
				const hubSnapshot = message.snapshot;
				// Fold drive_event through reduceRoom; room_snapshot replaces.
				// Compute candidate before intent guards — only commit to the ref
				// once we know this client should apply the update.
				const snapshot =
					message.type === "drive_event" && message.event != null
						? foldIncomingDriveEvent({
								local: roomSnapshotRef.current,
								event: message.event,
								hubSnapshot,
							})
						: hubSnapshot;
				// Any human seat counts — hub join paths may use legacy ids (`you`, `human`).
				const humanSeated = snapshot.participants.some(
					(participant) => participant.kind === "human",
				);
				const wasPendingJoin = pendingJoinRef.current;
				const seatedOnCall = Boolean(snapshot.driveActive && humanSeated);
				// Ignore broadcasts when this client is not joining/on the call
				// (covers never-joined peers, cancelled joins, and optimistic leave).
				if (!driveIntentRef.current) {
					return;
				}
				// Join not reflected yet — keep waiting; do not apply or clear intent.
				// Clearing pendingJoin here would leave the "Joining…" banner stuck
				// with no in-flight join for toggleDrive to cancel.
				if (wasPendingJoin && !seatedOnCall) {
					return;
				}
				roomSnapshotRef.current = seatedOnCall ? snapshot : null;
				if (wasPendingJoin) {
					pendingJoinRef.current = false;
				}
				if (!seatedOnCall) {
					driveIntentRef.current = false;
					lastAttachedSessionIdRef.current = null;
					connectionPhaseRef.current = "off";
					setConnectionPhase("off");
					setDriveJoinNote(null);
					setPlanEditorTasks([]);
				} else {
					connectionPhaseRef.current = "on";
					setConnectionPhase("on");
				}
				setDrive((current) => {
					const next = applyRoomSnapshot(current, snapshot);
					// Slice S2 — Join auto-opens Stage so Spotlight mounts without a second click.
					if (wasPendingJoin && seatedOnCall) {
						return { ...next, stageLayout: true };
					}
					return next;
				});
				// Only sync chat mode while locally seated — not after leave/unseat.
				if (seatedOnCall) {
					onModeChangeRef.current(
						toNativeMode(fromSharedDriveSubMode(snapshot.subMode)),
					);
				}
				if (wasPendingJoin && seatedOnCall) {
					const partner =
						snapshot.participants.find((p) => p.kind === "agent")
							?.displayName ?? "partner";
					void seedBankAfterJoin(partner);
				}
				return;
			}
			if (message.type !== "drive_room_changed" || !message.room) {
				return;
			}
			const room = message.room;
			if (Array.isArray(room.chatForks)) {
				setChatForks(room.chatForks);
			}
			if (Array.isArray(room.director?.showBacklog)) {
				setShowBacklog(room.director.showBacklog as ShowBacklogItem[]);
			}
			setDrive((current) => {
				const humanFlags = room.participantAudio?.find((flag) =>
					isDriveHumanId(flag.participantId),
				);
				const partnerFlags = room.participantAudio?.find((flag) =>
					isDrivePartnerId(flag.participantId),
				);
				const spotlight =
					room.spotlightParticipantId ?? current.spotlightParticipantId;
				return {
					...current,
					spotlightParticipantId: spotlight,
					muted: humanFlags?.muted ?? current.muted,
					partnerMuted: partnerFlags?.muted ?? current.partnerMuted,
					partnerDeafened: partnerFlags?.deafened ?? current.partnerDeafened,
				};
			});
			const activeId = room.director?.activeShowId;
			const active = room.director?.showBacklog?.find(
				(item) => item.id === activeId,
			);
			if (active) {
				setPresentedShow({
					showItemId: active.id,
					title: active.title,
					caption: active.caption,
					uri: active.uri,
					ownerParticipantId: active.ownerParticipantId,
				});
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [refreshDriveRoom, resetDriveConnection, seedBankAfterJoin]);

	useEffect(() => {
		const sessionId = args.sessionId?.trim();
		if (!shouldReattachDriveSession({
			active: drive.active,
			connectionPhase,
			driveIntended: driveIntentRef.current,
			lastAttachedSessionId: lastAttachedSessionIdRef.current,
			sessionId,
		})) {
			return;
		}
		sendDriveJoin(driveRef.current, sessionId);
	}, [args.sessionId, connectionPhase, drive.active, sendDriveJoin]);

	const driveVoiceResolved = useMemo(
		() =>
			resolveDriveVoiceTopology({
				voice: driveVoice,
				providerId: args.providerId,
			}),
		[driveVoice, args.providerId],
	);

	/** Mute (human or partner) immediately cancels in-flight TTS (DRV-TTS). */
	useEffect(() => {
		if (!drive.muted && !drive.partnerMuted) {
			return;
		}
		if (!driveVoiceResolved.ok) {
			return;
		}
		createVoiceStack(driveVoiceResolved.topology).tts.cancel();
	}, [drive.muted, drive.partnerMuted, driveVoiceResolved]);

	/** Speak partner join note once when TTS is enabled and unmuted. */
	const spokenJoinNoteRef = useRef<string | null>(null);
	useEffect(() => {
		if (!driveJoinNote || !drive.active) {
			return;
		}
		// Only the post-join greeting — ack / error banners stay display-only here.
		if (!driveJoinNote.startsWith("On the call.")) {
			return;
		}
		if (spokenJoinNoteRef.current === driveJoinNote) {
			return;
		}
		if (!driveVoiceResolved.ok) {
			return;
		}
		if (
			!shouldSpeakDriveTts({
				facets: driveVoice.facets,
				muted: drive.muted,
				partnerMuted: drive.partnerMuted,
			})
		) {
			return;
		}
		spokenJoinNoteRef.current = driveJoinNote;
		void createVoiceStack(driveVoiceResolved.topology).tts.speak(
			driveJoinNote,
			{
				volume: driveVoice.hardware.outputVolume,
				sinkId: driveVoice.hardware.speakerDeviceId,
			},
		);
	}, [
		drive.active,
		drive.muted,
		drive.partnerMuted,
		driveJoinNote,
		driveVoice.facets,
		driveVoice.hardware.outputVolume,
		driveVoice.hardware.speakerDeviceId,
		driveVoiceResolved,
	]);

	useEffect(() => {
		if (!drive.active) {
			spokenJoinNoteRef.current = null;
		}
	}, [drive.active]);

	const toggleStage = useCallback(() => {
		setDrive((current) => {
			const stageLayout = !current.stageLayout;
			if (stageLayout && current.roomId) {
				const payload: {
					type: "call_get_room";
					roomId: string;
					sessionId?: string;
				} = {
					type: "call_get_room",
					roomId: current.roomId,
				};
				const sessionId = sessionIdRef.current;
				if (sessionId) {
					payload.sessionId = sessionId;
				}
				postToHost(payload);
			}
			return {
				...current,
				stageLayout,
			};
		});
	}, []);

	const toggleWorkersPanel = useCallback(() => {
		setWorkersPanelOpen((open) => {
			const next = !open;
			if (next) {
				postToHost({
					type: "driveCommand",
					command: "drive.fork.list",
					payload: { roomId: "default" },
				});
			}
			return next;
		});
	}, []);

	const openForkAudit = useCallback((auditHandle: string) => {
		setFocusedAuditHandle(auditHandle);
		setWorkersPanelOpen(true);
		postToHost({
			type: "driveCommand",
			command: "drive.fork.audit.get",
			payload: { roomId: "default", auditHandle },
		});
	}, []);

	const setForkRetain = useCallback(
		(workerSessionId: string, retain: boolean) => {
			postToHost({
				type: "driveCommand",
				command: "drive.fork.retain.set",
				payload: {
					roomId: "default",
					workerSessionId,
					retainForAudit: retain,
				},
			});
		},
		[],
	);

	const stripHandlers = useMemo(
		() => ({
			onClearOverride: () => {
				setDrive((current) => {
					const next = clearPostureOverride(current);
					args.onModeChange(toNativeMode(next.subMode));
					return next;
				});
			},
			onHandToggle: () => {
				setDrive((current) => {
					const raised = !current.handRaised;
					// First raise = signal only (pause-after-tool comes later).
					// Second toggle while already raised + sending = hard-cancel escape.
					if (current.handRaised && args.sending) {
						args.onAbort();
						args.onStatus("Drive hand-raise: abort requested...");
					}
					if (current.roomId) {
						postToHost({
							type: "call_raise_hand",
							roomId: current.roomId,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							raised,
						});
					}
					// Optimistic flip so rapid toggles see fresh state; room_snapshot
					// remains authoritative via applyRoomSnapshot.
					return { ...current, handRaised: raised };
				});
			},
			onMuteToggle: () => {
				setDrive((current) => {
					const muted = !current.muted;
					if (current.roomId) {
						postToHost({
							type: "call_mute",
							roomId: current.roomId,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							muted,
						});
						// Prefer hub snapshot for muted (applyRoomSnapshot); optimistic
						// flip so rapid toggles see fresh state.
						return { ...current, muted };
					}
					// Demo / pre-join: legacy mute path.
					postToHost({
						type: "driveCommand",
						command: "drive.participant.mute.set",
						payload: {
							roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							muted,
						},
					});
					return { ...current, muted };
				});
			},
			onOpenSettings: () => {
				setDriveVoice((current) => ({
					...current,
					settingsOpen: !current.settingsOpen,
				}));
			},
			onTogglePartnerDeafen: () => {
				// Hub is authoritative; wait for drive_room_changed.
				postToHost({
					type: "driveCommand",
					command: "drive.participant.deafen.set",
					payload: {
						roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						deafened: !drive.partnerDeafened,
					},
				});
			},
			onTogglePartnerMute: () => {
				// call_mute accepts any participantId (human or agent).
				if (drive.roomId) {
					postToHost({
						type: "call_mute",
						roomId: drive.roomId,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						muted: !drive.partnerMuted,
					});
					return;
				}
				postToHost({
					type: "driveCommand",
					command: "drive.participant.mute.set",
					payload: {
						roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						muted: !drive.partnerMuted,
					},
				});
			},
			onToggleSpotlight: () => {
				const nextId = toggleDriveSpotlightId(drive.spotlightParticipantId);
				const kind = isDriveHumanId(nextId) ? "human" : "agent";
				// call_set_stage is authoritative; live spotlight syncs from sharer.
				postToHost({
					type: "call_set_stage",
					roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
					sharer: { kind, participantId: nextId },
					pin: null,
				});
			},
			onToggleWorkers: toggleWorkersPanel,
			onSubModeChange: (subMode: DriveUiState["subMode"]) => {
				setDrive((current) => {
					const next = applySubModeIntent(current, subMode);
					// Skip hub/chat updates when intent is blocked (inactive or
					// Ask/Debug override ignoring plan/agent).
					if (next === current) {
						return current;
					}
					args.onModeChange(toNativeMode(next.subMode));
					if (current.roomId) {
						postToHost({
							type: "call_set_mode",
							roomId: current.roomId,
							subMode: toSharedDriveSubMode(next.subMode),
							driveActive: true,
						});
					}
					return next;
				});
			},
		}),
		[args, drive, toggleWorkersPanel],
	);

	return {
		drive,
		setDrive,
		connectionPhase,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		setDriveJoinNote,
		voiceCaption,
		setVoiceCaption,
		planEditorTasks,
		setPlanEditorTasks,
		bankSessionRef,
		driveVoiceResolved,
		workspaceRoot: args.workspaceRoot,
		joinDrive,
		leaveDrive,
		refreshDriveRoom,
		toggleDrive,
		toggleStage,
		stripHandlers,
		presentedShow,
		chatForks,
		showBacklog,
		workersPanelOpen,
		focusedAuditHandle,
		auditMessages,
		auditSummaryOnly,
		toggleWorkersPanel,
		openForkAudit,
		setForkRetain,
	};
}

// Re-export for settings panel wiring without Chat knowing voice helpers.
export { applyHardwarePrefsPatch, applyVoiceFacetPatch, applyVoiceProfile };
