import { NavigationContext } from "expo-router/react-navigation";
import {
	PanelLeftClose,
	Plus,
	RefreshCw,
	Search,
	Settings,
} from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	FlatList,
	Keyboard,
	Modal,
	Pressable,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { channel } from "@/theme/surfaces";
import {
	Button,
	ClineLogo,
	IconButton,
	Spinner,
	Text,
	TextField,
	useTheme,
} from "@/ui";
import { SidebarAccountSummary } from "../settings/CreditBalance";
import { SESSION_SIDEBAR_WIDTH } from "./AdaptiveSessionLayout";
import {
	type SessionActionAnchor,
	SessionActions,
	type SessionActionsProps,
	SessionActionTrigger,
} from "./SessionActions";
import { SessionRowView } from "./SessionRowView";
import { filterSessionRows, type SessionRow } from "./session-rows";

const MAX_DRAWER_WIDTH = 360;
const SCREEN_GUTTER = 44;

export interface SessionSidebarProps {
	presentation?: "drawer" | "inline";
	open: boolean;
	rows: readonly SessionRow[];
	now: number;
	loading?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	error?: string;
	activeKey?: string;
	onClose(): void;
	onNew(): void;
	onOpen(row: SessionRow): void;
	onOpenSettings?: () => void;
	onRenameSession?: SessionActionsProps["onRenameSession"];
	onDeleteSession?: SessionActionsProps["onDeleteSession"];
	onStopWorkspace?: SessionActionsProps["onStopWorkspace"];
}

/**
 * Phone counterpart to Cline Desktop's agent sidebar.
 *
 * This deliberately is not a bottom sheet: session switching is lateral app
 * navigation, so it enters from the leading edge and leaves the current chat
 * visible underneath. The content order mirrors desktop — brand/search, New,
 * session history, then Settings anchored at the bottom.
 */
