import { Search, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
	FlatList,
	Modal,
	Pressable,
	useWindowDimensions,
	View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionMessageView } from "@/session";
import { Button, IconButton, Text, TextField, useTheme } from "@/ui";
import { KeyboardAvoidingContainer } from "@/ui/KeyboardAvoidingContainer";
import { messageDisplayText, visibleTranscriptMessages } from "./message-text";

export function conversationEntries(
	messages: readonly SessionMessageView[],
	query: string,
) {
	const search = query.trim().toLocaleLowerCase();
	return visibleTranscriptMessages(messages).flatMap((message, index) => {
		const text = messageDisplayText(message).replace(/\s+/g, " ").trim();
		if (!text || (!search && message.role !== "user")) return [];
		const match = text.toLocaleLowerCase().indexOf(search);
		if (search && match < 0) return [];
		const start = Math.max(0, match - 45);
		return [
			{
				id: message.id,
				role: message.role,
				index,
				preview: `${start ? "…" : ""}${text.slice(start, start + 180)}${text.length > start + 180 ? "…" : ""}`,
			},
		];
	});
}

export function ConversationNavigator({
	visible,
	messages,
	onClose,
	onSelect,
	onBeginning,
	onLatest,
}: {
	visible: boolean;
	messages: readonly SessionMessageView[];
	onClose(): void;
	onSelect(id: string): void;
	onBeginning(): void;
	onLatest(): void;
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const reduceMotion = useReducedMotion();
	const [query, setQuery] = useState("");
	useEffect(() => {
		if (visible) setQuery("");
	}, [visible]);
	const entries = useMemo(
		() => conversationEntries(messages, query),
		[messages, query],
	);
	const { fontScale } = useWindowDimensions();
	if (!visible) return null;
	return (
		<Modal
			visible
			animationType={reduceMotion ? "none" : "fade"}
			onRequestClose={onClose}
			supportedOrientations={["portrait", "portrait-upside-down", "landscape"]}
		>
			<KeyboardAvoidingContainer
				key={fontScale}
				style={{
					flex: 1,
					paddingTop: insets.top + 8,
					paddingBottom: insets.bottom,
					paddingLeft: insets.left + 16,
					paddingRight: insets.right + 16,
					backgroundColor: theme.color.canvas,
					gap: 12,
				}}
			>
				<View style={{ alignItems: "flex-end" }}>
					<IconButton
						accessibilityLabel="Close conversation search"
						onPress={onClose}
					>
						<X size={20} color={theme.color.text} />
					</IconButton>
				</View>
				<FlatList
					style={{ flex: 1 }}
					data={entries}
					keyExtractor={(entry) => entry.id}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
					ListHeaderComponent={
						<View style={{ gap: 12, paddingBottom: 12 }}>
							<Text variant="heading">Find in conversation</Text>
							<Text variant="small" tone="muted">
								Jump to a prompt, or search messages.
							</Text>
							<View style={{ flexDirection: "row", gap: 10 }}>
								<Button
									label="Beginning"
									variant="outline"
									onPress={onBeginning}
									style={{ flex: 1 }}
								/>
								<Button
									label="Latest"
									variant="outline"
									onPress={onLatest}
									style={{ flex: 1 }}
								/>
							</View>
							<TextField
								accessibilityLabel="Search conversation"
								placeholder="Search messages…"
								value={query}
								onChangeText={setQuery}
								returnKeyType="search"
								autoCapitalize="none"
								leading={<Search size={18} color={theme.color.textMuted} />}
							/>
							<Text variant="caption" tone="muted">
								{query.trim()
									? `${entries.length} matching messages`
									: `${entries.length} prompts`}
							</Text>
						</View>
					}
					ListEmptyComponent={
						<Text tone="muted">
							{query.trim()
								? "No messages match your search."
								: "No prompts yet. Search to find messages."}
						</Text>
					}
					renderItem={({ item }) => (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`Jump to ${item.role === "user" ? "your prompt" : "Cline message"}: ${item.preview}`}
							onPress={() => onSelect(item.id)}
							style={{
								minHeight: 60,
								paddingVertical: 14,
								borderBottomWidth: 1,
								borderColor: theme.color.border,
								gap: 4,
							}}
						>
							<Text variant="caption" tone="muted">
								{item.role === "user" ? "You" : "Cline"}
							</Text>
							<Text numberOfLines={3}>{item.preview}</Text>
						</Pressable>
					)}
				/>
			</KeyboardAvoidingContainer>
		</Modal>
	);
}
