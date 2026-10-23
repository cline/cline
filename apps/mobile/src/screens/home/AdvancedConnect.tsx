/**
 * Manual hub connection controls for developer and self-hosted setups.
 * Includes the configured development hub and saved local endpoints.
 */

import { ArrowRight, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { DevHubEndpoint } from "@/config/env";
import type { ConnectionDescriptor } from "@/connection";
import { validateManualHubUrl } from "@/connection/manual-hub-url";
import {
	Button,
	borderAlpha,
	Chip,
	Disclosure,
	Divider,
	IconButton,
	Text,
	TextField,
	useTheme,
} from "@/ui";
import { describeEndpoints, type EndpointDisplay } from "../endpoint-display";

export interface AdvancedConnectProps {
	/** Auto-discovered local hub, when `EXPO_PUBLIC_DEV_HUB_URL` is configured. */
	devHubEndpoint?: DevHubEndpoint;
	/** Saved endpoints; only `local` ones are manual-entry material. */
	endpoints: readonly ConnectionDescriptor[];
	onConnect(descriptor: ConnectionDescriptor): void;
	onRemove(key: string): void;
	onPairComputer?(): void;
	/** Start expanded. Off by default — that is the whole point of this surface. */
	defaultExpanded?: boolean;
}

export function AdvancedConnect({
	devHubEndpoint,
	endpoints,
	onConnect,
	onRemove,
	onPairComputer,
	defaultExpanded = false,
}: AdvancedConnectProps) {
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [urlError, setUrlError] = useState<string>();
	const trimmedUrl = url.trim();
	const saved = useMemo(
		() =>
			describeEndpoints(endpoints.filter((entry) => entry.mode === "local")),
		[endpoints],
	);

	return (
		<Disclosure
			label="Advanced"
			accessibilityLabel="Advanced connection options"
			variant="rail"
			defaultExpanded={defaultExpanded}
		>
			<View style={{ gap: 12 }}>
				{onPairComputer ? (
					<View style={{ gap: 8 }}>
						<Text variant="body" weight="500">
							My computer
						</Text>
						<Text variant="caption" tone="muted">
							Run /handoff in Cline on your computer, then scan its one-time QR
							code.
						</Text>
						<Button
							label="Scan handoff QR"
							variant="outline"
							fullWidth
							onPress={onPairComputer}
						/>
					</View>
				) : null}
				<Text variant="caption" tone="muted">
					For self-hosted hubs and local development. You do not need this to
					use your own computer — run /handoff in Cline there instead.
				</Text>

				{devHubEndpoint ? (
					<View style={{ gap: 6 }}>
						<Text variant="small" tone="muted">
							Local dev hub discovered
						</Text>
						<Button
							label="Connect to local hub"
							variant="secondary"
							fullWidth
							onPress={() =>
								onConnect({
									mode: "local",
									url: devHubEndpoint.url,
									...(devHubEndpoint.authToken
										? { authToken: devHubEndpoint.authToken }
										: {}),
									label: "Local dev hub",
								})
							}
						/>
						<Text variant="caption" tone="muted">
							{devHubEndpoint.url}
						</Text>
					</View>
				) : null}

				{saved.length > 0 ? (
					<View style={{ gap: 6 }}>
						<Text variant="small" tone="muted">
							Saved hubs
						</Text>
						{saved.map((row) => (
							<SavedRow
								key={row.key}
								row={row}
								discovered={row.endpoint.url === devHubEndpoint?.url}
								onConnect={() => onConnect(row.endpoint)}
								onRemove={() => onRemove(row.key)}
							/>
						))}
					</View>
				) : null}

				<Divider alpha={borderAlpha.strong} />

				<View style={{ gap: 8 }}>
					<Text variant="small" tone="muted">
						Enter a hub manually
					</Text>
					<TextField
						placeholder="ws://127.0.0.1:4599/hub"
						autoCapitalize="none"
						autoCorrect={false}
						value={url}
						onChangeText={(value) => {
							setUrl(value);
							setUrlError(undefined);
						}}
						accessibilityLabel="Hub WebSocket URL"
					/>
					{urlError ? (
						<Text
							variant="caption"
							tone="danger"
							accessibilityLiveRegion="polite"
						>
							{urlError}
						</Text>
					) : null}
					<TextField
						placeholder="Auth token (optional)"
						autoCapitalize="none"
						autoCorrect={false}
						secureTextEntry
						value={token}
						onChangeText={setToken}
						accessibilityLabel="Hub auth token"
					/>
					<Button
						label="Connect"
						variant="secondary"
						fullWidth
						disabled={trimmedUrl.length === 0}
						onPress={() => {
							const validated = validateManualHubUrl(trimmedUrl);
							if (!validated.ok) {
								setUrlError(validated.message);
								return;
							}
							onConnect({
								mode: "local",
								url: validated.url,
								...(token.trim() ? { authToken: token.trim() } : {}),
							});
						}}
					/>
				</View>
			</View>
		</Disclosure>
	);
}

/**
 * One saved hub: a disambiguated label, the url as a first-class second line
 * (`mono`, not an incidental caption), an optional "Discovered" marker, and its
 * own delete button.
 *
 * Connect and remove are sibling pressables rather than a nested pair, so the
 * delete tap can never fall through to "connect to the hub I am deleting".
 */
function SavedRow({
	row,
	discovered,
	onConnect,
	onRemove,
}: {
	row: EndpointDisplay;
	discovered: boolean;
	onConnect: () => void;
	onRemove: () => void;
}) {
	const theme = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				borderWidth: 1,
				borderColor: theme.color.border,
				borderRadius: theme.radius.md,
				backgroundColor: theme.color.surfaceMuted,
				paddingHorizontal: 12,
				paddingVertical: 10,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Connect to ${row.label}`}
				onPress={onConnect}
				style={({ pressed }) => ({
					flex: 1,
					gap: 2,
					opacity: pressed ? 0.7 : 1,
				})}
			>
				<View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
					<Text
						variant="body"
						weight="500"
						numberOfLines={1}
						style={{ flexShrink: 1 }}
					>
						{row.label}
					</Text>
					{discovered ? (
						// A static Chip drops `accessibilityLabel`, and "Discovered" alone
						// says nothing out of context — so the phrasing lives on a wrapper.
						<View
							accessible
							accessibilityLabel={`${row.label} is the hub discovered on this network`}
						>
							<Chip label="Discovered" tone="accent" pill />
						</View>
					) : null}
				</View>
				<Text variant="mono" tone="muted" numberOfLines={1}>
					{row.url}
				</Text>
			</Pressable>
			<ArrowRight size={16} color={theme.brand.violet} />
			<IconButton
				accessibilityLabel={`Remove ${row.label}`}
				onPress={() =>
					Alert.alert(
						`Remove ${row.label}?`,
						"This removes the saved connection from this phone. Revoke the phone on your computer too if you no longer trust it.",
						[
							{ text: "Cancel", style: "cancel" },
							{ text: "Remove", style: "destructive", onPress: onRemove },
						],
					)
				}
			>
				<Trash2 size={16} color={theme.color.textMuted} />
			</IconButton>
		</View>
	);
}
