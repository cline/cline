/**
 * The screen owns draft text, queue state, and session submission; this component
 * owns the editable message and its small attachment, model, and send controls.
 */

import { Coins } from "lucide-react-native";
import { type ReactNode, useRef, useState } from "react";
import { Keyboard, ScrollView, View } from "react-native";
import type { TokenUsageView } from "@/session";
import { AutoGrowTextInput, Text, useTheme } from "@/ui";
import {
	type TextSelection,
	useVoiceDictation,
	VoiceInputButton,
	VoiceInputFeedback,
} from "@/voice/dictation";
import { ComposerActions } from "./ComposerActions";
import { ComposerAttachmentMenu } from "./ComposerAttachmentMenu";
import {
	ATTACHMENT_MESSAGE_REQUIRED,
	getImageCapabilityError,
	ImageAttachmentStrip,
	useImageAttachments,
} from "./ImageAttachmentControl";

export interface ComposerAttachments {
	userImages: string[];
}

export interface ComposerProps {
	maxHeight?: number;
	compact?: boolean;
	horizontalInsets?: { left: number; right: number };
	running: boolean;
	/** Blocks submission while preserving the user's ability to draft. */
	sendDisabled?: boolean;
	/** Unknown is allowed; only explicit catalog support can reject an image. */
	supportsImages?: boolean;
	checkingImageSupport?: boolean;
	usageTotal?: TokenUsageView;
	/** Controlled draft text. */
	draft: string;
	onDraftChange(text: string): void;
	onSend(text: string, attachments?: ComposerAttachments): void | Promise<void>;
	/** Images retained when a staged Home caption was edited while connecting. */
	initialUserImages?: readonly string[];
	/** Keeps a pending Home submission in sync when its staged images are edited. */
	onUserImagesChange?(userImages: string[]): void;
	onAbort(): void;
	/** Compact model selector shown beside Add in the toolbar. */
	controls?: ReactNode;
	/**
	 * The machine's turn queue, rendered below the draft. A slot rather than
	 * a prompts array so the composer stays presentational and the screen keeps
	 * ownership of the hub commands that mutate the queue.
	 */
	queued?: ReactNode;
}

export function Composer({
	maxHeight,
	compact = false,
	horizontalInsets = { left: 0, right: 0 },
	running,
	sendDisabled = false,
	supportsImages,
	checkingImageSupport = false,
	usageTotal,
	draft,
	onDraftChange,
	onSend,
	initialUserImages,
	onUserImagesChange,
	onAbort,
	controls,
	queued,
}: ComposerProps) {
	const theme = useTheme();
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
	const attachments = useImageAttachments(
		initialUserImages,
		onUserImagesChange,
	);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const trimmed = draft.trim();
	const hasDraft = trimmed.length > 0 || attachments.images.length > 0;
	const imageCapabilityError = getImageCapabilityError({
		hasImages: attachments.images.length > 0,
		checkingImageSupport,
		supportsImages,
	});
	const canSend =
		hasDraft && !sendDisabled && !voice.active && !imageCapabilityError;

	const placeholder = running ? "Add a follow-up…" : "Message Cline…";

	const handleSend = async () => {
		if (imageCapabilityError) return;
		const submitted = draftRef.current.trim();
		if (!submitted && attachments.images.length > 0) {
			setSubmissionError(ATTACHMENT_MESSAGE_REQUIRED);
			return;
		}
		if (
			(!submitted && attachments.images.length === 0) ||
			sendDisabled ||
			voice.active
		) {
			return;
		}
		Keyboard.dismiss();
		// Clear at acceptance time, not when the whole run finishes. Besides matching
		// chat UX, updating the ref synchronously prevents a fast double-tap from
		// submitting the same controlled value twice before React rerenders.
		draftRef.current = "";
		changeDraft("");
		const userImages = attachments.images.map(
			(image) => `data:${image.mediaType};base64,${image.base64}`,
		);
		// `session.send_input` settles when the run finishes, not when the Hub accepts
		// the prompt. The composer must reset at submission time; delivery failures
		// belong to the optimistic bubble's explicit Retry affordance.
		attachments.clear();
		try {
			await onSend(submitted, userImages.length ? { userImages } : undefined);
		} catch {
			// SessionConnection marks the optimistic message failed and keeps its full
			// attachment payload for Retry. Do not duplicate it back into the composer.
		}
	};

	return (
		<View
			style={{
				maxHeight,
				flexShrink: 0,
				backgroundColor: theme.color.canvas,
				paddingLeft: (compact ? 0 : 12) + horizontalInsets.left,
				paddingRight: (compact ? 0 : 12) + horizontalInsets.right,
				paddingTop: compact ? 0 : 8,
				paddingBottom: compact ? 0 : 6,
			}}
		>
			<View
				style={{
					flexShrink: 1,
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
				{/* Keep actions outside scrolling content so queues and attachments cannot
				    push Send and Stop behind a landscape keyboard. */}
				<ScrollView
					keyboardShouldPersistTaps="handled"
					nestedScrollEnabled
					style={{ flexGrow: 0, flexShrink: 1 }}
					contentContainerStyle={{
						paddingHorizontal: 12,
						paddingTop: compact ? 8 : 12,
					}}
				>
					<AutoGrowTextInput
						minHeight={44}
						maxHeight={compact ? 60 : 140}
						value={draft}
						onChangeText={changeDraft}
						selection={selection}
						onSelectionChange={(event) =>
							setSelection(event.nativeEvent.selection)
						}
						placeholder={placeholder}
						editable={!voice.active}
						disableFullscreenUI
						showSoftInputOnFocus
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						style={{ width: "100%", paddingVertical: 6 }}
						accessibilityLabel="Message composer"
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
					{queued}
					{usageTotal ? (
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								paddingTop: 6,
							}}
						>
							<Coins size={12} color={theme.color.textMuted} />
							<Text variant="mono" tone="muted" style={{ marginLeft: 6 }}>
								{formatUsage(usageTotal)}
							</Text>
						</View>
					) : null}
				</ScrollView>

				<View
					testID="composer-toolbar"
					style={{
						flexShrink: 0,
						minHeight: 44,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						paddingHorizontal: 6,
						paddingBottom: 4,
					}}
				>
					<View
						testID="composer-leading-controls"
						style={{
							flexDirection: "row",
							alignItems: "center",
							flex: 1,
							minWidth: 0,
							gap: 8,
						}}
					>
						<ComposerAttachmentMenu
							draft={draft}
							onDraftChange={changeDraft}
							onPickImages={() => {
								setSubmissionError(undefined);
								void attachments.pick();
							}}
							disabled={voice.active || sendDisabled}
							onError={setSubmissionError}
						/>
						<View style={{ flex: 1, minWidth: 0 }}>{controls}</View>
					</View>
					<ComposerActions
						canSend={canSend}
						onSend={() => void handleSend().catch(() => {})}
						sendLabel="Send"
						onAbort={running ? onAbort : undefined}
						welcome
					>
						<VoiceInputButton voice={voice} />
					</ComposerActions>
				</View>
			</View>
		</View>
	);
}

function formatUsage(usage: TokenUsageView): string {
	const tokens = usage.inputTokens + usage.outputTokens;
	const cost = usage.totalCost;
	return `${formatTokens(tokens)} · $${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1)}k`;
	}
	return String(count);
}
