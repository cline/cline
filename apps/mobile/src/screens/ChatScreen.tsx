import { CheckpointControl } from "./chat/CheckpointControl";
/**
 * Renders the transcript, composer, and approvals for the route-owned connection.
 * Owns draft persistence and consumes the initial submission once the session is ready.
 */

import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import {
	ChevronDown,
	ChevronRight,
	CircleHelp,
	Clock3,
	Copy,
	RefreshCw,
	ShieldAlert,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Dimensions,
	FlatList,
	Keyboard,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Platform,
	useWindowDimensions,
	View,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
	useAnimatedStyle,
	useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CloudModelOption } from "@/cloud";
import type { UseSessionConnection } from "@/connection";
import { userErrorMessage } from "@/error-message";
import type {
	SessionInputAttachments,
	SessionMessageView,
	TokenUsageView,
} from "@/session";
import type { ReasoningChoice } from "@/session/reasoning";
import {
	clearSessionDraft,
	readSessionDraft,
	readSessionDraftImages,
	sessionDraftEpoch,
	useSessionDraftEpoch,
	writeSessionDraft,
	writeSessionDraftImages,
} from "@/state/session-drafts";
import { useApprovalPolicy } from "@/state/settings";
import {
	Banner,
	Button,
	Disclosure,
	expandBottomSheetAfterKeyboardDismiss,
	IconButton,
	Spinner,
	Text,
	useTheme,
} from "@/ui";
import { KeyboardAvoidingContainer } from "@/ui/KeyboardAvoidingContainer";
import { ApprovalSheet } from "./chat/ApprovalSheet";
import { AutoApprovePill, AutoApproveSheet } from "./chat/AutoApproveControl";
import { AssistantMessage, UserMessageBubble } from "./chat/blocks";
import { ChatConnectingState } from "./chat/ChatConnectingState";
import { ChatErrorState } from "./chat/ChatErrorState";
import { ChatHeader } from "./chat/ChatHeader";
import { Composer } from "./chat/Composer";
import { ConversationNavigator } from "./chat/ConversationNavigator";
import {
	MODEL_UNAVAILABLE_MESSAGE,
	ModelPill,
	ModelSheet,
} from "./chat/ModelControl";
import {
	messageCopyText,
	visibleTranscriptMessages,
} from "./chat/message-text";
import { QuestionSheet } from "./chat/QuestionSheet";
import { QueuedPrompts } from "./chat/QueuedPrompts";
import { ReasoningPill, ReasoningSheet } from "./chat/ReasoningControl";
import { RunSummaryCard } from "./chat/RunSummaryCard";
import { ReasoningStateProvider } from "./chat/reasoning-state";
import { summarizeLastRun } from "./chat/run-summary";
import {
	formatMessageDay,
	formatMessageRelativeTime,
	startsNewMessageDay,
} from "./chat/time";
import type { ToolSearchReveal } from "./chat/tool-search";
import {
	buildTranscriptWork,
	type TranscriptRow,
} from "./chat/transcript-work";

export interface ChatScreenProps {
	connection: UseSessionConnection;
	/** Paint surfaces into the side safe areas reserved by the session layout. */
	extendIntoSideInsets?: boolean;
	onFork?(sessionId: string): Promise<void>;
	onReviewBranch?: () => void;
	/** A Home submission to send once this connection is ready. */
	initialMessage?: string;
	initialAttachments?: SessionInputAttachments;
	/** Exact route identity used to restore an unsent draft after navigation. */
	draftKey?: string;
	/** Completes before the one-time Home submission is sent. */
	onInitialMessageConsumed?: () => void | Promise<void>;
	/** Mirrors edits into the process-local launch record used across remounts. */
	onInitialAttachmentsChange?: (userImages: string[]) => void;
	/** Lets the route guard navigation during the durable-clear/send handoff. */
	onInitialSubmissionBusyChange?: (busy: boolean) => void;
	title?: string;
	/** Human-readable session location, shown under the title. */
	subtitle?: string;
	/** Model this app requested while creating the session, when known. */
	modelLabel?: string;
	modelName?: string;
	providerId?: string;
	reasoning?: ReasoningChoice;
	supportsReasoning?: boolean;
	onReasoningChange?(choice: ReasoningChoice): void;
	supportsImages?: boolean;
	checkingImageSupport?: boolean;
	connectionKind?: "local" | "cloud";
	onSignIn?: () => void | Promise<void>;
	onConnectGitHub?: () => void | Promise<void>;
	onNewChat?: () => void;
	/** Whether the session supports changing its model. */
	canChangeModel?: boolean;
	modelLockedMessage?: string;
	connectingMessage?: string;
	loadModels?: () => Promise<readonly CloudModelOption[]>;
	cachedModels?: readonly CloudModelOption[];
	onModelChange?: (modelId: string, option?: CloudModelOption) => Promise<void>;
	onBack?: () => void;
	/** Opens the session list without stopping the current remote run. */
	onSwitchSession?: () => void;
	/**
	 * Escape hatch out of a failed connection, back to Home. Omitted hides the
	 * error state's secondary action.
	 */
	onChooseAnotherSession?: () => void;
}

