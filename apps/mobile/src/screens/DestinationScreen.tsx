/**
 * The working surface owned by one of Cline's two first-class entities:
 *
 *  - Cline Cloud owns account state and Cloud sessions.
 *  - My Computers owns paired devices and their local sessions.
 *
 * Each route renders only its own identity, sessions, errors, and setup. Cline
 * authentication identifies the account; QR pairing separately authorizes this
 * phone for a computer. Raw URLs and tokens remain in Settings → Advanced.
 */

import {
	ArrowLeft,
	Cloud,
	QrCode,
	Search,
	Settings,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isAllowedVerificationUrl } from "@/cloud";
import { cloudEnv } from "@/config/env";
import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import type { RunStatus } from "@/session";
import { useEndpoints } from "@/state/endpoints";
import { useLastOpened } from "@/state/last-opened";
import {
	Banner,
	Button,
	IconButton,
	ScreenHeader,
	StateView,
	Text,
	TextField,
	useTheme,
} from "@/ui";
import { CloudAccountCard, CloudSignInProgress } from "./home/CloudAccountCard";
import { CurrentSessionCard } from "./home/CurrentSessionCard";
import {
	type CloudSessionsState,
	getCloudSessions,
	useCloudSessions,
} from "./home/cloud-sessions";
import {
	HANDOFF_INSTRUCTION,
	PairComputerState,
} from "./home/PairComputerState";
import { SessionRowView } from "./home/SessionRowView";
import {
	buildSessionRows,
	filterSessionRows,
	type SessionRow,
} from "./home/session-rows";

export { HANDOFF_INSTRUCTION };

export type Destination = "cloud" | "computers";

export interface DestinationScreenProps {
	destination: Destination;
	/** Key of the session this app is connected to right now, if any. */
	activeKey?: string;
	/** Live run status of {@link activeKey}. Observed, so it may be shown. */
	activeStatus?: RunStatus;
	/** Clock for relative times; injected so rows render deterministically. */
	now?: number;
	onOpenSession(descriptor: ConnectionDescriptor): void;
	onBack(): void;
	onOpenSettings?(): void;
	onScanHandoff?(): void;
}

export function DestinationScreen({
	destination: section,
	activeKey,
	activeStatus,
	now,
	onOpenSession,
	onBack,
	onOpenSettings,
	onScanHandoff,
}: DestinationScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { endpoints, save } = useEndpoints();
	const { lastOpened, touch } = useLastOpened();
	const [query, setQuery] = useState("");
	const renderedAt = now ?? Date.now();

	// The allowlist decision stays here: the hook never reaches for `Linking`.
	const openVerificationUrl = useCallback((url: string) => {
		if (!isAllowedVerificationUrl(url)) {
			return false;
		}
		void Linking.openURL(url).catch(() => {});
		return true;
	}, []);
	const cloud = useCloudSessions({
		openVerificationUrl,
		autoLoad: section === "cloud",
	});

	const rows = useMemo(
		() =>
			buildSessionRows({
				endpoints,
				cloudSessions: getCloudSessions(cloud.state),
				cloudApiBaseUrl: cloudEnv.apiBaseUrl,
				lastOpened,
				...(activeKey ? { activeKey } : {}),
				...(activeStatus ? { activeStatus } : {}),
			}),
		[endpoints, cloud.state, lastOpened, activeKey, activeStatus],
	);
	const sectionRows = useMemo(
		() =>
			rows.filter((row) =>
				section === "cloud"
					? row.descriptor.mode === "cloud"
					: row.descriptor.mode === "local",
			),
		[rows, section],
	);
	const baseCurrent = useMemo(
		() =>
			sectionRows.find(
				(row) => row.key === activeKey && row.status !== undefined,
			) ??
			(section === "cloud" ? sectionRows.find((row) => row.online) : undefined),
		[sectionRows, activeKey, section],
	);
	const current = query.trim() ? undefined : baseCurrent;
	const visibleRows = useMemo(
		() =>
			filterSessionRows(sectionRows, query).filter(
				(row) => row.key !== current?.key,
			),
		[sectionRows, query, current],
	);

	/** Persist before navigation so a Cloud row can be resolved by route key. */
	const open = (descriptor: ConnectionDescriptor) => {
		const key = descriptorKey(descriptor);
		void save(descriptor).catch(() => {});
		void touch(key).catch(() => {});
		onOpenSession(descriptor);
	};
	const signingIn =
		cloud.state.phase === "starting" || cloud.state.phase === "authorizing";
	const showSearch = sectionRows.length >= 8 || query.length > 0;

	return (
		<View
			style={{
				flex: 1,
				backgroundColor: theme.color.canvas,
				paddingTop: insets.top,
				paddingLeft: insets.left,
				paddingRight: insets.right,
			}}
		>
			<ScreenHeader
				title={section === "cloud" ? "Cline Cloud" : "My Computers"}
				leading={
					<IconButton accessibilityLabel="Back to Home" onPress={onBack}>
						<ArrowLeft size={19} color={theme.color.textMuted} />
					</IconButton>
				}
				trailing={
					onOpenSettings ? (
						<IconButton accessibilityLabel="Settings" onPress={onOpenSettings}>
							<Settings size={18} color={theme.color.textMuted} />
						</IconButton>
					) : null
				}
				below={
					showSearch ? (
						<TextField
							variant="search"
							placeholder={
								section === "cloud"
									? "Search Cloud sessions…"
									: "Search computers…"
							}
							value={query}
							onChangeText={setQuery}
							leading={<Search size={14} color={theme.color.textMuted} />}
							accessibilityLabel={
								section === "cloud"
									? "Search Cline Cloud sessions"
									: "Search computers"
							}
						/>
					) : null
				}
			/>

			<FlatList
				data={[...visibleRows]}
				key={`${section}:${query ? "search" : "all"}`}
				keyExtractor={(row) => row.key}
				renderItem={({ item }) => (
					<SessionRowView
						row={item}
						now={renderedAt}
						active={item.key === activeKey}
						onPress={() => open(item.descriptor)}
					/>
				)}
				contentContainerStyle={{
					paddingHorizontal: 16,
					paddingTop: 16,
					paddingBottom: insets.bottom + 24,
					gap: 4,
				}}
				ListHeaderComponent={
					section === "cloud" ? (
						<CloudHeader
							state={cloud.state}
							current={current}
							now={renderedAt}
							hasRows={visibleRows.length > 0}
							onSignIn={cloud.signIn}
							onRefresh={cloud.refresh}
							onOpen={open}
							{...(signingIn
								? { progress: <CloudSignInProgress state={cloud.state} /> }
								: {})}
						/>
					) : (
						<ComputersHeader
							current={current}
							now={renderedAt}
							hasRows={visibleRows.length > 0}
							onOpen={open}
						/>
					)
				}
				ListEmptyComponent={
					query.trim() ? (
						<NoMatches query={query} section={section} />
					) : current ? null : section === "cloud" ? (
						<CloudEmptyState state={cloud.state} />
					) : (
						<PairComputerState onPair={onScanHandoff} />
					)
				}
				ListFooterComponent={
					section === "computers" &&
					sectionRows.length > 0 &&
					!query.trim() &&
					onScanHandoff ? (
						<View style={{ paddingTop: 16 }}>
							<Button
								label="Pair Another Computer"
								variant="ghost"
								icon={<QrCode size={15} color={theme.color.textMuted} />}
								accessibilityLabel="Pair a computer"
								onPress={onScanHandoff}
							/>
						</View>
					) : null
				}
			/>
		</View>
	);
}

