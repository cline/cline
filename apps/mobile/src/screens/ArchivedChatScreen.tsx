/** A saved Cloud transcript, never a synthetic live session. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	createSessionState,
	parseSessionMessagesReply,
	reduceSession,
	selectViewModel,
} from "@/session";
import { Banner, Text, useTheme } from "@/ui";
import { groupReasoningMessages, MessageRow } from "./ChatScreen";
import { ChatConnectingState } from "./chat/ChatConnectingState";
import { ChatErrorState } from "./chat/ChatErrorState";
import { ChatHeader } from "./chat/ChatHeader";
import { ConversationNavigator } from "./chat/ConversationNavigator";
import { visibleTranscriptMessages } from "./chat/message-text";
import { ReasoningStateProvider } from "./chat/reasoning-state";
import type { ToolSearchReveal } from "./chat/tool-search";
import {
	buildTranscriptWork,
	type TranscriptRow,
} from "./chat/transcript-work";

export interface ArchivedChatScreenProps {
	title?: string;
	notice?: string;
	/** Undefined is unavailable history; [] is a successfully read empty archive. */
	history?: unknown[];
	loading?: boolean;
	error?: Error;
	onRetry?: () => void | Promise<void>;
	onBack?: () => void;
	onNewChat?: () => void;
	onSignIn?: () => void | Promise<void>;
}

export function projectArchivedMessages(history: unknown[]) {
	const parsed = parseSessionMessagesReply({ messages: history });
	if (parsed.status !== "ok")
		return { messages: [], invalidCount: history.length };
	const state = reduceSession(createSessionState(), {
		type: "hydrated",
		messages: parsed.messages,
	});
	return {
		messages: groupReasoningMessages(
			visibleTranscriptMessages(selectViewModel(state).messages),
		),
		invalidCount: parsed.invalidCount,
	};
}