export function SessionSidebar({
	presentation = "drawer",
	open,
	rows,
	now,
	loading = false,
	refreshing = false,
	onRefresh,
	error,
	activeKey,
	onClose,
	onNew,
	onOpen,
	onOpenSettings,
	onRenameSession,
	onDeleteSession,
	onStopWorkspace,
}: SessionSidebarProps) {
	const navigation = useContext(NavigationContext);
	const navigationRef = useRef(navigation);
	navigationRef.current = navigation;
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { width: screenWidth } = useWindowDimensions();
	const reduceMotion = useReducedMotion();
	const drawerWidth = Math.min(
		MAX_DRAWER_WIDTH,
		Math.max(280, screenWidth - SCREEN_GUTTER),
	);
	const translateX = useSharedValue(-drawerWidth);
	const [query, setQuery] = useState("");
	const actionPresenter = useRef(presentation);
	const [actionRequest, setActionRequest] = useState<{
		row: SessionRow;
		anchor: SessionActionAnchor;
		sequence: number;
	}>();
	// Editor privacy and HTTP lifetime differ: blur retires the dialog, but a
	// write still owns its exact row until that request settles.
	const pendingRequests = useRef(new Map<number, SessionRow>());
	const [pendingRows, setPendingRows] = useState<readonly SessionRow[]>([]);
	const actionSequence = useRef(0);
	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	const activeRequest =
		actionRequest && rows.some((row) => sameActionRow(row, actionRequest.row))
			? actionRequest
			: undefined;
	const activeRequestRef = useRef(activeRequest);
	activeRequestRef.current = activeRequest;
	const retireActions = useCallback(() => {
		setActionRequest(undefined);
	}, []);
	useEffect(
		() => navigation?.addListener("blur", retireActions),
		[navigation, retireActions],
	);
	useEffect(() => {
		if (actionRequest && !activeRequest) {
			retireActions();
		}
	}, [actionRequest, activeRequest, retireActions]);
	const requestActions = useCallback(
		(row: SessionRow, anchor: SessionActionAnchor) => {
			if (
				(activeRequestRef.current &&
					pendingRequests.current.has(activeRequestRef.current.sequence)) ||
				[...pendingRequests.current.values()].some((pendingRow) =>
					sameActionRow(pendingRow, row),
				)
			)
				return;
			if (navigationRef.current && !navigationRef.current.isFocused()) return;
			const current = rowsRef.current.find((candidate) =>
				sameActionRow(candidate, row),
			);
			if (current)
				setActionRequest({
					row: current,
					anchor,
					sequence: ++actionSequence.current,
				});
		},
		[],
	);
	const visible = filterSessionRows(rows, query);
	const close = () => {
		if (presentation === "drawer") Keyboard.dismiss();
		retireActions();
		onClose();
	};

	useEffect(() => {
		if (presentation === "inline") return;
		if (open) Keyboard.dismiss();
		translateX.value = open
			? withTiming(0, {
					duration: reduceMotion ? 0 : 220,
					easing: Easing.out(Easing.cubic),
				})
			: -drawerWidth;
	}, [drawerWidth, open, presentation, reduceMotion, translateX]);

	const drawerStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX.value }],
	}));

	const body = (
		<>
			<View style={styles.header}>
				<View style={styles.brand}>
					<ClineLogo size={21} accessibilityLabel="" />
					<Text variant="body" weight="600">
						Cline
					</Text>
				</View>
				<IconButton accessibilityLabel="Collapse sidebar" onPress={close}>
					<PanelLeftClose size={19} color={theme.color.textMuted} />
				</IconButton>
			</View>

			<View style={styles.actions}>
				<SidebarAction
					label="New"
					onPress={() => {
						Keyboard.dismiss();
						retireActions();
						onNew();
					}}
					icon={<Plus size={17} color={theme.color.text} />}
				/>
				<TextField
					accessibilityLabel="Search sessions"
					autoCapitalize="none"
					autoCorrect={false}
					leading={<Search size={15} color={theme.color.textMuted} />}
					onChangeText={setQuery}
					placeholder="Search sessions…"
					returnKeyType="search"
					value={query}
					variant="search"
				/>
			</View>

			<View style={styles.sectionHeader}>
				<Text variant="small" weight="500" tone="muted">
					Sessions
				</Text>
				{loading ? <Spinner size={13} /> : null}
			</View>

			{error ? (
				<View style={styles.notice}>
					<RefreshCw size={13} color={theme.feedback.warning.fg} />
					<Text
						variant="caption"
						style={{ flex: 1, color: theme.feedback.warning.fg }}
					>
						{error}
						{rows.length > 0
							? " Showing the last sessions available on this device."
							: ""}
					</Text>
					{onRefresh ? (
						<Button
							label="Retry"
							accessibilityLabel="Retry session history"
							variant="ghost"
							disabled={refreshing}
							onPress={onRefresh}
						/>
					) : null}
				</View>
			) : null}

			<FlatList
				contentContainerStyle={styles.listContent}
				data={visible}
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
				keyExtractor={(row) => row.key}
				ListEmptyComponent={
					loading ? null : (
						<View style={styles.empty}>
							<Text variant="small" tone="muted">
								{error && rows.length === 0
									? "Session history is unavailable."
									: query.trim()
										? "No sessions match your search."
										: "No sessions yet."}
							</Text>
						</View>
					)
				}
				renderItem={({ item: row }) => (
					<SessionActionTrigger
						enabled={
							row.descriptor.mode === "cloud" &&
							Boolean(
								onRenameSession ||
									onDeleteSession ||
									(row.canStopWorkspace && onStopWorkspace),
							)
						}
						pending={pendingRows.some((pendingRow) =>
							sameActionRow(pendingRow, row),
						)}
						onOpen={(anchor) => requestActions(row, anchor)}
					>
						{(trigger) => (
							<SessionRowView
								{...trigger}
								active={row.key === activeKey}
								compact
								now={now}
								onPress={() => {
									if (presentation === "inline" && row.key === activeKey)
										return;
									Keyboard.dismiss();
									retireActions();
									onOpen(row);
								}}
								row={row}
							/>
						)}
					</SessionActionTrigger>
				)}
				style={styles.list}
			/>

			{onOpenSettings ? (
				<View style={[styles.footer, { borderTopColor: theme.color.border }]}>
					{open ? (
						<SidebarAccountSummary
							onPress={() => {
								Keyboard.dismiss();
								retireActions();
								onOpenSettings();
							}}
						/>
					) : null}
					<SidebarAction
						label="Settings"
						onPress={() => {
							Keyboard.dismiss();
							retireActions();
							onOpenSettings();
						}}
						icon={<Settings size={17} color={theme.color.textMuted} />}
					/>
				</View>
			) : null}
		</>
	);
	const surfaceStyle = {
		paddingLeft: presentation === "drawer" ? insets.left : 0,
		paddingTop: insets.top,
		paddingBottom: insets.bottom,
		backgroundColor: theme.color.surface,
		borderRightColor: theme.color.border,
	};
	const renderSurface = (dialog: ReactNode) => {
		// UIKit cannot move a presented child Modal to a new presenter while its
		// old parent is dismissing. Keep the native ancestry for the entire editor
		// lifetime; dimensions still adapt, and dismissal adopts the current layout.
		if (!dialog) actionPresenter.current = presentation;
		return actionPresenter.current === "inline" ? (
			open || dialog ? (
				<View
					testID="session-sidebar"
					style={[
						{ flex: 1, width: SESSION_SIDEBAR_WIDTH, borderRightWidth: 1 },
						surfaceStyle,
					]}
				>
					{body}
					{dialog}
				</View>
			) : null
		) : (
			<Modal
				supportedOrientations={[
					"portrait",
					"portrait-upside-down",
					"landscape",
				]}
				animationType={reduceMotion ? "none" : "fade"}
				onRequestClose={close}
				presentationStyle="overFullScreen"
				statusBarTranslucent
				transparent
				// A rename can survive returning from inline mode after the layout
				// closed the drawer. Its native presenter must remain visible too.
				visible={open || Boolean(dialog)}
			>
				<View style={styles.overlay}>
					<Pressable
						accessibilityLabel="Close sessions"
						accessibilityRole="button"
						onPress={close}
						style={styles.backdrop}
					/>
					<Animated.View
						accessibilityViewIsModal
						onAccessibilityEscape={close}
						style={[
							styles.drawer,
							surfaceStyle,
							{ width: drawerWidth, shadowColor: channel.shadow },
							drawerStyle,
						]}
						testID="session-sidebar"
					>
						{body}
					</Animated.View>
				</View>
				{dialog}
			</Modal>
		);
	};
	return (
		<>
			<SessionActions
				renderSurface={renderSurface}
				row={activeRequest?.row}
				openRequest={activeRequest}
				onRenameSession={onRenameSession}
				onDeleteSession={onDeleteSession}
				onStopWorkspace={onStopWorkspace}
				onClosed={() => {
					if (!activeRequest || activeRequestRef.current !== activeRequest)
						return;
					retireActions();
				}}
				onPendingChange={(pending) => {
					if (!activeRequest) return;
					if (pending) {
						if (activeRequestRef.current !== activeRequest) return;
						pendingRequests.current.set(
							activeRequest.sequence,
							activeRequest.row,
						);
					} else {
						// The original finally releases only its own lease, even after
						// blur or another row has become the active editor.
						pendingRequests.current.delete(activeRequest.sequence);
					}
					setPendingRows([...pendingRequests.current.values()]);
				}}
			>
				{() => null}
			</SessionActions>
		</>
	);
}

