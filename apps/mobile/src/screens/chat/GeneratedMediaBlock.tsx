import { type GeneratedMedia, validateImageMedia } from "@cline/shared";
import { FileText, ImageOff, X } from "lucide-react-native";
import { useState } from "react";
import { Image, Modal, Pressable, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, IconButton, Text, useTheme } from "@/ui";
import { GeneratedMediaPlayback } from "./GeneratedMediaPlayback";

/** Safe native rendering for the same canonical media blocks desktop consumes. */
export function GeneratedMediaBlock({ media }: { media: GeneratedMedia }) {
	const theme = useTheme();
	const [requestedImageUrl, setRequestedImageUrl] = useState<string>();
	const remoteImageUrl =
		media.modality === "image" &&
		media.source.type === "url" &&
		isSafeRemoteImageUrl(media.source.url)
			? media.source.url
			: undefined;
	if (
		remoteImageUrl &&
		(isTrustedRemoteImageUrl(remoteImageUrl) ||
			requestedImageUrl === remoteImageUrl)
	) {
		return (
			<ExpandableImage
				key={remoteImageUrl}
				label={media.name ?? "Generated image"}
				uri={remoteImageUrl}
			/>
		);
	}
	if (media.modality === "image" && media.source.type === "base64") {
		const validated = validateImageMedia(media.mediaType, media.source.data);
		if (validated.ok) {
			return (
				<ExpandableImage
					key={media.id}
					label={media.name ?? "Generated image"}
					uri={`data:${validated.mediaType};base64,${validated.base64}`}
				/>
			);
		}
	}

	if (media.modality === "audio" || media.modality === "video") {
		return (
			<PlayableMedia
				key={media.source.type === "url" ? media.source.url : media.id}
				media={media}
			/>
		);
	}

	const Icon = media.modality === "image" ? ImageOff : FileText;
	const sourceDetail =
		media.source.type === "artifact"
			? `Artifact ${media.source.artifactId}`
			: media.source.type === "url"
				? remoteImageUrl
					? "Load this external image?"
					: "This image URL cannot be loaded securely."
				: "Preview unavailable on mobile.";
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: 10,
				padding: 12,
				borderWidth: 1,
				borderColor: theme.color.border,
				borderRadius: theme.radius.md,
				backgroundColor: theme.color.surfaceMuted,
			}}
		>
			<Icon size={18} color={theme.color.textMuted} />
			<View style={{ flex: 1, gap: 2 }}>
				<Text variant="body">
					{media.name ?? `Generated ${media.modality}`}
				</Text>
				<Text variant="caption" tone="muted">
					{sourceDetail}
				</Text>
			</View>
			{remoteImageUrl ? (
				<Button
					label="Load image"
					variant="outline"
					onPress={() => setRequestedImageUrl(remoteImageUrl)}
				/>
			) : null}
		</View>
	);
}

function PlayableMedia({ media }: { media: GeneratedMedia }) {
	const [requested, setRequested] = useState(false);
	const theme = useTheme();
	const loadable =
		media.source.type === "base64" ||
		(media.source.type === "url" && isSafeRemoteImageUrl(media.source.url));
	return (
		<View
			style={{
				padding: 12,
				gap: 10,
				borderWidth: 1,
				borderColor: theme.color.border,
				borderRadius: theme.radius.md,
			}}
		>
			<Text weight="500">{media.name ?? `Generated ${media.modality}`}</Text>
			{requested ? (
				<>
					<GeneratedMediaPlayback media={media} />
					<Button
						label={`Close ${media.modality}`}
						variant="ghost"
						onPress={() => setRequested(false)}
					/>
				</>
			) : loadable ? (
				<>
					{media.source.type === "url" ? (
						<Text variant="caption" tone="muted">
							Load this {media.modality} from{" "}
							{new URL(media.source.url).hostname}?
						</Text>
					) : null}
					<Button
						label={`Load ${media.modality}`}
						variant="outline"
						onPress={() => setRequested(true)}
					/>
				</>
			) : (
				<Text variant="caption" tone="muted">
					{media.source.type === "artifact"
						? "This attachment is not available for playback on this device."
						: "This media URL cannot be loaded securely."}
				</Text>
			)}
		</View>
	);
}

function ExpandableImage({ label, uri }: { label: string; uri: string }) {
	const insets = useSafeAreaInsets();
	const reducedMotion = useReducedMotion();
	const theme = useTheme();
	const [expanded, setExpanded] = useState(false);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const retry = () => {
		setFailed(false);
		setAttempt((value) => value + 1);
	};
	const errorState = (
		<View style={{ padding: 16, gap: 12 }}>
			<Text variant="small" tone="muted" accessibilityRole="alert">
				This image could not be loaded. Check your connection and try again.
			</Text>
			<Button label="Retry image" variant="outline" onPress={retry} />
		</View>
	);
	return (
		<>
			{failed ? (
				errorState
			) : (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={label}
					accessibilityHint="Opens the image full screen"
					onPress={() => setExpanded(true)}
				>
					<Image
						key={attempt}
						onError={() => setFailed(true)}
						source={{ uri }}
						resizeMode="contain"
						style={{
							width: "100%",
							height: 240,
							borderRadius: theme.radius.md,
							backgroundColor: theme.color.surfaceMuted,
						}}
					/>
				</Pressable>
			)}
			<Modal
				supportedOrientations={[
					"portrait",
					"portrait-upside-down",
					"landscape",
				]}
				visible={expanded}
				animationType={reducedMotion ? "none" : "fade"}
				onRequestClose={() => setExpanded(false)}
			>
				<View
					style={{
						flex: 1,
						padding: 16,
						paddingTop: insets.top + 8,
						paddingBottom: insets.bottom + 8,
						paddingLeft: insets.left + 16,
						paddingRight: insets.right + 16,
						backgroundColor: theme.color.canvas,
					}}
				>
					<View style={{ alignItems: "flex-end" }}>
						<IconButton
							accessibilityLabel="Close image"
							onPress={() => setExpanded(false)}
						>
							<X size={20} color={theme.color.text} />
						</IconButton>
					</View>
					{failed ? (
						errorState
					) : (
						<Image
							key={attempt}
							source={{ uri }}
							onError={() => setFailed(true)}
							resizeMode="contain"
							style={{ flex: 1 }}
						/>
					)}
				</View>
			</Modal>
		</>
	);
}

/** Never let transcript data turn the native image loader into a cleartext fetch. */
export function isSafeRemoteImageUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

/** Cline-owned media can render without an extra privacy confirmation. */
export function isTrustedRemoteImageUrl(value: string): boolean {
	try {
		const hostname = new URL(value).hostname.toLowerCase();
		return hostname === "cline.bot" || hostname.endsWith(".cline.bot");
	} catch {
		return false;
	}
}
