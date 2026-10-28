import {
	type ExpoSpeechRecognitionErrorCode,
	ExpoSpeechRecognitionModule,
	useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { NavigationContext } from "expo-router/react-navigation";
import { Mic, Square } from "lucide-react-native";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Pressable } from "react-native";
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
	notice?: string;
	start(): Promise<void>;
	stop(): void;
}

interface DictationOwner {
	cancel(): void;
}
// Expo speech events are process-wide, while navigation retains hidden composers.
// One lease owns both pending permission work and all native transcript events.
let activeDictationOwner: DictationOwner | undefined;
let dictationRequestRevision = 0;

// Recognition services may need network time to deliver the final result. Allow
// 15 seconds after Stop, then retire the run if native emits no terminal event.
const FINAL_TRANSCRIPTION_GRACE_MS = 15000;
interface NativeEndBarrier {
	promise: Promise<void>;
	recoverAfterError?: () => Promise<void>;
}
let nativeEndBarrier: NativeEndBarrier | undefined;
/** Keep one listener across route unmount and explicit error recovery. A native
 * construction error can omit end on iOS; one explicit retry may abort/drain it.
 * An abort that fails to end stays blocked until a real native end arrives.
 */
function waitForNativeEnd(abort: boolean): Promise<void> {
	if (nativeEndBarrier) return nativeEndBarrier.promise;
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	let timer: ReturnType<typeof setTimeout>;
	let aborted = abort;
	const barrier: NativeEndBarrier = {
		promise: undefined as unknown as Promise<void>,
	};
	const beginWait = () => {
		const promise = new Promise<void>((done, fail) => {
			resolve = done;
			reject = fail;
		});
		// A blur/unmount can retire speech without a replacement waiting yet.
		void promise.catch(() => {});
		timer = setTimeout(() => {
			if (!aborted)
				barrier.recoverAfterError = () => {
					barrier.recoverAfterError = undefined;
					aborted = true;
					barrier.promise = beginWait();
					abortNative();
					return barrier.promise;
				};
			reject(
				new Error(
					"Voice input did not finish stopping. Close and reopen the app before trying again.",
				),
			);
		}, 2000);
		return promise;
	};
	const abortNative = () => {
		try {
			ExpoSpeechRecognitionModule.abort();
		} catch {
			clearTimeout(timer);
			reject(
				new Error(
					"Voice input could not stop. Close and reopen the app before trying again.",
				),
			);
		}
	};
	barrier.promise = beginWait();
	nativeEndBarrier = barrier;
	const subscription = ExpoSpeechRecognitionModule.addListener("end", () => {
		clearTimeout(timer);
		subscription.remove();
		if (nativeEndBarrier === barrier) nativeEndBarrier = undefined;
		barrier.recoverAfterError = undefined;
		resolve();
	});
	if (abort) abortNative();
	return barrier.promise;
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
	const navigation = useContext(NavigationContext);
	const owner = useRef<DictationOwner>({ cancel: () => {} }).current;
	const [state, setState] = useState<VoiceDictationState>("idle");
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const mountedRef = useRef(true);
	const permissionRequestRef = useRef<
		{ revision: number; canceledGeneration?: number } | undefined
	>(undefined);
	const valueRef = useRef(value);
	const selectionRef = useRef(selection);
	const sessionRef = useRef<DictationSession | undefined>(undefined);
	const operationRef = useRef(0);
	const finalTranscriptTimer = useRef<
		ReturnType<typeof setTimeout> | undefined
	>(undefined);
	const clearFinalTranscriptTimer = useCallback(() => {
		clearTimeout(finalTranscriptTimer.current);
		finalTranscriptTimer.current = undefined;
	}, []);
	valueRef.current = value;
	selectionRef.current = selection;
	const cancel = useCallback(() => {
		clearFinalTranscriptTimer();
		operationRef.current += 1;
		if (permissionRequestRef.current)
			permissionRequestRef.current.canceledGeneration = operationRef.current;
		const recording =
			activeDictationOwner === owner && sessionRef.current !== undefined;
		if (activeDictationOwner === owner) activeDictationOwner = undefined;
		sessionRef.current = undefined;
		setState("idle");
		setError(undefined);
		setNotice(undefined);
		if (recording)
			void waitForNativeEnd(true).catch((cause) => {
				setState("error");
				setError(
					cause instanceof Error
						? cause.message
						: "Voice input could not stop. Close and reopen the app.",
				);
			});
	}, [clearFinalTranscriptTimer, owner]);
	owner.cancel = cancel;

	useSpeechRecognitionEvent("start", () => {
		if (activeDictationOwner === owner && sessionRef.current)
			setState("listening");
	});
	useSpeechRecognitionEvent("result", (event) => {
		if (activeDictationOwner !== owner) return;
		const session = sessionRef.current;
		const transcript = event.results[0]?.transcript;
		if (!session || !transcript) return;
		const applied = applyDictationResult(session, valueRef.current, transcript);
		if (!applied) {
			clearFinalTranscriptTimer();
			sessionRef.current = undefined;
			activeDictationOwner = undefined;
			void waitForNativeEnd(true);
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
		if (activeDictationOwner !== owner || !sessionRef.current) return;
		clearFinalTranscriptTimer();
		sessionRef.current = undefined;
		activeDictationOwner = undefined;
		setState("idle");
	});
	useSpeechRecognitionEvent("error", (event) => {
		// Native events are shared by every mounted composer, including hidden routes.
		if (activeDictationOwner !== owner || !sessionRef.current) return;
		clearFinalTranscriptTimer();
		sessionRef.current = undefined;
		activeDictationOwner = undefined;
		void waitForNativeEnd(false);
		setState("error");
		setError(voiceErrorMessage(event.error, event.message));
	});

	useEffect(() => {
		mountedRef.current = true;
		const offBlur = navigation?.addListener("blur", cancel);
		const subscription = AppState.addEventListener("change", (next) => {
			// iOS permission prompts report inactive: only actual backgrounding
			// cancels their pending permission work.
			if (next === "background") cancel();
		});
		return () => {
			mountedRef.current = false;
			offBlur?.();
			subscription.remove();
			cancel();
		};
	}, [cancel, navigation]);

	const start = useCallback(async () => {
		if (
			navigation?.isFocused() === false ||
			AppState.currentState === "background" ||
			activeDictationOwner === owner
		)
			return;
		activeDictationOwner?.cancel();
		activeDictationOwner = owner;
		const request = {
			revision: ++dictationRequestRevision,
			canceledGeneration: undefined as number | undefined,
		};
		setError(undefined);
		setNotice(undefined);
		setState("requesting");
		const operation = ++operationRef.current;
		try {
			if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
				throw new Error("Voice input is not available on this device.");
			}
			let permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
			if (operation !== operationRef.current || activeDictationOwner !== owner)
				return;
			if (!permission.granted && permission.canAskAgain) {
				permissionRequestRef.current = request;
				permission =
					await ExpoSpeechRecognitionModule.requestPermissionsAsync();
				const latestRequest = permissionRequestRef.current === request;
				if (latestRequest) permissionRequestRef.current = undefined;
				if (
					operation !== operationRef.current ||
					activeDictationOwner !== owner
				) {
					// Android's permission Activity can emit background, just like a real
					// app departure. Never revive canceled recording intent. Only explain
					// its result when the same visible composer still owns that request.
					if (
						latestRequest &&
						request.canceledGeneration === operationRef.current &&
						request.revision === dictationRequestRevision &&
						mountedRef.current &&
						navigation?.isFocused() !== false &&
						AppState.currentState === "active" &&
						activeDictationOwner === undefined
					) {
						if (permission.granted) {
							setState("idle");
							setNotice(
								"Microphone enabled. Tap the microphone again to dictate.",
							);
						} else {
							setState("error");
							setError(
								permission.canAskAgain
									? "Microphone and speech recognition permission are required."
									: "Enable microphone and speech recognition access in Settings.",
							);
						}
					}
					return;
				}
			}
			if (!permission.granted) {
				throw new Error(
					permission.canAskAgain
						? "Microphone and speech recognition permission are required."
						: "Enable microphone and speech recognition access in Settings.",
				);
			}

			const barrier = nativeEndBarrier;
			if (barrier) {
				try {
					await barrier.promise;
				} catch (cause) {
					if (
						operation !== operationRef.current ||
						activeDictationOwner !== owner
					)
						return;
					if (nativeEndBarrier !== barrier || !barrier.recoverAfterError)
						throw cause;
					await barrier.recoverAfterError();
				}
			}
			if (operation !== operationRef.current || activeDictationOwner !== owner)
				return;
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
			if (permissionRequestRef.current === request)
				permissionRequestRef.current = undefined;
			if (operation !== operationRef.current || activeDictationOwner !== owner)
				return;
			sessionRef.current = undefined;
			activeDictationOwner = undefined;
			setState("error");
			setError(
				cause instanceof Error ? cause.message : "Voice input could not start.",
			);
		}
	}, [navigation, owner]);

	const stop = useCallback(() => {
		if (activeDictationOwner !== owner || !sessionRef.current) return;
		// Repeated Stop presses must not extend a stuck service's deadline.
		if (finalTranscriptTimer.current !== undefined) return;
		setState("transcribing");
		const operation = operationRef.current;
		finalTranscriptTimer.current = setTimeout(() => {
			finalTranscriptTimer.current = undefined;
			if (
				operation !== operationRef.current ||
				activeDictationOwner !== owner ||
				!sessionRef.current
			)
				return;
			sessionRef.current = undefined;
			activeDictationOwner = undefined;
			setState("error");
			setError(
				"Voice input took too long to finish. Your draft is preserved. Try again.",
			);
			void waitForNativeEnd(true).catch((cause) => {
				if (operation !== operationRef.current) return;
				setError(
					cause instanceof Error
						? cause.message
						: "Voice input could not stop. Close and reopen the app.",
				);
			});
		}, FINAL_TRANSCRIPTION_GRACE_MS);
		try {
			ExpoSpeechRecognitionModule.stop();
		} catch (cause) {
			clearFinalTranscriptTimer();
			sessionRef.current = undefined;
			setState("error");
			setError(
				cause instanceof Error ? cause.message : "Voice input could not stop.",
			);
			activeDictationOwner = undefined;
			void waitForNativeEnd(true);
		}
	}, [clearFinalTranscriptTimer, owner]);

	return {
		state,
		active:
			state === "requesting" ||
			state === "listening" ||
			state === "transcribing",
		...(error ? { error } : {}),
		...(notice ? { notice } : {}),
		start,
		stop,
	};
}

export function VoiceInputFeedback({
	voice,
}: {
	voice: Pick<UseVoiceDictation, "active" | "error" | "notice" | "state">;
}) {
	if (!voice.active && !voice.error && !voice.notice) return null;
	return (
		<Text
			variant="small"
			tone={voice.error ? "danger" : "muted"}
			accessibilityLiveRegion="polite"
		>
			{voice.error ??
				voice.notice ??
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
