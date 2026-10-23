/** Account and Cloud workspaces, with computer settings behind the release flag. */

import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import {
	ChevronLeft,
	Cloud,
	MonitorSmartphone,
	Trash2,
	User,
} from "lucide-react-native";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DevHubEndpoint } from "@/config/env";
import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import { ApprovalTierRow, summarizeApprovalPolicy } from "@/screens/approval";
import { APPROVAL_TIERS } from "@/session";
import { type CloudAccountState, useCloudAuth } from "@/state/cloud-auth";
import { useEndpoints } from "@/state/endpoints";
import { useExecutionTargets } from "@/state/execution-targets";
import { useLastOpened } from "@/state/last-opened";
import { useAppearance, type AppearancePreference } from "@/state/appearance";
import { useApprovalPolicy } from "@/state/settings";
import {
	Button,
	Card,
	IconButton,
	ScreenHeader,
	Surface,
	Text,
	useTheme,
} from "@/ui";
import { AdvancedConnect } from "./home/AdvancedConnect";
import { localMachineDescriptors } from "./home/local-sessions";
import { AccountSwitcher } from "./settings/AccountSwitcher";

export interface SettingsScreenProps {
	onBack?: () => void;
	/** Called after the cloud credentials are wiped, to return to the sessions list. */
	onSignedOut?: () => void;
	/** Auto-discovered local hub, offered inside Advanced. */
	devHubEndpoint?: DevHubEndpoint;
	/**
	 * Connect to a hub entered by hand. Omitted on surfaces that cannot navigate
	 * into a chat; the Advanced section is then hidden rather than inert.
	 */
	onConnect?: (descriptor: ConnectionDescriptor) => void;
	/** Opens the first-class Cloud repository/model setup flow. */
	onConfigureCloud?: () => void;
	/** Opens the `/handoff` QR scanner. */
	onPairComputer?: () => void;
}

