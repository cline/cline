import {
	type ExpoSpeechRecognitionErrorCode,
	ExpoSpeechRecognitionModule,
	useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { Mic, Square } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";
import { withAlpha } from "@/theme/brand";
import { Spinner, Text, useTheme } from "@/ui";

export interface TextSelection {
	start: number;
	end: number;
}

export interface DictationSession extends TextSelection {
	expectedValue: string;
}

export interface AppliedDictation {
	value: string;
	selection: TextSelection;
	session: DictationSession;
}

/** Captures the exact range a new dictation result owns. */
export function beginDictation(
	value: string,
	selection: TextSelection,
): DictationSession {
	const start = clamp(selection.start, 0, value.length);
	const end = clamp(selection.end, start, value.length);
	return { start, end, expectedValue: value };
}

/**
 * Replaces only the range owned by the current dictation session.
 *
 * Partial results replace the prior partial rather than accumulating. If another
 * writer changed the draft, `undefined` prevents stale numeric offsets from
 * overwriting that edit.
 */
export function applyDictationResult(
	session: DictationSession,
	currentValue: string,
	transcript: string,
): AppliedDictation | undefined {
	if (currentValue !== session.expectedValue) return undefined;
	const text = transcript.trim();
	if (!text) return undefined;

	const before = currentValue.slice(0, session.start);
	const after = currentValue.slice(session.end);
	const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const trailingSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
	const insertion = `${leadingSpace}${text}${trailingSpace}`;
	const value = `${before}${insertion}${after}`;
	const end = session.start + insertion.length;
	return {
		value,
		selection: { start: end, end },
		session: { start: session.start, end, expectedValue: value },
	};
}

export type VoiceDictationState =
	| "idle"
	| "requesting"
	| "listening"
	| "transcribing"
	| "error";

export interface UseVoiceDictation {
	state: VoiceDictationState;
	active: boolean;
	error?: string;
	start(): Promise<void>;
	stop(): void;
}

export function useVoiceDictation({
	value,
	selection,
	onChange,
	onSelectionChange,
}: {
	value: string;
	selection: TextSelection;
	onChange(value: string): void;
	onSelectionChange(selection: TextSelection): void;
}): UseVoiceDictation {
	const [state, setState] = useState<VoiceDictationState>("idle");
	const [error, setError] = useState<string>();
	const valueRef = useRef(value);
	const selectionRef = useRef(selection);
	const sessionRef = useRef<DictationSession | undefined>(undefined);
	const operationRef = useRef(0);
	valueRef.current = value;
	selectionRef.current = selection;

	useSpeechRecognitionEvent("start", () => {
		if (sessionRef.current) setState("listening");
	});
	useSpeechRecognitionEvent("result", (event) => {
		const session = sessionRef.current;
		const transcript = event.results[0]?.transcript;
		if (!session || !transcript) return;
		const applied = applyDictationResult(session, valueRef.current, transcript);
		if (!applied) {
			sessionRef.current = undefined;
			ExpoSpeechRecognitionModule.abort();
			setState("error");
			setError("Voice input stopped because the draft changed.");
			return;
		}
		// Update refs before React commits so a second native partial cannot race the
		// controlled input render and be mistaken for an outside edit.
		valueRef.current = applied.value;
		selectionRef.current = applied.selection;
		sessionRef.current = applied.session;
		onChange(applied.value);
		onSelectionChange(applied.selection);
	});
	useSpeechRecognitionEvent("end", () => {
		if (!sessionRef.current) return;
		sessionRef.current = undefined;
		setState("idle");
	});
	useSpeechRecognitionEvent("error", (event) => {
		// Native events are shared by every mounted composer, including hidden routes.
		if (!sessionRef.current) return;
		sessionRef.current = undefined;
		setState("error");
		setError(voiceErrorMessage(event.error, event.message));
	});

	useEffect(
		() => () => {
			operationRef.current += 1;
			if (sessionRef.current) {
				sessionRef.current = undefined;
				ExpoSpeechRecognitionModule.abort();
			}
		},
		[],
	);

	const start = useCallback(async () => {
		if (sessionRef.current) return;
		setError(undefined);
		setState("requesting");
		const operation = ++operationRef.current;
		try {
			if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
				throw new Error("Voice input is not available on this device.");
			}
			const permission =
				await ExpoSpeechRecognitionModule.requestPermissionsAsync();
			if (operation !== operationRef.current) return;
			if (!permission.granted) {
				throw new Error(
					permission.canAskAgain
						? "Microphone and speech recognition permission are required."
						: "Enable microphone and speech recognition access in Settings.",
				);
			}

			sessionRef.current = beginDictation(
				valueRef.current,
				selectionRef.current,
			);
			ExpoSpeechRecognitionModule.start({
				lang: "en-US",
				interimResults: true,
				continuous: false,
				maxAlternatives: 1,
				addsPunctuation: true,
			});
		} catch (cause) {
			if (operation !== operationRef.current) return;
			sessionRef.current = undefined;
			setState("error");
			setError(
				cause instanceof Error ? cause.message : "Voice input could not start.",
			);
		}
	}, []);

	const stop = useCallback(() => {
		if (!sessionRef.current) return;
		setState("transcribing");
		try {
			ExpoSpeechRecognitionModule.stop();
		} catch (cause) {
			sessionRef.current = undefined;
			setState("error");
			setError(
				cause instanceof Error ? cause.message : "Voice input could not stop.",
			);
		}
	}, []);

	return {
		state,
		active:
			state === "requesting" ||
			state === "listening" ||
			state === "transcribing",
		...(error ? { error } : {}),
		start,
		stop,
	};
}