function CloudHeader({
	state,
	current,
	now,
	hasRows,
	onSignIn,
	onRefresh,
	onOpen,
	progress,
}: {
	state: CloudSessionsState;
	current?: SessionRow;
	now: number;
	hasRows: boolean;
	onSignIn(): void;
	onRefresh(): void;
	onOpen(descriptor: ConnectionDescriptor): void;
	progress?: ReactNode;
}) {
	return (
		<View style={{ gap: 16, paddingBottom: hasRows ? 8 : 4 }}>
			<CloudAccountCard
				state={state}
				onSignIn={onSignIn}
				onRefresh={onRefresh}
				{...(progress ? { progress } : {})}
			/>
			<CloudNotice state={state} onRetry={onRefresh} onSignIn={onSignIn} />
			{current ? (
				<CurrentSessionCard
					row={current}
					now={now}
					onPress={() => onOpen(current.descriptor)}
				/>
			) : null}
			{hasRows ? <SectionLabel>SESSIONS</SectionLabel> : null}
		</View>
	);
}

function ComputersHeader({
	current,
	now,
	hasRows,
	onOpen,
}: {
	current?: SessionRow;
	now: number;
	hasRows: boolean;
	onOpen(descriptor: ConnectionDescriptor): void;
}) {
	return (
		<View style={{ gap: 16, paddingBottom: hasRows ? 8 : 4 }}>
			{current ? (
				<CurrentSessionCard
					row={current}
					now={now}
					onPress={() => onOpen(current.descriptor)}
				/>
			) : null}
			{hasRows ? <SectionLabel>PAIRED COMPUTERS</SectionLabel> : null}
		</View>
	);
}

function SectionLabel({ children }: { children: string }) {
	return (
		<Text variant="caption" tone="muted" weight="600">
			{children}
		</Text>
	);
}

function CloudEmptyState({ state }: { state: CloudSessionsState }) {
	const theme = useTheme();
	const body =
		state.phase === "signed-out"
			? "Sign in above to continue your Cline Cloud sessions on this phone."
			: state.phase === "ready"
				? "Sessions you start with Cline Cloud will appear here."
				: state.phase === "error"
					? "Your Cloud sessions are unavailable right now."
					: "Syncing your Cline Cloud sessions…";
	return (
		<StateView
			icon={<Cloud size={24} color={theme.brand.violet} />}
			headline="Your Cloud Sessions"
			body={body}
		/>
	);
}

function CloudNotice({
	state,
	onRetry,
	onSignIn,
}: {
	state: CloudSessionsState;
	onRetry: () => void;
	onSignIn: () => void;
}) {
	if (state.phase !== "error") {
		return null;
	}
	return (
		<Banner
			tone="danger"
			onPress={state.recovery === "sign-in" ? onSignIn : onRetry}
			accessibilityLabel={`${state.message} Tap to ${
				state.recovery === "sign-in" ? "sign in" : "try again"
			}.`}
		>
			<View style={{ gap: 2 }}>
				<Text variant="small">{state.message}</Text>
				<Text variant="caption" tone="muted">
					Tap to{" "}
					{state.recovery === "sign-in"
						? "sign in again."
						: "try Cline Cloud again."}
				</Text>
				{state.detail ? (
					<Text variant="caption" tone="muted" numberOfLines={2} selectable>
						{`Details: ${state.detail}`}
					</Text>
				) : null}
			</View>
		</Banner>
	);
}

function NoMatches({
	query,
	section,
}: {
	query: string;
	section: Destination;
}) {
	return (
		<StateView
			headline={
				section === "cloud" ? "No Sessions Match" : "No Computers Match"
			}
			body={`Nothing here matches “${query.trim()}”.`}
		/>
	);
}