export function SettingsScreen({
	onBack,
	onSignedOut,
	devHubEndpoint,
	onConnect,
	onConfigureCloud,
	onPairComputer,
}: SettingsScreenProps) {
	const theme = useTheme();
	const appearance = useAppearance();
	const insets = useSafeAreaInsets();
	const { policy, setTier } = useApprovalPolicy();
	const { account, signOut } = useCloudAuth();
	const { endpoints, save, remove } = useEndpoints();
	const { cloudTargets, removeCloudTarget } = useExecutionTargets();
	const { touch, forget } = useLastOpened();
	const confirmCloudTargetRemoval = (id: string, label: string) => {
		Alert.alert(
			"Remove Cloud workspace?",
			`${label} will disappear from this device. Existing Cloud sessions are not deleted.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove",
					style: "destructive",
					onPress: () => void removeCloudTarget(id),
				},
			],
		);
	};

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
				title="Settings"
				leading={
					onBack ? (
						<IconButton accessibilityLabel="Back" onPress={onBack}>
							<ChevronLeft size={20} color={theme.color.text} />
						</IconButton>
					) : null
				}
			/>

			<ScrollView
				contentContainerStyle={{
					padding: 16,
					paddingBottom: insets.bottom + 24,
					gap: 12,
				}}
			>
				<Text variant="small" tone="muted" weight="500">
					Appearance
				</Text>
				<Surface level="muted" bordered padding={4}>
					<View
						accessibilityRole="radiogroup"
						accessibilityLabel="Appearance"
						style={{ flexDirection: "row" }}
					>
						{(["system", "light", "dark"] satisfies AppearancePreference[]).map(
							(choice) => (
								<Pressable
									key={choice}
									accessibilityRole="radio"
									accessibilityLabel={`${choice[0].toUpperCase()}${choice.slice(1)} appearance`}
									accessibilityState={{
										checked: appearance.preference === choice,
										disabled: appearance.saving,
									}}
									disabled={appearance.saving}
									onPress={() => {
										void appearance
											.setPreference(choice)
											.catch(() =>
												Alert.alert(
													"Couldn't save appearance",
													"Please try again.",
												),
											);
									}}
									style={{
										flex: 1,
										minHeight: 44,
										justifyContent: "center",
										alignItems: "center",
										borderRadius: theme.radius.sm,
										backgroundColor:
											appearance.preference === choice
												? theme.brand.violetSubtle
												: "transparent",
									}}
								>
									<Text
										variant="small"
										weight="500"
										tone={appearance.preference === choice ? "accent" : "muted"}
									>
										{choice[0].toUpperCase()}
										{choice.slice(1)}
									</Text>
								</Pressable>
							),
						)}
					</View>
				</Surface>

				<Text variant="small" tone="muted" weight="500">
					Account
				</Text>
				<AccountCard
					account={account}
					onSignOut={() => {
						void signOut().then(() => onSignedOut?.());
					}}
				/>

				<Text variant="small" tone="muted" weight="500">
					{COMPUTER_CONNECTIONS_ENABLED
						? "Places Cline can work"
						: "Cloud workspaces"}
				</Text>
				<Surface level="muted" bordered padding={12} style={{ gap: 10 }}>
					{COMPUTER_CONNECTIONS_ENABLED ? (
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
						>
							<MonitorSmartphone size={16} color={theme.color.textMuted} />
							<View style={{ flex: 1, gap: 1 }}>
								<Text variant="body" weight="500">
									Computers
								</Text>
								<Text variant="caption" tone="muted">
									{localMachineDescriptors(endpoints).length} paired
								</Text>
								<Text variant="caption" tone="muted">
									Uses the Cline provider, credentials, and workspace on each
									computer.
								</Text>
							</View>
						</View>
					) : null}

					{cloudTargets.map((target) => (
						<View
							key={target.id}
							style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
						>
							<Cloud size={16} color={theme.brand.violet} />
							<View style={{ flex: 1, gap: 1 }}>
								<Text variant="body" weight="500" numberOfLines={1}>
									{target.label}
								</Text>
								<Text variant="caption" tone="muted" numberOfLines={1}>
									{target.modelId}
								</Text>
							</View>
							<IconButton
								accessibilityLabel={`Remove Cloud workspace ${target.label}`}
								onPress={() =>
									confirmCloudTargetRemoval(target.id, target.label)
								}
							>
								<Trash2 size={16} color={theme.color.danger} />
							</IconButton>
						</View>
					))}

					{onConfigureCloud ? (
						<Button
							label={
								cloudTargets.length > 0
									? "Add Cloud workspace"
									: "Set up Cline Cloud"
							}
							variant="outline"
							fullWidth
							onPress={onConfigureCloud}
						/>
					) : null}
				</Surface>

				{COMPUTER_CONNECTIONS_ENABLED &&
				endpoints.some((endpoint) => endpoint.mode === "local") ? (
					<>
						<Text variant="small" tone="muted" weight="500">
							My computer · Auto-approve
						</Text>
						<Text variant="small" tone="muted">
							For connected computers only, choose which kinds of tool calls run
							without asking. Everything you leave off waits for your approval
							in the chat. Right now: {summarizeApprovalPolicy(policy).spoken}.
						</Text>

						{APPROVAL_TIERS.map((tier) => (
							<ApprovalTierRow
								key={tier}
								tier={tier}
								value={policy[tier] === "auto"}
								onChange={(next) => void setTier(tier, next ? "auto" : "ask")}
							/>
						))}
					</>
				) : null}

				{COMPUTER_CONNECTIONS_ENABLED && onConnect ? (
					<>
						<Text variant="small" tone="muted" weight="500">
							Connections
						</Text>
						{/* The self-hoster / developer escape hatch. Collapsed, and never
						    the way a normal session arrives — that is `/handoff`. */}
						<AdvancedConnect
							onPairComputer={onPairComputer}
							{...(devHubEndpoint ? { devHubEndpoint } : {})}
							endpoints={endpoints}
							// Saved before navigating: the chat route resolves a
							// credential-free route key back through the endpoint store.
							onConnect={(descriptor) => {
								const key = descriptorKey(descriptor);
								void save(descriptor).catch(() => {});
								void touch(key).catch(() => {});
								onConnect(descriptor);
							}}
							onRemove={(key) => {
								void remove(key).catch(() => {});
								void forget(key).catch(() => {});
							}}
						/>
					</>
				) : null}

				{COMPUTER_CONNECTIONS_ENABLED &&
				endpoints.some((endpoint) => endpoint.mode === "local") ? (
					<Surface level="muted" bordered padding={12} style={{ gap: 4 }}>
						<Text variant="small" weight="500">
							Unfamiliar tools follow Run commands
						</Text>
						<Text variant="caption" tone="muted">
							Tools Cline does not recognise — including MCP tools and anything
							that reaches the network — use your “Run commands” setting.
						</Text>
					</Surface>
				) : null}
			</ScrollView>
		</View>
	);
}

/** Signed-in identity + the only sign-out affordance in the app. */
function AccountCard({
	account,
	onSignOut,
}: {
	account: CloudAccountState;
	onSignOut: () => void;
}) {
	const theme = useTheme();
	return (
		<Card style={{ gap: 12 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
				<User size={16} color={theme.color.textMuted} />
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="body" weight="500">
						Cline Cloud
					</Text>
					<Text variant="caption" tone="muted" numberOfLines={1}>
						{account.phase === "loading"
							? "Checking this device…"
							: account.phase === "signed-in"
								? (account.email ?? "Signed in")
								: "Not signed in"}
					</Text>
				</View>
			</View>
			{account.phase === "signed-in" ? (
				<>
					<AccountSwitcher />
					<Button
						label="Sign out"
						variant="destructive"
						fullWidth
						onPress={onSignOut}
					/>
					<Text variant="caption" tone="muted">
						Removes this device's Cline credentials. Sessions running in the
						cloud keep running.
					</Text>
				</>
			) : null}
			{account.phase === "signed-out" ? (
				<Text variant="caption" tone="muted">
					Sign in from your session list to run agents in Cline Cloud.
				</Text>
			) : null}
		</Card>
	);
}