export function ChatScreen(props: ChatScreenProps) {
	const epoch = useSessionDraftEpoch();
	const initialEpoch = useRef(epoch);
	const ownsInitialSubmission = initialEpoch.current === epoch;
	return (
		<ChatScreenBody
			key={epoch}
			{...props}
			initialMessage={ownsInitialSubmission ? props.initialMessage : undefined}
			initialAttachments={
				ownsInitialSubmission ? props.initialAttachments : undefined
			}
		/>
	);
}

function ChatScreenBody({
	connection,
	extendIntoSideInsets = false,
	onFork,
	onReviewBranch,
	initialMessage,
	initialAttachments,
	draftKey,
	onInitialMessageConsumed,
	onInitialAttachmentsChange,
	onInitialSubmissionBusyChange,
	title = "Session",
	subtitle,
	modelLabel,
	modelName,
	providerId,
	reasoning,
	supportsReasoning,
	onReasoningChange,
	supportsImages,
	checkingImageSupport = false,
	connectionKind,
	onSignIn,
	onConnectGitHub,
	onNewChat,
	canChangeModel = false,
	modelLockedMessage,
	connectingMessage,
	loadModels = async () => [],
	cachedModels,
	onModelChange = async () => {},
	onBack,
	onSwitchSession,
	onChooseAnotherSession,
}: ChatScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const sideInsets = extendIntoSideInsets
		? { left: insets.left, right: insets.right }
		: { left: 0, right: 0 };
	const reduceMotion = useReducedMotion();
	const { view, status } = connection;
	const [stopping, setStopping] = useState(false);
	const [stopError, setStopError] = useState<string>();
	const stopPending = useRef(false);
	const stopGeneration = useRef(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retire pending Stop feedback when its conversation or authoritative run status changes.
	useEffect(() => {
		stopGeneration.current += 1;
		stopPending.current = false;
		setStopping(false);
		setStopError(undefined);
		return () => {
			stopGeneration.current += 1;
		};
	}, [draftKey, view.runStatus]);
	const stopRun = async () => {
		if (stopPending.current) return;
		const generation = stopGeneration.current;
		stopPending.current = true;
		setStopping(true);
		setStopError(undefined);
		try {
			await connection.abort();
		} catch (cause) {
			if (generation === stopGeneration.current)
				setStopError(
					userErrorMessage(cause, "Cline could not stop this turn. Try again."),
				);
		} finally {
			if (generation === stopGeneration.current) {
				stopPending.current = false;
				setStopping(false);
			}
		}
	};
	const groupedMessages = useMemo(
		() =>
			buildTranscriptWork(
				groupReasoningMessages(visibleTranscriptMessages(view.messages)),
				{
					runStatus: view.runStatus,
					blocked:
						view.pendingApprovals.length > 0 ||
						view.pendingQuestions.length > 0,
				},
			),
		[
			view.messages,
			view.runStatus,
			view.pendingApprovals.length,
			view.pendingQuestions.length,
		],
	);
	const [openWork, setOpenWork] = useState<Record<string, boolean>>({});
	const [toolReveals, setToolReveals] = useState<
		Record<string, ToolSearchReveal>
	>({});
	const toolRevealSequence = useRef(0);
	const transcriptMessages = useMemo(
		() =>
			groupedMessages.flatMap((message) =>
				message.work && openWork[message.id]
					? [message, ...message.work.children]
					: [message],
			),
		[groupedMessages, openWork],
	);
	const searchableMessages = useMemo(
		() =>
			groupedMessages.flatMap((message) =>
				message.work ? message.work.children : [message],
			),
		[groupedMessages],
	);
	const approvalSheetRef = useRef<GorhomBottomSheet>(null);
	const questionSheetRef =
		useRef<Pick<GorhomBottomSheet, "expand" | "close">>(null);
	const autoApproveSheetRef = useRef<GorhomBottomSheet>(null);
	const reasoningSheetRef = useRef<GorhomBottomSheet>(null);
	const modelSheetRef = useRef<GorhomBottomSheet>(null);
	const { policy, setTier, store: approvalPolicyStore } = useApprovalPolicy();
	const transcriptRef = useRef<FlatList<TranscriptRow>>(null);
	const transcriptContentHeight = useRef(0);
	const [navigatorOpen, setNavigatorOpen] = useState(false);
	const [navigationError, setNavigationError] = useState<string>();
	const transcriptMessagesRef = useRef(transcriptMessages);
	transcriptMessagesRef.current = transcriptMessages;
	const pendingJump = useRef<{ id: string; attempts: number } | undefined>(
		undefined,
	);
	const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	useEffect(
		() => () => {
			if (jumpTimer.current) clearTimeout(jumpTimer.current);
			pendingJump.current = undefined;
		},
		[],
	);
	const keyboard = useReanimatedKeyboardAnimation();
	const bottomInsetStyle = useAnimatedStyle(() => ({
		height: insets.bottom * (1 - keyboard.progress.value),
		backgroundColor: theme.color.canvas,
	}));
	const [keyboardHeight, setKeyboardHeight] = useState(0);
	const window = useWindowDimensions();
	// Owned here and mirrored into a small route-keyed cache so switching sessions
	// does not throw away an unsent paragraph.
	const [draft, setDraft] = useState(
		() =>
			initialMessage ??
			(draftKey ? readSessionDraft(draftKey) : undefined) ??
			"",
	);
	// Update synchronously too: a pending save may settle before React commits an edit.
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const ownedDraftEpoch = useRef(sessionDraftEpoch()).current;
	const updateDraft = useCallback(
		(next: string) => {
			if (sessionDraftEpoch() !== ownedDraftEpoch) return;
			draftRef.current = next;
			setDraft(next);
			if (draftKey) writeSessionDraft(draftKey, next);
		},
		[draftKey, ownedDraftEpoch],
	);
	const sentInitialMessage = useRef(false);
	const initialSubmission = useRef({
		message: initialMessage?.trim() ?? "",
		exists: Boolean(
			initialMessage?.trim() || initialAttachments?.userImages?.length,
		),
	});
	const [consumingInitialSubmission, setConsumingInitialSubmission] =
		useState(false);
	const [initialConsumptionError, setInitialConsumptionError] = useState(false);
	const [initialConsumptionAttempt, setInitialConsumptionAttempt] = useState(0);
	const initialSubmissionGuarded =
		consumingInitialSubmission || initialConsumptionError;
	useEffect(() => {
		onInitialSubmissionBusyChange?.(initialSubmissionGuarded);
		return () => onInitialSubmissionBusyChange?.(false);
	}, [initialSubmissionGuarded, onInitialSubmissionBusyChange]);
	// Show the Home attachment immediately while connecting. If the caption is
	// edited it stays in the composer; if the untouched submission auto-sends,
	// clearing this removes the preview with the accepted message.
	const [stagedInitialAttachments, setStagedInitialAttachments] = useState<
		SessionInputAttachments | undefined
	>(() => {
		if (initialAttachments) return initialAttachments;
		const userImages = draftKey ? readSessionDraftImages(draftKey) : undefined;
		return userImages ? { userImages } : undefined;
	});
	const stagedInitialAttachmentsRef = useRef(stagedInitialAttachments);
	stagedInitialAttachmentsRef.current = stagedInitialAttachments;
	const initialImageCapabilityRef = useRef({
		checkingImageSupport,
		supportsImages,
	});
	initialImageCapabilityRef.current = { checkingImageSupport, supportsImages };
	const updateStagedImages = useCallback(
		(userImages: string[]) => {
			if (sessionDraftEpoch() !== ownedDraftEpoch) return;
			const next = userImages.length > 0 ? { userImages } : undefined;
			stagedInitialAttachmentsRef.current = next;
			setStagedInitialAttachments(next);
			if (draftKey) writeSessionDraftImages(draftKey, userImages);
			onInitialAttachmentsChange?.(userImages);
		},
		[draftKey, onInitialAttachmentsChange, ownedDraftEpoch],
	);
	useEffect(() => {
		if (draftKey && sessionDraftEpoch() === ownedDraftEpoch) {
			writeSessionDraftImages(
				draftKey,
				stagedInitialAttachments?.userImages ?? [],
			);
		}
	}, [draftKey, stagedInitialAttachments, ownedDraftEpoch]);
	const [followingTranscript, setFollowingTranscript] = useState(true);
	const [modelSection, setModelSection] = useState<"providers" | "models">(
		"models",
	);
	// Native layout emits scroll events before the initial follow scroll settles.
	// Only a user gesture may opt out of following the resumed transcript.
	const transcriptInteracted = useRef(false);
	const userMessageCount = view.messages.filter(
		(message) => message.role === "user",
	).length;
	const transcriptLive =
		status.phase === "ready" && view.connectionStatus === "live";
	const previousTranscript = useRef({ userMessageCount, live: transcriptLive });
	useEffect(() => {
		const previous = previousTranscript.current;
		previousTranscript.current = { userMessageCount, live: transcriptLive };
		// Like desktop, a new user turn restores following; re-keying an
		// optimistic bubble or hydrating saved history must not jump the reader.
		if (
			transcriptLive &&
			previous.live &&
			userMessageCount > previous.userMessageCount
		) {
			setFollowingTranscript(true);
			transcriptRef.current?.scrollToOffset({
				offset: transcriptContentHeight.current,
				animated: false,
			});
		}
	}, [userMessageCount, transcriptLive]);
	useEffect(() => {
		const show = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			(event) => {
				setKeyboardHeight(event?.endCoordinates?.height ?? 0);
			},
		);
		const hide = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => {
				setKeyboardHeight(0);
			},
		);
		const frame =
			Platform.OS === "ios"
				? Keyboard.addListener("keyboardWillChangeFrame", (event) => {
						const visible =
							event.endCoordinates.screenY < Dimensions.get("window").height;
						setKeyboardHeight(visible ? event.endCoordinates.height : 0);
					})
				: undefined;
		return () => {
			show.remove();
			hide.remove();
			frame?.remove();
		};
	}, []);

	const previousDraftKeyRef = useRef(draftKey);
	useEffect(() => {
		if (sessionDraftEpoch() !== ownedDraftEpoch) return;
		const previousKey = previousDraftKeyRef.current;
		if (previousKey === draftKey) {
			return;
		}
		// Cloud initially opens against `latest`, then pins the exact inner Hub
		// session without remounting this screen. Move the live draft with that key
		// so navigating away after resolution cannot discard what the user typed.
		if (previousKey) {
			clearSessionDraft(previousKey);
		}
		if (draftKey) {
			writeSessionDraft(draftKey, draftRef.current);
		}
		previousDraftKeyRef.current = draftKey;
	}, [draftKey, ownedDraftEpoch]);
	useEffect(() => {
		// A tap on the retry banner advances this token to re-run the one-shot.
		void initialConsumptionAttempt;
		const { message, exists } = initialSubmission.current;
		if (
			!exists ||
			!message ||
			((checkingImageSupport || supportsImages === false) &&
				Boolean(stagedInitialAttachmentsRef.current?.userImages?.length)) ||
			status.phase !== "ready" ||
			sentInitialMessage.current
		) {
			return;
		}
		sentInitialMessage.current = true;
		setConsumingInitialSubmission(true);
		setInitialConsumptionError(false);
		const consume = async () => {
			try {
				await onInitialMessageConsumed?.();
			} catch {
				sentInitialMessage.current = false;
				setConsumingInitialSubmission(false);
				setInitialConsumptionError(true);
				return;
			}
			// Persistence can be slow. Re-read both editable values after it settles;
			// any text edit is takeover, and removed images must never be uploaded.
			if (sessionDraftEpoch() !== ownedDraftEpoch) return;
			const currentAttachments = stagedInitialAttachmentsRef.current;
			if (draftRef.current.trim() !== message) {
				setConsumingInitialSubmission(false);
				return;
			}
			const capability = initialImageCapabilityRef.current;
			if (
				currentAttachments?.userImages?.length &&
				(capability.checkingImageSupport || capability.supportsImages === false)
			) {
				// Consumption is durable, but the changed model cannot accept these images.
				// Keep the editable payload for an explicit send after the user resolves it.
				setConsumingInitialSubmission(false);
				return;
			}
			updateStagedImages([]);
			setConsumingInitialSubmission(false);
			updateDraft("");
			const send = currentAttachments
				? connection.sendInput(message, currentAttachments)
				: connection.sendInput(message);
			void send.catch(() => {
				// SessionConnection retains the complete failed bubble for Retry, just
				// like manual sends. Never overwrite a newer draft or duplicate the send
				// back into the composer after a late/lost acknowledgement.
			});
		};
		void consume();
	}, [
		connection.sendInput,
		initialConsumptionAttempt,
		onInitialMessageConsumed,
		ownedDraftEpoch,
		status.phase,
		supportsImages,
		checkingImageSupport,
		updateDraft,
		updateStagedImages,
	]);

	const running = view.runStatus === "running";
	// The outcome card describes the run that just ended; it leaves the moment a
	// new run starts and never renders for runs this client did not watch.
	const runSummary =
		!running && view.lastRun?.outcome
			? summarizeLastRun(view.messages)
			: undefined;
	const reconnecting = view.connectionStatus === "reconnecting";
	const disconnected =
		view.connectionStatus === "closed" || view.connectionStatus === "error";
	const connecting =
		status.phase === "connecting" && view.messages.length === 0;
	const approvalCount = view.pendingApprovals.length;
	const questionCount = view.pendingQuestions.length;
	const awaitingOutput =
		transcriptLive &&
		running &&
		view.awaitingOutput &&
		!approvalCount &&
		!questionCount &&
		!view.lastError;
	const scrollToLatest = () => {
		if (jumpTimer.current) clearTimeout(jumpTimer.current);
		pendingJump.current = undefined;
		setNavigatorOpen(false);
		setNavigationError(undefined);
		transcriptRef.current?.scrollToOffset({
			offset: transcriptContentHeight.current,
			animated: !reduceMotion,
		});
		setFollowingTranscript(true);
	};
	const attemptMessageJump = useCallback(() => {
		const jump = pendingJump.current;
		if (!jump) return;
		const index = transcriptMessagesRef.current.findIndex(
			(message) =>
				message.id === jump.id || message.sourceMessageIds?.includes(jump.id),
		);
		if (index < 0) {
			pendingJump.current = undefined;
			return;
		}
		const attempts = jump.attempts;
		transcriptRef.current?.scrollToIndex({
			index,
			animated: false,
			viewPosition: 0.1,
		});
		if (pendingJump.current === jump && jump.attempts === attempts)
			pendingJump.current = undefined;
	}, []);
	const jumpToMessage = (id: string, query?: string) => {
		Keyboard.dismiss();
		if (jumpTimer.current) clearTimeout(jumpTimer.current);
		setNavigatorOpen(false);
		setNavigationError(undefined);
		transcriptInteracted.current = true;
		setFollowingTranscript(false);
		const target =
			searchableMessages.find((message) => message.id === id) ??
			searchableMessages.find((message) =>
				message.sourceMessageIds?.includes(id),
			);
		pendingJump.current = { id: target?.id ?? id, attempts: 0 };
		if (
			target &&
			query &&
			target.blocks.some((block) => block.kind === "tool")
		) {
			const sequence = ++toolRevealSequence.current;
			setToolReveals((current) => ({
				...current,
				[target.id]: { query, sequence },
			}));
		}
		if (target?.parentWorkId && !openWork[target.parentWorkId]) {
			const workId = target.parentWorkId;
			setOpenWork((current) => ({ ...current, [workId]: true }));
			return;
		}
		attemptMessageJump();
	};
	useEffect(() => {
		if (
			transcriptMessages.some(
				(message) => message.id === pendingJump.current?.id,
			)
		)
			attemptMessageJump();
	}, [transcriptMessages, attemptMessageJump]);
	const trackTranscriptPosition = (
		event: NativeSyntheticEvent<NativeScrollEvent>,
	) => {
		if (!transcriptInteracted.current) return;
		const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
		const distanceFromEnd =
			contentSize.height - layoutMeasurement.height - contentOffset.y;
		setFollowingTranscript(distanceFromEnd <= 72);
	};

	return (
		// The transcript is virtualised, so a reasoning block the user collapsed can
		// unmount; this provider keeps that choice for the life of the session.
		<ReasoningStateProvider>
			<View
				style={{
					flex: 1,
					backgroundColor: theme.color.canvas,
					marginLeft: -sideInsets.left,
					marginRight: -sideInsets.right,
				}}
			>
				<View>
					<View
						style={{ height: insets.top, backgroundColor: theme.color.surface }}
					/>
					<ChatHeader
						horizontalInsets={sideInsets}
						onReviewBranch={onReviewBranch}
						onFindInConversation={
							transcriptMessages.length
								? () => {
										Keyboard.dismiss();
										setNavigatorOpen(true);
									}
								: undefined
						}
						title={title}
						subtitle={subtitle}
						runStatus={view.runStatus}
						showStatus={transcriptLive}
						onBack={initialSubmissionGuarded ? undefined : onBack}
						onNewSession={initialSubmissionGuarded ? undefined : onNewChat}
						onSwitchSession={
							initialSubmissionGuarded ? undefined : onSwitchSession
						}
					/>

					<View
						style={{
							paddingLeft: sideInsets.left,
							paddingRight: sideInsets.right,
						}}
					>
						{reconnecting ? (
							<Banner
								tone="info"
								pulse
								leading={<RefreshCw size={14} color={theme.feedback.info.fg} />}
								message="Reconnecting — your session is preserved."
							/>
						) : null}

						{initialConsumptionError ? (
							<Banner
								tone="danger"
								message="Cline couldn't safely save this send. Tap to retry."
								accessibilityLabel="Retry saving this send"
								onPress={() => {
									setInitialConsumptionError(false);
									setInitialConsumptionAttempt((attempt) => attempt + 1);
								}}
							/>
						) : null}

						{disconnected && status.phase !== "error" ? (
							<Banner
								tone="danger"
								message="Connection lost — tap to reconnect."
								accessibilityLabel="Connection lost. Reconnect"
								onPress={() => void connection.reconnect()}
							/>
						) : null}

						{stopping ? (
							<Text accessibilityLiveRegion="polite">Stopping Cline…</Text>
						) : null}
						{stopError && running ? (
							<Banner tone="danger">
								<Text accessibilityRole="alert">{stopError}</Text>
								<Button
									label="Retry stop"
									disabled={stopping}
									onPress={() => void stopRun()}
								/>
							</Banner>
						) : null}
						{view.runStatus === "failed" && status.phase === "ready" ? (
							<Banner tone="danger">
								<Text variant="small" tone="danger" accessibilityRole="alert">
									{userErrorMessage(
										view.lastError === "run failed"
											? undefined
											: view.lastError,
										"Cline couldn't finish this turn. Try sending again or choose another model.",
									)}
								</Text>
							</Banner>
						) : null}

						{approvalCount > 0 ? (
							<Banner
								tone="warning"
								leading={
									<ShieldAlert size={14} color={theme.feedback.warning.fg} />
								}
								message={`${approvalCount} tool approval${
									approvalCount === 1 ? "" : "s"
								} waiting — tap to review`}
								trailing={
									<ChevronRight size={16} color={theme.feedback.warning.fg} />
								}
								accessibilityLabel="Review pending approvals"
								onPress={() =>
									expandBottomSheetAfterKeyboardDismiss(approvalSheetRef)
								}
							/>
						) : null}

						{view.questionInterrupted ? (
							<Banner
								tone="warning"
								message="The connection interrupted Cline's question. Ask Cline to repeat it when you're connected again."
							/>
						) : null}
						{questionCount > 0 ? (
							<Banner
								tone="info"
								leading={<CircleHelp size={14} color={theme.brand.violet} />}
								message={`Cline has ${questionCount === 1 ? "a question" : `${questionCount} questions`} — tap to answer`}
								trailing={<ChevronRight size={16} color={theme.brand.violet} />}
								accessibilityLabel="Answer Cline's question"
								onPress={() =>
									expandBottomSheetAfterKeyboardDismiss(questionSheetRef)
								}
							/>
						) : null}
					</View>
				</View>

				<KeyboardAvoidingContainer style={{ flex: 1 }}>
					{status.phase === "error" ? (
						<View
							style={{
								flex: 1,
								paddingLeft: sideInsets.left,
								paddingRight: sideInsets.right,
							}}
						>
							<ChatErrorState
								error={status.error}
								onRetry={connection.reconnect}
								onChooseAnotherSession={onChooseAnotherSession}
								connectionKind={connectionKind}
								onSignIn={onSignIn}
								onConnectGitHub={onConnectGitHub}
								onNewChat={onNewChat}
							/>
						</View>
					) : connecting ? (
						<View
							style={{
								flex: 1,
								paddingLeft: sideInsets.left,
								paddingRight: sideInsets.right,
							}}
						>
							<ChatConnectingState message={connectingMessage} />
						</View>
					) : (
						<View style={{ flex: 1 }}>
							{navigationError ? (
								<Banner tone="warning" message={navigationError} />
							) : null}
							<FlatList
								ref={transcriptRef}
								data={transcriptMessages}
								keyExtractor={(item) => item.id}
								renderItem={({ item, index }) => (
									<MessageRow
										message={item}
										toolSearchReveal={toolReveals[item.id]}
										previousCreatedAt={transcriptMessages[index - 1]?.createdAt}
										onRetry={() => connection.retrySend(item.id)}
										workExpanded={Boolean(openWork[item.id])}
										onWorkToggle={(expanded) =>
											setOpenWork((current) => ({
												...current,
												[item.id]: expanded,
											}))
										}
									/>
								)}
								contentContainerStyle={{
									paddingLeft: sideInsets.left + 16,
									paddingRight: sideInsets.right + 16,
									paddingTop: 24,
									paddingBottom: 20,
									gap: 24,
									flexGrow: transcriptMessages.length === 0 ? 1 : undefined,
								}}
								ListFooterComponent={
									awaitingOutput ? (
										<View
											testID="thinking-indicator"
											accessible
											accessibilityLabel="Thinking…"
											accessibilityLiveRegion="polite"
											style={{
												flexDirection: "row",
												alignItems: "center",
												gap: 8,
												paddingVertical: 8,
											}}
										>
											<Spinner size={14} />
											<Text variant="small" tone="muted">
												Thinking…
											</Text>
										</View>
									) : view.lastRun && runSummary ? (
										<RunSummaryCard
											lastRun={view.lastRun}
											summary={runSummary}
										/>
									) : null
								}
								onScroll={trackTranscriptPosition}
								onScrollBeginDrag={() => {
									if (jumpTimer.current) clearTimeout(jumpTimer.current);
									pendingJump.current = undefined;
									transcriptInteracted.current = true;
								}}
								onScrollToIndexFailed={({ averageItemLength, index }) => {
									const jump = pendingJump.current;
									if (!jump) return;
									jump.attempts += 1;
									if (jump.attempts > 8) {
										pendingJump.current = undefined;
										setNavigationError(
											"This message could not be located. Try searching again.",
										);
										return;
									}
									transcriptRef.current?.scrollToOffset({
										offset: Math.max(0, averageItemLength * index),
										animated: false,
									});
									if (jumpTimer.current) clearTimeout(jumpTimer.current);
									jumpTimer.current = setTimeout(attemptMessageJump, 120);
								}}
								onLayout={() => {
									if (followingTranscript)
										transcriptRef.current?.scrollToOffset({
											offset: transcriptContentHeight.current,
											animated: false,
										});
								}}
								onContentSizeChange={(_width, height) => {
									transcriptContentHeight.current = height;
									if (followingTranscript) {
										transcriptRef.current?.scrollToOffset({
											// scrollToEnd estimates unmeasured rows; use the native
											// content extent instead (the scroll view clamps to its end).
											offset: height,
											// Streaming can resize on every token. Queueing an animation
											// per delta makes the transcript visibly bounce behind the model.
											animated: false,
										});
									}
								}}
								scrollEventThrottle={16}
							/>
							{!followingTranscript && view.messages.length > 0 ? (
								<Button
									label="Latest"
									size="sm"
									variant="outline"
									accessibilityLabel="Jump to latest message"
									onPress={scrollToLatest}
									icon={<ChevronDown size={18} color={theme.color.text} />}
									style={{
										position: "absolute",
										right: sideInsets.right + 16,
										bottom: 12,
										borderWidth: 1,
										borderColor: theme.color.border,
									}}
								/>
							) : null}
						</View>
					)}

					<Composer
						horizontalInsets={sideInsets}
						maxHeight={Math.max(
							110,
							(window.height -
								(Platform.OS === "ios" ? keyboardHeight : 0) -
								insets.top -
								52) *
								0.7,
						)}
						compact={window.height < 500}
						supportsImages={supportsImages}
						checkingImageSupport={checkingImageSupport}
						running={running}
						sendDisabled={
							status.phase !== "ready" ||
							disconnected ||
							initialSubmissionGuarded
						}
						usageTotal={resolveUsage(view.usage)}
						draft={draft}
						initialUserImages={stagedInitialAttachments?.userImages}
						onUserImagesChange={updateStagedImages}
						onDraftChange={updateDraft}
						onSend={(text, attachments) =>
							connection.sendInput(text, attachments)
						}
						onAbort={() => void stopRun()}
						controls={
							<ModelPill
								providerId={providerId}
								modelId={modelLabel}
								modelName={modelName}
								compactLabel
								onPress={() => {
									setModelSection("models");
									expandBottomSheetAfterKeyboardDismiss(modelSheetRef);
								}}
							/>
						}
						queued={
							<QueuedPrompts
								prompts={view.pendingPrompts}
								running={running}
								onRemove={(id) => connection.removePendingPrompt(id)}
								onSteer={(id) =>
									connection.updatePendingPrompt(id, { delivery: "steer" })
								}
								onEdit={(id, prompt) =>
									connection.updatePendingPrompt(id, { prompt })
								}
							/>
						}
					/>
					<Animated.View style={bottomInsetStyle} />
				</KeyboardAvoidingContainer>

				<ConversationNavigator
					visible={navigatorOpen}
					messages={searchableMessages}
					onClose={() => setNavigatorOpen(false)}
					onSelect={jumpToMessage}
					onBeginning={() => {
						const first = transcriptMessages[0];
						if (first) jumpToMessage(first.id);
					}}
					onLatest={scrollToLatest}
				/>
				<ApprovalSheet
					connectionKind={connectionKind}
					sheetRef={approvalSheetRef}
					approvals={view.pendingApprovals}
					onRespond={(id, approved, reason) =>
						connection.respondApproval(id, approved, reason)
					}
				/>
				<QuestionSheet
					draftKey={draftKey}
					draftsReady={view.connectionStatus === "live"}
					sheetRef={questionSheetRef}
					questions={view.pendingQuestions}
					onAnswer={(requestId, answer) =>
						connection.respondQuestion(requestId, answer)
					}
				/>
				{/* Bottom sheets must be screen-level siblings. Mounting this inside the
				    composer's controls row constrains Gorhom's gesture surface to that
				    row and can leave an invisible native layer over the TextInput. */}
				{connectionKind === "local" && (
					<AutoApproveSheet
						sheetRef={autoApproveSheetRef}
						policy={policy}
						onSetTier={(tier, value) => void setTier(tier, value)}
						onSetPolicy={(next) => void approvalPolicyStore.setPolicy(next)}
					/>
				)}
				<ModelSheet
					cloud={connectionKind === "cloud"}
					cachedModels={cachedModels}
					initialSection={modelSection}
					sheetRef={modelSheetRef}
					providerId={providerId}
					modelId={modelLabel}
					canChange={canChangeModel}
					busy={running}
					lockedMessage={modelLockedMessage ?? MODEL_UNAVAILABLE_MESSAGE}
					loadModels={loadModels}
					onChange={onModelChange}
					settings={(dismiss) => (
						<>
							{connectionKind === "local" && onFork ? (
								<CheckpointControl
									connection={connection}
									disabled={
										running ||
										status.phase !== "ready" ||
										initialSubmissionGuarded
									}
									onFork={onFork}
									beforeOpen={dismiss}
								/>
							) : null}
							{connectionKind === "local" ? (
								<AutoApprovePill
									policy={policy}
									onPress={() =>
										dismiss(() =>
											expandBottomSheetAfterKeyboardDismiss(
												autoApproveSheetRef,
											),
										)
									}
								/>
							) : null}
							{onReasoningChange ? (
								<ReasoningPill
									value={reasoning}
									supported={supportsReasoning}
									loading={checkingImageSupport}
									onPress={() =>
										dismiss(() =>
											expandBottomSheetAfterKeyboardDismiss(reasoningSheetRef),
										)
									}
								/>
							) : null}
						</>
					)}
				/>
				{onReasoningChange ? (
					<ReasoningSheet
						sheetRef={reasoningSheetRef}
						value={reasoning}
						supported={supportsReasoning}
						onChange={onReasoningChange}
					/>
				) : null}
			</View>
		</ReasoningStateProvider>
	);
}

