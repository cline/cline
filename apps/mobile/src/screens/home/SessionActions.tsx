import { Pencil, Square, Trash2 } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	type PressableProps,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { userErrorMessage } from "@/error-message";
import { Button, Text, TextField, useTheme } from "@/ui";
import type { SessionRow } from "./session-rows";

export type SessionActionTriggerProps = Pick<
	PressableProps,
	"onLongPress" | "accessibilityActions" | "onAccessibilityAction"
> & { pending?: boolean };

export interface SessionActionsProps {
	row: SessionRow;
	children: (trigger: SessionActionTriggerProps) => ReactNode;
	onRenameSession?: (row: SessionRow, title: string) => Promise<void>;
	onDeleteSession?: (row: SessionRow) => Promise<void>;
	onStopWorkspace?: (row: SessionRow) => Promise<void>;
}

export function SessionActions({
	row,
	children,
	onRenameSession,
	onDeleteSession,
	onStopWorkspace,
}: SessionActionsProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const reducedMotion = useReducedMotion();
	const triggerRef = useRef<View>(null);
	const [anchor, setAnchor] = useState({
		x: 12,
		width: width - 64,
		y: insets.top + 120,
		height: 44,
	});
	const [mode, setMode] = useState<
		"closed" | "menu" | "rename" | "delete" | "stop"
	>("closed");
	useEffect(() => {
		// The anchor belongs to the old viewport; keep an in-progress rename intact.
		setMode((current) => (current === "menu" ? "closed" : current));
	}, [width, height]);
	const [title, setTitle] = useState(row.title);
	const [pending, setPending] = useState(false);
	const pendingRef = useRef(false);
	const [error, setError] = useState<string>();
	const stopWorkspace = row.canStopWorkspace ? onStopWorkspace : undefined;
	if (
		row.descriptor.mode !== "cloud" ||
		(!onRenameSession && !onDeleteSession && !stopWorkspace)
	)
		return <>{children({})}</>;
	const close = () => {
		if (pendingRef.current) return;
		Keyboard.dismiss();
		setMode("closed");
		setError(undefined);
	};
	const run = async (action: () => Promise<void>) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(undefined);
		Keyboard.dismiss();
		try {
			await action();
			setMode("closed");
		} catch (cause) {
			setError(
				userErrorMessage(cause, "Couldn't update this session. Try again."),
			);
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};
	const menuHeight =
		8 +
		44 *
			(Number(Boolean(onRenameSession)) +
				Number(Boolean(onDeleteSession)) +
				Number(Boolean(stopWorkspace)));
	const menuWidth = Math.min(220, width - insets.left - insets.right - 24);
	const menuTop =
		anchor.y + anchor.height + menuHeight + 8 < height - insets.bottom
			? anchor.y + anchor.height + 4
			: Math.max(insets.top + 8, anchor.y - menuHeight - 4);
	const menuItem = (
		label: string,
		destructive: boolean,
		onPress: () => void,
		icon?: ReactNode,
	) => (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 44,
				paddingHorizontal: 12,
				flexDirection: "row",
				alignItems: "center",
				gap: 10,
				borderRadius: theme.radius.sm,
				backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
			})}
		>
			{icon ??
				(destructive ? (
					<Trash2 size={16} color={theme.color.danger} />
				) : (
					<Pencil size={16} color={theme.color.textMuted} />
				))}
			<Text color={destructive ? theme.color.danger : theme.color.text}>
				{label}
			</Text>
		</Pressable>
	);
	const openMenu = () => {
		if (pendingRef.current) return;
		Keyboard.dismiss();
		triggerRef.current?.measureInWindow((x, y, width, height) =>
			setAnchor({ x, y, width, height }),
		);
		setTitle(row.title);
		setError(undefined);
		setMode("menu");
	};
	return (
		<View ref={triggerRef} collapsable={false}>
			{children({
				pending,
				onLongPress: openMenu,
				accessibilityActions: [
					{ name: "sessionActions", label: "Session actions" },
				],
				onAccessibilityAction: (event) => {
					if (event.nativeEvent.actionName === "sessionActions") openMenu();
				},
			})}
			{mode !== "closed" ? (
				<Modal
					supportedOrientations={[
						"portrait",
						"portrait-upside-down",
						"landscape",
					]}
					transparent
					statusBarTranslucent
					presentationStyle="overFullScreen"
					animationType={reducedMotion ? "none" : "fade"}
					onRequestClose={close}
					visible
				>
					<KeyboardAvoidingView
						style={{ flex: 1 }}
						behavior={Platform.OS === "ios" ? "padding" : "height"}
					>
						<Pressable
							accessibilityLabel="Dismiss session actions"
							accessibilityRole="button"
							disabled={pending}
							onPress={close}
							style={[
								StyleSheet.absoluteFill,
								{
									backgroundColor:
										mode === "menu" ? "transparent" : "rgba(0,0,0,0.5)",
								},
							]}
						/>
						{mode === "menu" ? (
							<View
								accessibilityViewIsModal
								onAccessibilityEscape={close}
								testID="session-actions-menu"
								style={{
									position: "absolute",
									top: menuTop,
									left: Math.max(
										insets.left + 12,
										Math.min(
											anchor.x + anchor.width - menuWidth,
											width - insets.right - menuWidth - 12,
										),
									),
									width: menuWidth,
									padding: 4,
									backgroundColor: theme.color.popover,
									borderWidth: 1,
									borderColor: theme.color.border,
									borderRadius: theme.radius.md,
									shadowColor: "#000",
									shadowOpacity: 0.25,
									shadowRadius: 12,
									shadowOffset: { width: 0, height: 4 },
									elevation: 12,
								}}
							>
								{onRenameSession
									? menuItem("Rename session", false, () => setMode("rename"))
									: null}
								{stopWorkspace
									? menuItem(
											"Stop workspace",
											false,
											() => setMode("stop"),
											<Square size={16} color={theme.color.textMuted} />,
										)
									: null}
								{onDeleteSession
									? menuItem("Delete session", true, () => setMode("delete"))
									: null}
							</View>
						) : (
							<View
								pointerEvents="box-none"
								style={{
									flex: 1,
									justifyContent: "center",
									paddingHorizontal: Math.max(24, insets.left, insets.right),
									paddingTop: insets.top + 16,
									paddingBottom: insets.bottom + 16,
								}}
							>
								<View
									accessibilityViewIsModal
									onAccessibilityEscape={close}
									style={{
										maxHeight: "100%",
										width: "100%",
										maxWidth: 400,
										alignSelf: "center",
										borderRadius: theme.radius.lg,
										backgroundColor: theme.color.popover,
										borderWidth: 1,
										borderColor: theme.color.border,
									}}
								>
									<ScrollView
										keyboardShouldPersistTaps="handled"
										contentContainerStyle={{ padding: 20, gap: 16 }}
									>
										<Text weight="600" accessibilityRole="header">
											{mode === "rename"
												? "Rename session"
												: mode === "stop"
													? "Stop workspace?"
													: "Delete session?"}
										</Text>
										{mode === "rename" ? (
											<TextField
												autoFocus
												accessibilityLabel="Session title"
												value={title}
												onChangeText={setTitle}
												editable={!pending}
												maxLength={200}
												returnKeyType="done"
												selectTextOnFocus
												onSubmitEditing={() => {
													if (title.trim())
														void run(() => onRenameSession!(row, title.trim()));
												}}
											/>
										) : (
											<Text tone="muted">
												{mode === "stop"
													? "This stops any running work. Your files and saved conversation remain. Open the session again to resume the workspace."
													: `Delete “${row.title}”? This removes the Cloud workspace and its saved conversation. This cannot be undone.`}
											</Text>
										)}
										{error ? (
											<Text tone="danger" accessibilityRole="alert">
												{error}
											</Text>
										) : null}
										<View
											style={{
												flexDirection: "row",
												justifyContent: "flex-end",
												gap: 8,
												flexWrap: "wrap",
											}}
										>
											<Button
												label="Cancel"
												variant="ghost"
												disabled={pending}
												onPress={close}
											/>
											<Button
												label={
													mode === "rename"
														? "Save title"
														: mode === "stop"
															? "Confirm stop"
															: "Confirm delete"
												}
												variant={mode === "delete" ? "destructive" : "primary"}
												disabled={
													pending || (mode === "rename" && !title.trim())
												}
												loading={pending}
												onPress={() =>
													void run(() =>
														mode === "rename"
															? onRenameSession!(row, title.trim())
															: mode === "stop"
																? onStopWorkspace!(row)
																: onDeleteSession!(row),
													)
												}
											/>
										</View>
									</ScrollView>
								</View>
							</View>
						)}
					</KeyboardAvoidingView>
				</Modal>
			) : null}
		</View>
	);
}