export function ArchivedChatScreen({
	title = "Saved conversation",
	notice,
	history,
	loading = false,
	error,
	onRetry,
	onBack,
	onNewChat,
	onSignIn,
}: ArchivedChatScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const projected = useMemo(
		() => projectArchivedMessages(history ?? []),
		[history],
	);
	const reduceMotion = useReducedMotion();
	const [openWork, setOpenWork] = useState<Record<string, boolean>>({});
	const [toolReveals, setToolReveals] = useState<
		Record<string, ToolSearchReveal>
	>({});
	const toolRevealSequence = useRef(0);
	const groupedMessages = useMemo(
		() => buildTranscriptWork(projected.messages, { runStatus: "idle" }),
		[projected.messages],
	);
	const messages = useMemo(
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
	const transcriptRef = useRef<FlatList<TranscriptRow>>(null);
	const contentHeight = useRef(0);
	const [navigatorOpen, setNavigatorOpen] = useState(false);
	const [navigationError, setNavigationError] = useState<string>();
	const messagesRef = useRef(messages);
	messagesRef.current = messages;
	const pendingJump = useRef<{ id: string; attempts: number } | undefined>(
		undefined,
	);
	const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const cancelJump = useCallback(() => {
		if (jumpTimer.current) clearTimeout(jumpTimer.current);
		jumpTimer.current = undefined;
		pendingJump.current = undefined;
	}, []);
	// Reset navigation when this read-only archive is replaced.
	// biome-ignore lint/correctness/useExhaustiveDependencies: archive identity intentionally invalidates pending jumps.
	useEffect(() => {
		cancelJump();
		setNavigatorOpen(false);
		setNavigationError(undefined);
		setOpenWork({});
		setToolReveals({});
		return cancelJump;
	}, [history, cancelJump]);
	const attemptMessageJump = useCallback(() => {
		const jump = pendingJump.current;
		if (!jump) return;
		const index = messagesRef.current.findIndex(
			(message) => message.id === jump.id,
		);
		if (index < 0) {
			cancelJump();
			return;
		}
		const attempts = jump.attempts;
		transcriptRef.current?.scrollToIndex({
			index,
			animated: false,
			viewPosition: 0.1,
		});
		if (pendingJump.current === jump && jump.attempts === attempts)
			cancelJump();
	}, [cancelJump]);
	const jumpToMessage = (id: string, query?: string) => {
		Keyboard.dismiss();
		cancelJump();
		setNavigatorOpen(false);
		setNavigationError(undefined);
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
		if (messages.some((message) => message.id === pendingJump.current?.id))
			attemptMessageJump();
	}, [messages, attemptMessageJump]);
	const scrollToLatest = () => {
		cancelJump();
		setNavigatorOpen(false);
		setNavigationError(undefined);
		transcriptRef.current?.scrollToOffset({
			offset: contentHeight.current,
			animated: !reduceMotion,
		});
	};
	return (
		<ReasoningStateProvider>
			<View
				style={{
					flex: 1,
					backgroundColor: theme.color.canvas,
					paddingTop: insets.top,
					paddingBottom: insets.bottom,
				}}
			>
				<ChatHeader
					title={title}
					subtitle="Cline Cloud · Saved conversation"
					runStatus="idle"
					showStatus={false}
					onBack={onBack}
					onNewSession={onNewChat}
					onFindInConversation={
						!loading && !error && projected.messages.length > 0
							? () => setNavigatorOpen(true)
							: undefined
					}
				/>
				{loading ? (
					<View
						accessibilityLabel="Loading saved conversation"
						style={{ flex: 1 }}
					>
						<ChatConnectingState message="Loading saved conversation…" />
					</View>
				) : error ? (
					<ChatErrorState
						error={error}
						connectionKind="cloud"
						onRetry={onRetry ?? (() => {})}
						onChooseAnotherSession={onBack}
						onSignIn={onSignIn}
						onNewChat={onNewChat}
					/>
				) : (
					<>
						<Banner
							tone="info"
							message={
								notice ??
								"This workspace has ended. Its saved conversation is read-only."
							}
						/>
						{navigationError ? (
							<Banner tone="warning" message={navigationError} />
						) : null}
						{projected.invalidCount > 0 ? (
							<Banner
								tone="warning"
								message="Some saved messages could not be displayed. The remaining conversation is shown below."
							/>
						) : null}
						{history === undefined || projected.messages.length === 0 ? (
							<View
								style={{
									flex: 1,
									alignItems: "center",
									justifyContent: "center",
									padding: 24,
								}}
							>
								<Text tone="muted" style={{ textAlign: "center" }}>
									{history === undefined
										? "No saved conversation is available for this workspace."
										: projected.invalidCount > 0
											? "This saved conversation could not be displayed."
											: "This saved conversation has no messages."}
								</Text>
							</View>
						) : (
							<FlatList
								ref={transcriptRef}
								onContentSizeChange={(_width, height) => {
									contentHeight.current = height;
								}}
								onScrollBeginDrag={cancelJump}
								onScrollToIndexFailed={({ averageItemLength, index }) => {
									const jump = pendingJump.current;
									if (!jump) return;
									jump.attempts += 1;
									if (jump.attempts > 8) {
										cancelJump();
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
								data={messages}
								keyExtractor={(message) => message.id}
								renderItem={({ item, index }) => (
									<MessageRow
										message={item}
										toolSearchReveal={toolReveals[item.id]}
										previousCreatedAt={messages[index - 1]?.createdAt}
										workExpanded={Boolean(openWork[item.id])}
										onWorkToggle={(expanded) =>
											setOpenWork((current) => ({
												...current,
												[item.id]: expanded,
											}))
										}
									/>
								)}
								contentContainerStyle={{ padding: 16, gap: 24 }}
							/>
						)}
					</>
				)}
				<ConversationNavigator
					visible={navigatorOpen}
					messages={searchableMessages}
					onClose={() => setNavigatorOpen(false)}
					onSelect={jumpToMessage}
					onBeginning={() => {
						const first = messages[0];
						if (first) jumpToMessage(first.id);
					}}
					onLatest={scrollToLatest}
				/>
			</View>
		</ReasoningStateProvider>
	);
}
