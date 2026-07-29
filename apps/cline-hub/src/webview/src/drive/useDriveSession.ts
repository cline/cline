import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { ChatForkRecord } from "@cline/shared";
import {
	applyBankSnapshot,
	applySubModeIntent,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	toNativeMode,
	type DriveUiState,
} from "./types";
import {
	isDriveHumanId,
	isDrivePartnerId,
	toggleDriveSpotlightId,
} from "./participantIds";
import {
	createDriveBankSession,
	listPlanTasks,
	seedDemoBank,
	type DriveBankSession,
} from "./bankSession";
import {
	applyHardwarePrefsPatch,
	applyVoiceFacetPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	resolveDriveVoiceTopology,
	type DriveVoiceUi,
} from "./voice/driveVoiceUi";
import { normalizeDriveHardwarePrefs } from "./voice/driveHardwarePrefs";
import { getVsCodeApi, postToHost } from "../vscode";

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
};

export type UseDriveSessionResult = {
	drive: DriveUiState;
	setDrive: Dispatch<SetStateAction<DriveUiState>>;
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

	useEffect(() => {
		try {
			const api = getVsCodeApi();
			if (!api) {
				return;
			}
			const state = (api.getState() as Record<string, unknown>) ?? {};
			api.setState({ ...state, driveUi: drive, driveVoice });
		} catch {
			// ignore
		}
	}, [drive, driveVoice]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const message = event.data as {
				type?: string;
				showItemId?: string;
				caption?: string;
				uri?: string;
				ownerParticipantId?: string;
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
					caption: message.caption,
					uri: message.uri,
					ownerParticipantId: message.ownerParticipantId,
				});
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
			if (message.type !== "drive_room_changed" || !message.room) {
				return;
			}
			const room = message.room;
			if (Array.isArray(room.chatForks)) {
				setChatForks(room.chatForks);
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
	}, []);

	const driveVoiceResolved = useMemo(
		() =>
			resolveDriveVoiceTopology({
				voice: driveVoice,
				providerId: args.providerId,
			}),
		[driveVoice, args.providerId],
	);

	const toggleDrive = useCallback(() => {
		void (async () => {
			const current = drive;
			const nextActive = !current.active;
			if (nextActive) {
				const snapshot = await seedDemoBank(bankSessionRef.current);
				const tasks = snapshot.activePlanId
					? await listPlanTasks(
							bankSessionRef.current,
							snapshot.activePlanId,
						)
					: [];
				setPlanEditorTasks(tasks);
				setDriveJoinNote(
					`On the call. I am ${current.partnerName}. Share what you want to work on and I will drive.`,
				);
				const next = applyBankSnapshot(
					{ ...current, active: true },
					snapshot,
				);
				setDrive(next);
				args.onModeChange(toNativeMode(next.subMode));
				return;
			}
			setDriveJoinNote(null);
			setPlanEditorTasks([]);
			setDrive({
				...DEFAULT_DRIVE_UI,
				partnerName: current.partnerName,
			});
			args.onModeChange("act");
		})();
	}, [args, drive]);

	const toggleStage = useCallback(() => {
		setDrive((current) => ({
			...current,
			stageLayout: !current.stageLayout,
		}));
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
					const handRaised = !current.handRaised;
					if (handRaised && args.sending) {
						args.onAbort();
						args.onStatus("Drive hand-raise: abort requested...");
					}
					return { ...current, handRaised };
				});
			},
			onMuteToggle: () => {
				// Hub is authoritative; wait for drive_room_changed.
				postToHost({
					type: "driveCommand",
					command: "drive.participant.mute.set",
					payload: {
						roomId: "default",
						participantId: DRIVE_PARTICIPANT_HUMAN,
						muted: !drive.muted,
					},
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
						roomId: "default",
						participantId: DRIVE_PARTICIPANT_PARTNER,
						deafened: !drive.partnerDeafened,
					},
				});
			},
			onTogglePartnerMute: () => {
				// Hub is authoritative; wait for drive_room_changed.
				postToHost({
					type: "driveCommand",
					command: "drive.participant.mute.set",
					payload: {
						roomId: "default",
						participantId: DRIVE_PARTICIPANT_PARTNER,
						muted: !drive.partnerMuted,
					},
				});
			},
			onToggleSpotlight: () => {
				// Hub is authoritative; wait for drive_room_changed.
				postToHost({
					type: "driveCommand",
					command: "drive.spotlight.set",
					payload: {
						roomId: "default",
						participantId: toggleDriveSpotlightId(
							drive.spotlightParticipantId,
						),
						reason: "human",
					},
				});
			},
			onToggleWorkers: toggleWorkersPanel,
			onSubModeChange: (subMode: DriveUiState["subMode"]) => {
				setDrive((current) => {
					const next = applySubModeIntent(current, subMode);
					args.onModeChange(toNativeMode(next.subMode));
					return next;
				});
			},
		}),
		[args, drive, toggleWorkersPanel],
	);

	return {
		drive,
		setDrive,
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
		toggleDrive,
		toggleStage,
		stripHandlers,
		presentedShow,
		chatForks,
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
