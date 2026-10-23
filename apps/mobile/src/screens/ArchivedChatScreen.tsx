/** A saved Cloud transcript, never a synthetic live session. */
import { useMemo } from "react";
import { FlatList, View } from "react-native";
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
		messages: groupReasoningMessages(selectViewModel(state).messages),
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
			</View>
		</ReasoningStateProvider>
	);
}