/** Desktop folds reasoning-only assistant fragments into the answer they lead. */
export function groupReasoningMessages(
	messages: readonly SessionMessageView[],
): SessionMessageView[] {
	const result: SessionMessageView[] = [];
	let pending: SessionMessageView[] = [];
	const flushPending = () => {
		if (pending.length === 0) return;
		result.push(combineAssistantMessages(pending));
		pending = [];
	};

	for (const message of messages) {
		const reasoningOnly =
			message.role === "assistant" &&
			message.displayRole !== "error" &&
			message.blocks.length > 0 &&
			message.blocks.every((block) => block.kind === "reasoning");
		if (reasoningOnly) {
			pending.push(message);
			continue;
		}
		if (
			pending.length > 0 &&
			message.role === "assistant" &&
			message.displayRole !== "error"
		) {
			result.push(combineAssistantMessages([...pending, message]));
			pending = [];
			continue;
		}
		flushPending();
		result.push(message);
	}
	flushPending();
	return result;
}

function combineAssistantMessages(
	messages: readonly SessionMessageView[],
): SessionMessageView {
	if (messages.length === 1 && messages[0]) return messages[0];
	const first = messages[0];
	const last = messages.at(-1);
	if (!first || !last)
		throw new Error("Cannot combine an empty message group.");
	return {
		// The first fragment owns the row. Keeping its id stable preserves FlatList
		// identity and the remembered disclosure state as the answer arrives.
		id: first.id,
		role: "assistant",
		origin: last.origin,
		...(first.createdAt === undefined ? {} : { createdAt: first.createdAt }),
		blocks: messages.flatMap((message) => message.blocks),
	};
}

