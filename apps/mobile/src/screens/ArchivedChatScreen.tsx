/** A saved Cloud transcript, never a synthetic live session. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	createSessionState,
	parseSessionMessagesReply,
	reduceSession,
	type SessionMessageView,
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
	const transcriptRef = useRef<FlatList<SessionMessageView>>(null);
	const contentHeight = useRef(0);
	const [navigatorOpen, setNavigatorOpen] = useState(false);
	const [navigationError, setNavigationError] = useState<string>();
	const messagesRef = useRef(projected.messages);
	messagesRef.current = projected.messages;
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
		return cancelJump;
	}, [history, cancelJump]);
	const attemptMessageJump = () => {
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
	};
	const jumpToMessage = (id: string) => {
		Keyboard.dismiss();
		cancelJump();
		setNavigatorOpen(false);
		setNavigationError(undefined);
		pendingJump.current = { id, attempts: 0 };
		attemptMessageJump();
	};
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
								data={projected.messages}
								keyExtractor={(message) => message.id}
								renderItem={({ item, index }) => (
									<MessageRow
										message={item}
										previousCreatedAt={projected.messages[index - 1]?.createdAt}
									/>
								)}
								contentContainerStyle={{ padding: 16, gap: 24 }}
							/>
						)}
					</>
				)}
				<ConversationNavigator
					visible={navigatorOpen}
					messages={projected.messages}
					onClose={() => setNavigatorOpen(false)}
					onSelect={jumpToMessage}
					onBeginning={() => {
						const first = projected.messages[0];
						if (first) jumpToMessage(first.id);
					}}
					onLatest={scrollToLatest}
				/>
			</View>
		</ReasoningStateProvider>
	);
}