export function VoiceInputFeedback({
	voice,
}: {
	voice: Pick<UseVoiceDictation, "active" | "error" | "state">;
}) {
	if (!voice.active && !voice.error) return null;
	return (
		<Text
			variant="small"
			tone={voice.error ? "danger" : "muted"}
			accessibilityLiveRegion="polite"
		>
			{voice.error ??
				(voice.state === "listening"
					? "Listening…"
					: voice.state === "requesting"
						? "Requesting microphone access…"
						: "Finishing transcription…")}
		</Text>
	);
}

export function VoiceInputButton({ voice }: { voice: UseVoiceDictation }) {
	const theme = useTheme();
	const listening = voice.state === "listening";
	const busy = voice.state === "requesting" || voice.state === "transcribing";
	const label = listening
		? "Stop voice input"
		: busy
			? "Finishing voice input"
			: "Start voice input";
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ busy, selected: listening }}
			disabled={busy}
			onPress={() => (listening ? voice.stop() : void voice.start())}
			hitSlop={5}
			style={({ pressed }) => ({
				width: 34,
				height: 34,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: 999,
				backgroundColor: listening
					? theme.color.danger
					: pressed
						? theme.color.surfaceMuted
						: "transparent",
				opacity: busy ? 0.7 : 1,
			})}
		>
			{busy ? (
				<Spinner size={15} color={theme.color.textMuted} />
			) : listening ? (
				<Square
					size={13}
					fill={theme.color.onDanger}
					color={theme.color.onDanger}
				/>
			) : (
				<Mic
					size={17}
					color={
						voice.state === "error"
							? theme.color.danger
							: withAlpha(theme.color.text, 0.7)
					}
				/>
			)}
		</Pressable>
	);
}

export function voiceErrorMessage(
	error: ExpoSpeechRecognitionErrorCode,
	detail: string,
): string {
	// iOS can report availability, then fail to load its speech model when
	// recognition starts (including in Simulator). Do not expose framework jargon.
	if (/failed to initialize recognizer/i.test(detail)) {
		return "Speech recognition could not start on this device. Try again, or type your message.";
	}
	switch (error) {
		case "not-allowed":
			return "Enable microphone and speech recognition access in Settings.";
		case "no-speech":
		case "speech-timeout":
			return "No speech was detected. Try again.";
		case "network":
			return "Voice input needs a network connection on this device.";
		case "service-not-allowed":
		case "language-not-supported":
			return "Voice input is not available for this language on this device.";
		case "aborted":
			return "Voice input was cancelled.";
		default:
			return detail.trim() || "Voice input failed. Try again.";
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