export function MessageRow({
	message,
	previousCreatedAt,
	onRetry,
	workExpanded = false,
	onWorkToggle,
	toolSearchReveal,
}: {
	message: TranscriptRow;
	previousCreatedAt?: number;
	onRetry?: () => void;
	workExpanded?: boolean;
	onWorkToggle?(expanded: boolean): void;
	toolSearchReveal?: ToolSearchReveal;
}) {
	const theme = useTheme();
	const [showTimestamp, setShowTimestamp] = useState(false);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const copyText = messageCopyText(message);
	const copyMessage = async () => {
		try {
			await Clipboard.setStringAsync(copyText);
			setCopyState("copied");
		} catch {
			setCopyState("failed");
		}
	};
	const daySeparator = startsNewMessageDay(
		message.createdAt,
		previousCreatedAt,
	);
	if (message.hidden) return null;
	if (message.work)
		return (
			<Disclosure
				label={`Worked · ${message.work.toolCallCount} ${message.work.toolCallCount === 1 ? "tool" : "tools"}`}
				accessibilityLabel={`Work, ${message.work.toolCallCount} ${message.work.toolCallCount === 1 ? "tool" : "tools"}`}
				expanded={workExpanded}
				onToggle={onWorkToggle}
			></Disclosure>
		);
	if (message.parentWorkId)
		return (
			<View style={{ paddingLeft: 24 }}>
				<AssistantMessage
					message={message}
					toolSearchReveal={toolSearchReveal}
				/>
			</View>
		);
	const body =
		message.role === "user" ? (
			<View style={{ gap: 6 }}>
				<UserMessageBubble message={message} />
				{message.failed && onRetry ? (
					<View
						style={{
							alignSelf: "flex-end",
							maxWidth: "85%",
							gap: 6,
							padding: 10,
							borderRadius: theme.radius.md,
							backgroundColor: theme.feedback.danger.subtle,
							borderWidth: 1,
							borderColor: theme.feedback.danger.border,
						}}
					>
						<Text variant="small" tone="danger">
							Failed to send —{` `}
							{userErrorMessage(
								message.error,
								"Check the connection and try again.",
							)}
						</Text>
						<Button
							label="Retry"
							variant="outline"
							size="sm"
							icon={<RefreshCw size={14} color={theme.color.text} />}
							onPress={onRetry}
						/>
					</View>
				) : null}
			</View>
		) : (
			<AssistantMessage message={message} toolSearchReveal={toolSearchReveal} />
		);

	return (
		<View style={{ gap: 7 }}>
			{daySeparator && message.createdAt !== undefined ? (
				<View
					accessible
					accessibilityRole="text"
					accessibilityLabel={formatMessageDay(message.createdAt)}
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: 10,
						marginVertical: 6,
					}}
				>
					<View
						style={{ flex: 1, height: 1, backgroundColor: theme.color.border }}
					/>
					<Text variant="caption" tone="muted">
						{formatMessageDay(message.createdAt)}
					</Text>
					<View
						style={{ flex: 1, height: 1, backgroundColor: theme.color.border }}
					/>
				</View>
			) : null}
			{body}
			<View
				testID="message-actions"
				style={{
					flexDirection: "row",
					alignItems: "center",
					flexWrap: "wrap",
					gap: 4,
					alignSelf: message.role === "user" ? "flex-end" : "flex-start",
				}}
			>
				{copyText ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 6,
						}}
					>
						<IconButton
							accessibilityLabel={`Copy ${message.role} message`}
							onPress={() => void copyMessage()}
						>
							<Copy size={14} color={theme.color.textMuted} />
						</IconButton>
						{copyState !== "idle" ? (
							<Text
								variant="caption"
								tone={copyState === "failed" ? "danger" : "muted"}
							>
								{copyState === "copied"
									? "Copied"
									: "Couldn't copy. Try again."}
							</Text>
						) : null}
					</View>
				) : null}
				{message.createdAt !== undefined ? (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 4,
						}}
					>
						<IconButton
							accessibilityLabel={`${showTimestamp ? "Hide" : "Show"} timestamp for ${message.role} message`}
							onPress={() => setShowTimestamp((visible) => !visible)}
							padding={2}
							hitSlop={10}
							style={{ minWidth: 24, minHeight: 24 }}
						>
							<Clock3 size={12} color={theme.color.textMuted} />
						</IconButton>
						{showTimestamp ? (
							<Text variant="caption" tone="muted">
								{formatMessageRelativeTime(message.createdAt)}
							</Text>
						) : null}
					</View>
				) : null}
			</View>
		</View>
	);
}

function resolveUsage(usage: {
	turns: TokenUsageView[];
	total?: TokenUsageView;
}): TokenUsageView | undefined {
	if (usage.total) {
		return usage.total;
	}
	if (usage.turns.length === 0) {
		return undefined;
	}
	return usage.turns.reduce((acc, turn) => ({
		inputTokens: acc.inputTokens + turn.inputTokens,
		outputTokens: acc.outputTokens + turn.outputTokens,
		cacheReadTokens: acc.cacheReadTokens + turn.cacheReadTokens,
		cacheWriteTokens: acc.cacheWriteTokens + turn.cacheWriteTokens,
		totalCost: acc.totalCost + turn.totalCost,
	}));
}