function sameActionRow(left: SessionRow, right: SessionRow): boolean {
	return (
		left.key === right.key &&
		left.descriptor.mode === right.descriptor.mode &&
		left.descriptor.remoteSessionId === right.descriptor.remoteSessionId &&
		left.descriptor.organizationId === right.descriptor.organizationId &&
		left.descriptor.url === right.descriptor.url
	);
}

function SidebarAction({
	label,
	icon,
	onPress,
}: {
	label: string;
	icon: ReactNode;
	onPress(): void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 44,
				borderRadius: theme.radius.sm,
				paddingHorizontal: 10,
				flexDirection: "row",
				alignItems: "center",
				gap: 9,
				backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
			})}
		>
			{icon}
			<Text variant="body">{label}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	overlay: {
		flex: 1,
		flexDirection: "row",
	},
	backdrop: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		backgroundColor: "rgba(0, 0, 0, 0.58)",
	},
	drawer: {
		height: "100%",
		borderRightWidth: 1,
		shadowOffset: { width: 8, height: 0 },
		shadowOpacity: 0.28,
		shadowRadius: 20,
		elevation: 18,
	},
	header: {
		minHeight: 54,
		paddingLeft: 16,
		paddingRight: 6,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	brand: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	actions: {
		paddingHorizontal: 8,
		gap: 8,
	},
	sectionHeader: {
		minHeight: 40,
		marginTop: 12,
		paddingHorizontal: 16,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	notice: {
		paddingHorizontal: 16,
		paddingBottom: 8,
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 8,
	},
	list: {
		flex: 1,
	},
	listContent: {
		paddingHorizontal: 8,
		paddingBottom: 12,
		gap: 2,
	},
	empty: {
		paddingHorizontal: 8,
		paddingVertical: 14,
	},
	footer: {
		borderTopWidth: 1,
		paddingHorizontal: 8,
		paddingTop: 8,
		paddingBottom: 4,
	},
});
