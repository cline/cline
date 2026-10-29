/** Composes a first message for the selected execution target. */

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import {
	Check,
	ChevronDown,
	ChevronUp,
	Cloud,
	MonitorSmartphone,
} from "lucide-react-native";
import { type RefObject, useRef, useState } from "react";
import {
	Keyboard,
	Platform,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { modelDisplayName } from "@/cloud/model-display";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import type { SessionInputAttachments } from "@/session";
import { AutoGrowTextInput, BottomSheet, Button, Text, useTheme } from "@/ui";
import {
	type TextSelection,
	useVoiceDictation,
	VoiceInputButton,
	VoiceInputFeedback,
} from "@/voice/dictation";

import { ComposerActions } from "../chat/ComposerActions";
import { ComposerAttachmentMenu } from "../chat/ComposerAttachmentMenu";
import {
	ATTACHMENT_MESSAGE_REQUIRED,
	getImageCapabilityError,
	ImageAttachmentStrip,
	useImageAttachments,
} from "../chat/ImageAttachmentControl";
import type { HomeExecutionTarget } from "./execution-targets";
import { targetLocation } from "./execution-targets";

export interface HomeComposerProps {
	draft: string;
	target?: HomeExecutionTarget;
	cloud?: boolean;
	busy?: boolean;
	onChooseTarget?(): void;
	providerId?: string;
	modelId?: string;
	modelName?: string;
	supportsImages?: boolean;
	checkingImageSupport?: boolean;
	onOpenModel?(section?: "providers" | "models"): void;
	onDraftChange(text: string): void;
	onSend(text: string, attachments?: SessionInputAttachments): void;
}

export function HomeComposer({
	draft,
	target,
	cloud = target?.mode === "cloud",
	busy = false,
	onChooseTarget,
	providerId,
	modelId,
	modelName,
	supportsImages,
	checkingImageSupport = false,
	onOpenModel,
	onDraftChange,
	onSend,
}: HomeComposerProps) {
	const theme = useTheme();
	const compact = useWindowDimensions().height < 500;
	const android = Platform.OS === "android";
	const inline = android && compact;
	const EditingContainer = android ? ScrollView : View;
	const cloudModelId =
		modelId ||
		(target?.mode === "cloud" ? target.cloud.modelId : CLINE_DEFAULT_MODEL_ID);
	const modelLabel = cloud
		? modelName ||
			(cloudModelId === CLINE_DEFAULT_MODEL_ID
				? "Cline Auto"
				: modelDisplayName(cloudModelId))
		: modelName || modelId || targetModelLabel(target, providerId, modelId);

	const [focused, setFocused] = useState(false);
	const [submissionError, setSubmissionError] = useState<string>();
	const [selection, setSelection] = useState<TextSelection>(() => ({
		start: draft.length,
		end: draft.length,
	}));
	const changeDraft = (next: string) => {
		setSubmissionError(undefined);
		onDraftChange(next);
	};
	const voice = useVoiceDictation({
		value: draft,
		selection,
		onChange: changeDraft,
		onSelectionChange: setSelection,
	});
	const attachments = useImageAttachments();
	const draftRef = useRef<string | null>(draft);
	draftRef.current = draft;
	const imageCapabilityError = getImageCapabilityError({
		hasImages: attachments.images.length > 0,
		checkingImageSupport,
		supportsImages,
	});
	const canSend =
		draft.trim().length > 0 &&
		(target !== undefined || onChooseTarget !== undefined) &&
		!busy &&
		!voice.active &&
		!imageCapabilityError;
	const send = () => {
		if (!canSend || imageCapabilityError || draftRef.current === null) return;
		if (!draft.trim() && attachments.images.length > 0) {
			setSubmissionError(ATTACHMENT_MESSAGE_REQUIRED);
			return;
		}
		if (!target) {
			onChooseTarget?.();
			return;
		}
		const userImages = attachments.images.map(
			(image) => `data:${image.mediaType};base64,${image.base64}`,
		);
		Keyboard.dismiss();
		const submitted = draftRef.current;
		draftRef.current = null;
		onSend(submitted, userImages.length > 0 ? { userImages } : undefined);
		attachments.clear();
	};

	return (
		<View
			style={{
				flexDirection: inline ? "row" : "column",
				alignItems: inline ? "center" : undefined,
				borderWidth: 1,
				borderColor: focused
					? theme.brand.violetBorder
					: theme.color.borderStrong,
				borderRadius: 18,
				backgroundColor: theme.color.surfaceRaised,
				overflow: "hidden",
				shadowColor: theme.brand.violet,
				shadowOffset: { width: 0, height: 0 },
				shadowOpacity: focused ? 0.2 : 0,
				shadowRadius: 2,
			}}
		>
			{/* Keep editing content scrollable while landscape actions stay visible. */}
			<EditingContainer
				{...(android
					? {
							keyboardShouldPersistTaps: "handled" as const,
							nestedScrollEnabled: true,
							scrollEnabled: inline,
							contentContainerStyle: {
								minHeight: inline ? 44 : 56,
								paddingHorizontal: 12,
								paddingTop: inline ? 0 : 12,
							},
						}
					: {})}
				style={
					android
						? {
								flexGrow: inline ? 1 : 0,
								flexShrink: inline ? 1 : 0,
								minWidth: 0,
								maxHeight: inline ? 48 : undefined,
							}
						: { minHeight: 56, paddingHorizontal: 12, paddingTop: 12 }
				}
			>
				<AutoGrowTextInput
					minHeight={44}
					maxHeight={inline ? 44 : compact ? 60 : 140}
					value={draft}
					onChangeText={changeDraft}
					selection={selection}
					onSelectionChange={(event) =>
						setSelection(event.nativeEvent.selection)
					}
					placeholder="Ask Cline…"
					editable={!voice.active}
					disableFullscreenUI
					showSoftInputOnFocus
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					style={{ width: "100%" }}
					accessibilityLabel="Message Cline from Home"
				/>
				<VoiceInputFeedback voice={voice} />
				<ImageAttachmentStrip
					images={attachments.images}
					error={imageCapabilityError ?? attachments.error ?? submissionError}
					onRemove={(id) => {
						setSubmissionError(undefined);
						attachments.remove(id);
					}}
				/>
				{!draft.trim() &&
				attachments.images.length > 0 &&
				!imageCapabilityError &&
				!attachments.error ? (
					<Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
						{ATTACHMENT_MESSAGE_REQUIRED}
					</Text>
				) : null}
			</EditingContainer>

			<View
				style={{
					width: inline ? "40%" : undefined,
					minWidth: inline ? 220 : undefined,
					maxWidth: inline ? 360 : undefined,
					minHeight: 44,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 0,
					paddingHorizontal: 6,
					paddingBottom: inline ? 0 : 4,
				}}
			>
				<ComposerAttachmentMenu
					draft={draft}
					onDraftChange={changeDraft}
					onError={setSubmissionError}
					onPickImages={() => {
						setSubmissionError(undefined);
						void attachments.pick();
					}}
					disabled={busy || voice.active}
				/>
				<Pressable
					accessibilityRole={onOpenModel ? "button" : "text"}
					accessibilityLabel={
						cloud
							? `Model: ${modelLabel}`
							: targetModelAccessibilityLabel(target, providerId, modelId)
					}
					disabled={!onOpenModel}
					onPress={() => onOpenModel?.("models")}
					style={{
						flex: 1,
						minWidth: 0,
						minHeight: 44,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "flex-start",
						gap: 4,
					}}
				>
					<Text
						variant="small"
						tone="muted"
						numberOfLines={1}
						style={{ flexShrink: 1 }}
					>
						{modelLabel}
					</Text>
					{onOpenModel ? (
						<ChevronUp size={12} color={theme.color.textMuted} />
					) : null}
				</Pressable>
				<ComposerActions
					welcome
					canSend={canSend}
					onSend={send}
					sendLabel={target ? `Send to ${target.title}` : "Send message"}
				>
					<View style={{ width: 44, alignItems: "center" }}>
						<VoiceInputButton voice={voice} />
					</View>
				</ComposerActions>
			</View>
		</View>
	);
}

export function HomeTargetControl({
	target,
	onChooseTarget,
}: {
	target?: HomeExecutionTarget;
	onChooseTarget?: () => void;
}) {
	const theme = useTheme();
	const Icon =
		target?.mode === "local" || target?.mode === "local-session"
			? MonitorSmartphone
			: Cloud;
	return (
		<Pressable
			accessibilityRole={onChooseTarget ? "button" : undefined}
			accessibilityLabel={
				target
					? `Message target: ${target.title}, ${targetLocation(target)}`
					: "No Cline target connected"
			}
			accessibilityHint={
				onChooseTarget ? "Choose where Cline starts new work" : undefined
			}
			disabled={!onChooseTarget}
			onPress={onChooseTarget}
			style={({ pressed }) => ({
				alignSelf: "flex-start",
				minHeight: 44,
				maxWidth: "100%",
				flexDirection: "row",
				alignItems: "center",
				gap: 6,
				paddingHorizontal: 12,
				paddingVertical: 6,
				borderRadius: theme.radius.sm,
				backgroundColor: pressed
					? theme.color.surfaceHover
					: theme.color.canvas,
			})}
		>
			<Icon size={15} color={theme.color.textMuted} />
			<View style={{ flexShrink: 1, minWidth: 0 }}>
				<Text
					variant="small"
					weight="500"
					numberOfLines={1}
					ellipsizeMode="tail"
				>
					{target ? target.title : "Connect to start"}
					{target ? (
						<Text variant="caption" tone="muted" weight="400">
							{" · "}
							{targetContextDetail(target)}
						</Text>
					) : null}
				</Text>
			</View>
			{onChooseTarget ? (
				<ChevronDown size={14} color={theme.color.textMuted} />
			) : null}
		</Pressable>
	);
}

export function HomeTargetSheet({
	targets,
	selectedKey,
	onSelect,
	onConfigureCloud,
	onPairComputer,
	sheetRef,
}: {
	targets: readonly HomeExecutionTarget[];
	selectedKey?: string;
	onSelect(target: HomeExecutionTarget): void;
	onConfigureCloud?(): void;
	onPairComputer?(): void;
	sheetRef: RefObject<GorhomBottomSheet | null>;
}) {
	const theme = useTheme();
	const newTargets = targets.filter(
		(target) =>
			target.mode === "cloud" ||
			(COMPUTER_CONNECTIONS_ENABLED && target.mode === "local"),
	);
	return (
		<BottomSheet
			ref={sheetRef}
			index={-1}
			enableDynamicSizing
			enablePanDownToClose
			scrollable
		>
			<View style={{ gap: 4 }}>
				<Text variant="body" weight="500">
					Choose where to work
				</Text>
				<Text variant="small" tone="muted">
					Choose where Cline starts new work.
				</Text>
				<View style={{ gap: 14, paddingTop: 12 }}>
					<View style={{ gap: 4 }}>
						<Text variant="caption" tone="muted" weight="500">
							Start new
						</Text>
						{newTargets.map((target) => {
							const Icon = target.mode === "local" ? MonitorSmartphone : Cloud;
							const selected = target.id === selectedKey;
							return (
								<Pressable
									key={target.id}
									accessibilityRole="button"
									accessibilityLabel={`Use ${target.title} on ${targetLocation(target)}`}
									onPress={() => onSelect(target)}
									style={({ pressed }) => ({
										minHeight: 52,
										flexDirection: "row",
										alignItems: "center",
										gap: 10,
										paddingHorizontal: 10,
										borderRadius: theme.radius.md,
										backgroundColor:
											pressed || selected
												? theme.color.surfaceMuted
												: "transparent",
									})}
								>
									<Icon size={17} color={theme.brand.violet} />
									<View style={{ flex: 1, gap: 2 }}>
										<Text variant="body" weight="500" numberOfLines={1}>
											{target.title}
										</Text>
										<Text variant="caption" tone="muted" numberOfLines={1}>
											{target.detail}
										</Text>
									</View>
									{selected ? (
										<Check size={16} color={theme.brand.violet} />
									) : null}
								</Pressable>
							);
						})}
						{onConfigureCloud &&
						!newTargets.some((target) => target.mode === "cloud") ? (
							<Button
								label="Set up Cline Cloud for new work"
								variant="outline"
								fullWidth
								onPress={onConfigureCloud}
							/>
						) : null}
						{COMPUTER_CONNECTIONS_ENABLED &&
						onPairComputer &&
						!newTargets.some((target) => target.mode === "local") ? (
							<Button
								label="Pair a computer"
								variant="outline"
								fullWidth
								onPress={onPairComputer}
							/>
						) : null}
					</View>
				</View>
			</View>
		</BottomSheet>
	);
}

function targetModelLabel(
	target?: HomeExecutionTarget,
	providerId?: string,
	modelId?: string,
): string {
	if (
		!target ||
		target.mode === "cloud-session" ||
		target.mode === "local-session"
	)
		return "Cline";
	const provider =
		(providerId?.trim() || "cline") === "cline" ? "Cline" : providerId;
	const model =
		modelId?.trim() ||
		(target.mode === "local" ? CLINE_DEFAULT_MODEL_ID : target.cloud.modelId);
	return `${provider} · ${model}`;
}

function targetModelAccessibilityLabel(
	target?: HomeExecutionTarget,
	providerId?: string,
	modelId?: string,
): string {
	if (
		!target ||
		target.mode === "cloud-session" ||
		target.mode === "local-session"
	) {
		return "Cline provider; model configured by the session";
	}
	return `Model: ${targetModelLabel(target, providerId, modelId)}`;
}

function targetContextDetail(target: HomeExecutionTarget): string {
	if (
		target.mode === "local" &&
		target.detail.toLowerCase().includes("can't reach")
	) {
		return target.detail;
	}
	if (target.mode === "local") return "Start new · Cline";
	if (target.mode === "cloud") return "Start new · Cline Cloud";
	return targetLocation(target);
}
