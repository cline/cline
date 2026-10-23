/** Account status with sign-in and session-refresh actions. */

import { Cloud, RefreshCw } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Button, Card, IconButton, Spinner, Text, useTheme } from "@/ui";
import type { CloudSessionsState } from "./cloud-sessions";

export interface CloudAccountCardProps {
	state: CloudSessionsState;
	onSignIn(): void;
	onRefresh(): void;
	progress?: ReactNode;
}

export function CloudAccountCard({
	state,
	onSignIn,
	onRefresh,
	progress,
}: CloudAccountCardProps) {
	const theme = useTheme();
	const busy = state.phase === "starting" || state.phase === "authorizing";
	const needsSignIn =
		state.phase === "signed-out" ||
		(state.phase === "error" && state.recovery === "sign-in");
	const description = describeAccountState(state);

	return (
		<Card padding={12} style={{ gap: progress ? 12 : 0 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
				<View
					style={{
						width: 40,
						height: 40,
						borderRadius: theme.radius.md,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: theme.brand.violetSubtle,
					}}
				>
					<Cloud size={19} color={theme.brand.violet} />
				</View>

				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="body" weight="500">
						Cline Account
					</Text>
					<Text variant="caption" tone="muted" numberOfLines={2}>
						{description}
					</Text>
				</View>

				{state.phase === "loading" ? (
					<View
						accessible
						accessibilityRole="progressbar"
						accessibilityLabel="Syncing Cline Cloud sessions"
						style={{
							width: 44,
							height: 44,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Spinner size={16} />
					</View>
				) : busy ? (
					<Button
						label="Cancel"
						variant="ghost"
						accessibilityLabel="Cancel sign-in"
						onPress={onRefresh}
					/>
				) : needsSignIn ? (
					<Button
						label="Sign In"
						variant="outline"
						accessibilityLabel="Sign in to Cline"
						onPress={onSignIn}
					/>
				) : (
					<IconButton
						accessibilityLabel={
							state.phase === "error"
								? "Retry Cline Cloud"
								: "Refresh Cline Cloud sessions"
						}
						onPress={onRefresh}
					>
						<RefreshCw size={17} color={theme.color.textMuted} />
					</IconButton>
				)}
			</View>
			{progress}
		</Card>
	);
}

/** WorkOS device-code progress shared by every surface that starts sign-in. */
export function CloudSignInProgress({
	state,
	onOpenBrowser,
}: {
	state: CloudSessionsState;
	onOpenBrowser?: () => void;
}) {
	const theme = useTheme();
	if (state.phase === "starting") {
		return (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Spinner size={14} />
				<Text variant="body" tone="muted">
					Starting sign-in…
				</Text>
			</View>
		);
	}

	if (state.phase !== "authorizing") return null;

	return (
		<View
			style={{
				gap: 10,
				paddingTop: 12,
				borderTopWidth: 1,
				borderTopColor: theme.color.border,
			}}
		>
			<Text variant="body" tone="muted">
				Finish signing in in your browser with this code:
			</Text>
			<Text
				variant="title"
				selectable
				accessibilityLabel={`Your sign-in code is ${state.userCode}`}
			>
				{state.userCode}
			</Text>
			{state.openable && onOpenBrowser ? (
				<Button
					label="Open browser again"
					variant="outline"
					onPress={onOpenBrowser}
				/>
			) : null}
			<Text variant="small" tone={state.openable ? "muted" : "danger"}>
				{state.openable
					? "If the browser did not open, copy this address:"
					: "This sign-in link could not be opened safely. Copy the code and open this address yourself:"}
			</Text>
			<Text variant="caption" tone="muted" selectable>
				{state.verificationUrl}
			</Text>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Spinner size={12} />
				<Text variant="small" tone="muted">
					Waiting for confirmation…
				</Text>
			</View>
		</View>
	);
}

function describeAccountState(state: CloudSessionsState): string {
	switch (state.phase) {
		case "signed-out":
			return "Sign in to sync your Cline Cloud sessions.";
		case "starting":
			return "Starting secure sign-in…";
		case "authorizing":
			return "Finish signing in in your browser.";
		case "loading":
			return "Syncing your Cline Cloud sessions…";
		case "ready":
			return state.sessions.length === 1
				? "Connected · 1 cloud session"
				: `Connected · ${state.sessions.length} cloud sessions`;
		case "error":
			return state.message;
	}
}
