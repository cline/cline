import {
	BottomSheetTextInput,
	type default as GorhomBottomSheet,
} from "@gorhom/bottom-sheet";
import { CircleHelp } from "lucide-react-native";
import {
	type RefObject,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { Pressable, View } from "react-native";
import type { SessionQuestionView } from "@/session";
import {
	clearSessionDraft,
	questionAnswerDraftKey,
	readSessionDraft,
	retireResolvedQuestionDrafts,
	sessionDraftEpoch,
	useSessionDraftEpoch,
	writeSessionDraft,
} from "@/state/session-drafts";
import {
	BottomSheet,
	Button,
	Divider,
	expandBottomSheetAfterKeyboardDismiss,
	Text,
	useTheme,
} from "@/ui";

export interface QuestionSheetProps {
	questions: SessionQuestionView[];
	draftKey?: string;
	draftsReady?: boolean;
	onAnswer(requestId: string, answer: string): Promise<void>;
	sheetRef?: RefObject<Pick<GorhomBottomSheet, "expand" | "close"> | null>;
}

/** Native counterpart to desktop's `AgentAskQuestion` surface. */
export function QuestionSheet(props: QuestionSheetProps) {
	const { draftKey, draftsReady = true, questions } = props;
	useEffect(() => {
		if (draftKey && draftsReady)
			retireResolvedQuestionDrafts(
				draftKey,
				questions.map((q) => q.requestId),
			);
	}, [draftKey, draftsReady, questions]);
	// A resolved dynamic sheet must not remain mounted and resurface on resize.
	// Pending state starts with an open native index, after its content exists.
	return questions.length ? <PendingQuestionSheet {...props} /> : null;
}

function PendingQuestionSheet({
	questions,
	draftKey,
	onAnswer,
	sheetRef: externalRef,
}: QuestionSheetProps) {
	const nativeRef = useRef<GorhomBottomSheet>(null);
	const internalRef = useRef<Pick<GorhomBottomSheet, "expand" | "close">>(null);
	const sheetRef = externalRef ?? internalRef;
	const [open, setOpen] = useState(true);
	// Keep the declarative index aligned with pan/backdrop closure. Imperative
	// expand() can otherwise target a stale native animation after navigation.
	useImperativeHandle(
		sheetRef,
		() => ({
			expand: () => setOpen(true),
			close: () => setOpen(false),
		}),
		[],
	);
	const epoch = useSessionDraftEpoch();
	useEffect(() => {
		expandBottomSheetAfterKeyboardDismiss(sheetRef);
	}, [sheetRef]);
	return (
		<BottomSheet
			ref={nativeRef}
			index={open ? 0 : -1}
			onChange={(index) => setOpen(index >= 0)}
			enableDynamicSizing
			enablePanDownToClose
			scrollable
		>
			<View style={{ gap: 16 }}>
				{questions.map((question, index) => (
					<View
						key={`${epoch}:${draftKey ?? ""}:${question.requestId}`}
						style={{ gap: 16 }}
					>
						{index > 0 ? <Divider /> : null}
						<QuestionCard
							question={question}
							onAnswer={onAnswer}
							draftKey={
								draftKey
									? questionAnswerDraftKey(draftKey, question.requestId)
									: undefined
							}
						/>
					</View>
				))}
			</View>
		</BottomSheet>
	);
}

function QuestionCard({
	draftKey,
	question,
	onAnswer,
}: {
	draftKey?: string;
	question: SessionQuestionView;
	onAnswer: (requestId: string, answer: string) => Promise<void>;
}) {
	const theme = useTheme();
	const [selected, setSelected] = useState<string>();
	const [customAnswer, setCustomAnswer] = useState(() =>
		draftKey ? (readSessionDraft(draftKey) ?? "") : "",
	);
	const ownedEpoch = useRef(sessionDraftEpoch()).current;
	const changeCustomAnswer = (text: string) => {
		if (sessionDraftEpoch() !== ownedEpoch) return;
		setCustomAnswer(text);
		if (draftKey) writeSessionDraft(draftKey, text);
	};
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [error, setError] = useState<string>();

	const submit = async (answer: string) => {
		const normalized = answer.trim();
		if (!normalized || sendingRef.current || sessionDraftEpoch() !== ownedEpoch)
			return;
		sendingRef.current = true;
		setSelected(normalized);
		setSending(true);
		setError(undefined);
		try {
			await onAnswer(question.requestId, normalized);
			if (draftKey && sessionDraftEpoch() === ownedEpoch)
				clearSessionDraft(draftKey);
		} catch {
			setError(
				"Could not send your answer. Check the connection and try again.",
			);
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	};

	return (
		<View style={{ gap: 12 }}>
			<View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
				<CircleHelp size={18} color={theme.brand.violet} />
				<Text variant="body" weight="500" style={{ flex: 1 }}>
					{question.question}
				</Text>
			</View>
			<View accessibilityRole="radiogroup" style={{ gap: 8 }}>
				{question.options.map((option, index) => {
					const isSelected = selected === option;
					return (
						<Pressable
							// biome-ignore lint/suspicious/noArrayIndexKey: model-supplied repeats are intentional, so the value alone is not unique.
							key={`${index}-${option}`}
							accessibilityRole="radio"
							accessibilityLabel={`${String.fromCharCode(65 + index)}. ${option}`}
							accessibilityState={{ selected: isSelected, disabled: sending }}
							disabled={sending}
							onPress={() => void submit(option)}
							style={({ pressed }) => ({
								minHeight: 44,
								flexDirection: "row",
								alignItems: "center",
								gap: 10,
								paddingHorizontal: 12,
								paddingVertical: 10,
								borderWidth: 1,
								borderColor: isSelected
									? theme.brand.violet
									: theme.color.border,
								borderRadius: theme.radius.sm,
								backgroundColor:
									isSelected || pressed
										? theme.color.surfaceMuted
										: theme.color.canvas,
							})}
						>
							<Text variant="caption" tone="muted" style={{ width: 16 }}>
								{String.fromCharCode(65 + index)}
							</Text>
							<Text variant="body" style={{ flex: 1 }}>
								{option}
							</Text>
						</Pressable>
					);
				})}
			</View>
			<BottomSheetTextInput
				keyboardAppearance={theme.mode}
				accessibilityLabel="Custom answer"
				placeholder="Or type your own answer…"
				placeholderTextColor={theme.color.textMuted}
				value={customAnswer}
				onChangeText={changeCustomAnswer}
				editable={!sending}
				returnKeyType="send"
				onSubmitEditing={() => void submit(customAnswer)}
				style={{
					minHeight: 44,
					paddingHorizontal: 12,
					paddingVertical: 10,
					color: theme.color.text,
					backgroundColor: theme.color.canvas,
					borderColor: theme.color.border,
					borderWidth: 1,
					borderRadius: theme.radius.sm,
					fontSize: 16,
				}}
			/>
			{error ? (
				<Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
					{error}
				</Text>
			) : null}
			<Button
				label="Submit"
				loading={sending}
				loadingLabel="Sending…"
				disabled={sending || !customAnswer.trim()}
				fullWidth
				onPress={() => void submit(customAnswer)}
			/>
		</View>
	);
}
