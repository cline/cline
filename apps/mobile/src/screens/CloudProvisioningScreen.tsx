import { validateImageMedia } from "@cline/shared";
import { NavigationContext } from "expo-router/react-navigation";
import { useContext, useEffect, useRef } from "react";
import { Image, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cloudStartStatus } from "@/cloud/progress";
import {
	type CloudStartJob,
	cloudStartStore,
	isCloudStartAuthenticationError,
	useCloudStarts,
} from "@/state/cloud-starts";
import { Button, Card, Text, useTheme } from "@/ui";
import { ChatConnectingState } from "./chat/ChatConnectingState";
import { ChatHeader } from "./chat/ChatHeader";

export interface CloudProvisioningScreenProps {
	jobId: string;
	onBack(): void;
	onCheckSessions?(): void;
	onReady(job: Extract<CloudStartJob, { phase: "ready" }>): void;
}

/**
 * A provisional conversation while Cline Cloud creates its workspace.
 * The prompt is visible immediately, matching Cline's optimistic thread
 * transition, while Back leaves the process-local job running on Home.
 */
export function CloudProvisioningScreen({
	jobId,
	onBack,
	onCheckSessions,
	onReady,
}: CloudProvisioningScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const jobs = useCloudStarts();
	const navigation = useContext(NavigationContext);
	const job = jobs.find((candidate) => candidate.id === jobId);
	const opened = useRef<string | undefined>(undefined);

	useEffect(() => {
		const openWhenFocused = () => {
			// Notifications can cover this route without unmounting it. Keep its
			// ready payload saved until the user returns, rather than replacing the
			// conversation they just opened from the notification.
			if (
				!job ||
				job.phase !== "ready" ||
				opened.current === job.id ||
				navigation?.isFocused() === false
			)
				return;
			opened.current = job.id;
			cloudStartStore.remove(job.id);
			onReady(job);
		};
		const unsubscribe = navigation?.addListener("focus", openWhenFocused);
		openWhenFocused();
		return unsubscribe;
	}, [job, navigation, onReady]);

	const imageCount = job?.attachments?.userImages?.length ?? 0;
	const imageUris = (job?.attachments?.userImages ?? [])
		.map(validatedUserImageUri)
		.filter((uri): uri is string => uri !== undefined);
	const title = job
		? job.message.trim().split("\n")[0]?.slice(0, 72) ||
			(imageCount === 1 ? "1 image" : `${imageCount} images`)
		: "New Cloud session";
	const subtitle = job ? `${job.target.label} · Cline Cloud` : "Cline Cloud";
	const needsSignIn =
		job?.phase === "error" && isCloudStartAuthenticationError(job.error);
	return (
		<View
			style={{
				flex: 1,
				paddingTop: insets.top,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingBottom: insets.bottom,
				backgroundColor: theme.color.canvas,
			}}
		>
			<ChatHeader
				title={title}
				subtitle={subtitle}
				runStatus={job?.phase === "error" ? "failed" : "provisioning"}
				showStatus={Boolean(job)}
				onSwitchSession={onBack}
			/>
			<ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
				{!job ? (
					<View
						style={{
							flexGrow: 1,
							justifyContent: "center",
							padding: 24,
							gap: 12,
						}}
					>
						<Text variant="body" weight="500">
							This Cloud start is no longer available.
						</Text>
						<Text variant="small" tone="muted">
							Return Home to start again or open the workspace from session
							history.
						</Text>
						<Button label="Back to Home" onPress={onBack} />
					</View>
				) : job.phase === "error" ? (
					<View
						style={{
							flexGrow: 1,
							justifyContent: "center",
							padding: 24,
							gap: 12,
						}}
					>
						<Text variant="body" weight="500" tone="danger">
							{needsSignIn
								? "Sign in to continue with Cline Cloud."
								: "Cline Cloud could not start this workspace."}
						</Text>
						<Text variant="small" tone="muted" selectable>
							{needsSignIn
								? "Your request is saved. Return Home, sign in, then retry it."
								: job.error}
						</Text>
						{job.recovery === "check-sessions" ? (
							<Button
								label="Check sessions"
								onPress={onCheckSessions ?? onBack}
							/>
						) : needsSignIn ? (
							<Button label="Back to sign in" onPress={onBack} />
						) : (
							<View style={{ flexDirection: "row", gap: 8 }}>
								<Button
									label="Try again"
									onPress={() => {
										opened.current = undefined;
										cloudStartStore.retry(job.id);
									}}
								/>
								<Button label="Back" variant="ghost" onPress={onBack} />
							</View>
						)}
					</View>
				) : (
					<>
						<View style={{ flexGrow: 1, padding: 16, gap: 16 }}>
							<Card
								padding={14}
								radius={16}
								style={{ alignSelf: "flex-end", maxWidth: "88%" }}
							>
								<Text variant="body">
									{job.message.trim() ||
										(imageCount === 1
											? "Image attached"
											: `${imageCount} images attached`)}
								</Text>
								{imageUris.length > 0 ? (
									<View
										style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
									>
										{imageUris.map((uri, index) => (
											<Image
												key={`${uri.length}:${uri.slice(-48)}`}
												accessibilityLabel={`Attached image ${index + 1}`}
												source={{ uri }}
												style={{
													width: 72,
													height: 72,
													borderRadius: 8,
													backgroundColor: theme.color.surfaceMuted,
												}}
											/>
										))}
									</View>
								) : null}
							</Card>
							<ChatConnectingState
								message={cloudStartStatus(
									job.phase === "provisioning" ? job.progress?.phase : "ready",
								)}
							/>
						</View>
						<View
							style={{
								margin: 12,
								padding: 14,
								borderWidth: 1,
								borderColor: theme.color.border,
								borderRadius: 16,
								backgroundColor: theme.color.surface,
							}}
						>
							<Text variant="small" tone="muted">
								You can use other sessions while this starts.
							</Text>
						</View>
					</>
				)}
			</ScrollView>
		</View>
	);
}

function validatedUserImageUri(value: string): string | undefined {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value);
	if (!match?.[1] || !match[2]) return undefined;
	const validated = validateImageMedia(match[1], match[2]);
	return validated.ok
		? `data:${validated.mediaType};base64,${validated.base64}`
		: undefined;
}
