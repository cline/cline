"use client";

import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { StreamingSpeechSession } from "@/lib/vercel-streaming-transcription";

interface SpeechRecognition extends EventTarget {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start(): void;
	stop(): void;
}

interface SpeechRecognitionEvent extends Event {
	results: SpeechRecognitionResultList;
	resultIndex: number;
}

interface SpeechRecognitionResultList {
	readonly length: number;
	[index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
	readonly length: number;
	[index: number]: SpeechRecognitionAlternative;
	isFinal: boolean;
}

interface SpeechRecognitionAlternative {
	transcript: string;
	confidence: number;
}

declare global {
	interface Window {
		SpeechRecognition: new () => SpeechRecognition;
		webkitSpeechRecognition: new () => SpeechRecognition;
	}
}

export type SpeechInputMode =
	| "speech-recognition"
	| "media-recorder"
	| "streaming"
	| "none";

export type SpeechTranscriptionSource = Extract<
	SpeechInputMode,
	"speech-recognition" | "media-recorder"
>;

export type SpeechInputProps = Omit<
	ComponentProps<typeof Button>,
	"onError"
> & {
	allowUnavailableClick?: boolean;
	onTranscriptionChange?: (
		text: string,
		source: SpeechTranscriptionSource,
	) => void;
	onAudioRecorded?: (audioBlob: Blob) => Promise<string>;
	onStartStreaming?: () => Promise<StreamingSpeechSession>;
	onStreamingStart?: () => void;
	onStreamingEnd?: () => void;
	onActiveChange?: (active: boolean) => void;
	onProcessingChange?: (processing: boolean) => void;
	onError?: (error: unknown) => void;
	lang?: string;
	recordingMode?: "auto" | "media-recorder" | "streaming";
};

function detectSpeechInputMode(
	recordingMode: NonNullable<SpeechInputProps["recordingMode"]>,
): SpeechInputMode {
	if (typeof window === "undefined") return "none";
	if (recordingMode === "streaming") {
		return typeof navigator !== "undefined" &&
			"WebSocket" in window &&
			"AudioContext" in window &&
			"mediaDevices" in navigator
			? "streaming"
			: "none";
	}
	if (recordingMode === "media-recorder") {
		return typeof navigator !== "undefined" &&
			"MediaRecorder" in window &&
			"mediaDevices" in navigator
			? "media-recorder"
			: "none";
	}
	if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
		return "speech-recognition";
	}
	if (
		typeof navigator !== "undefined" &&
		"MediaRecorder" in window &&
		"mediaDevices" in navigator
	) {
		return "media-recorder";
	}
	return "none";
}

export function SpeechInput({
	allowUnavailableClick = false,
	className,
	disabled,
	lang = "en-US",
	onAudioRecorded,
	onActiveChange,
	onClick,
	onError,
	onProcessingChange,
	onStartStreaming,
	onStreamingEnd,
	onStreamingStart,
	onTranscriptionChange,
	recordingMode = "auto",
	title,
	...props
}: SpeechInputProps) {
	const [mode] = useState<SpeechInputMode>(() =>
		detectSpeechInputMode(recordingMode),
	);
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [isRecognitionReady, setIsRecognitionReady] = useState(false);
	const recognitionRef = useRef<SpeechRecognition | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamingSessionRef = useRef<StreamingSpeechSession | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const mountedRef = useRef(true);
	const operationIdRef = useRef(0);
	const onAudioRecordedRef = useRef(onAudioRecorded);
	const onErrorRef = useRef(onError);
	const onStartStreamingRef = useRef(onStartStreaming);
	const onStreamingEndRef = useRef(onStreamingEnd);
	const onStreamingStartRef = useRef(onStreamingStart);
	const onTranscriptionChangeRef = useRef(onTranscriptionChange);

	onAudioRecordedRef.current = onAudioRecorded;
	onErrorRef.current = onError;
	onStartStreamingRef.current = onStartStreaming;
	onStreamingEndRef.current = onStreamingEnd;
	onStreamingStartRef.current = onStreamingStart;
	onTranscriptionChangeRef.current = onTranscriptionChange;

	useEffect(() => {
		onActiveChange?.(isListening || isProcessing);
	}, [isListening, isProcessing, onActiveChange]);

	useEffect(() => {
		onProcessingChange?.(isProcessing);
	}, [isProcessing, onProcessingChange]);

	useEffect(() => {
		if (mode !== "speech-recognition") return;

		const Recognition =
			window.SpeechRecognition || window.webkitSpeechRecognition;
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = lang;

		const handleStart = () => setIsListening(true);
		const handleEnd = () => setIsListening(false);
		const handleResult = (event: Event) => {
			const speechEvent = event as SpeechRecognitionEvent;
			let transcript = "";
			for (
				let index = speechEvent.resultIndex;
				index < speechEvent.results.length;
				index += 1
			) {
				const result = speechEvent.results[index];
				if (result?.isFinal) {
					transcript += result[0]?.transcript ?? "";
				}
			}
			if (transcript.trim()) {
				onTranscriptionChangeRef.current?.(transcript, "speech-recognition");
			}
		};
		const handleError = (event: Event) => {
			setIsListening(false);
			onErrorRef.current?.(event);
		};

		recognition.addEventListener("start", handleStart);
		recognition.addEventListener("end", handleEnd);
		recognition.addEventListener("result", handleResult);
		recognition.addEventListener("error", handleError);
		recognitionRef.current = recognition;
		setIsRecognitionReady(true);

		return () => {
			recognition.removeEventListener("start", handleStart);
			recognition.removeEventListener("end", handleEnd);
			recognition.removeEventListener("result", handleResult);
			recognition.removeEventListener("error", handleError);
			recognition.stop();
			recognitionRef.current = null;
			setIsRecognitionReady(false);
		};
	}, [lang, mode]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			operationIdRef.current += 1;
			streamingSessionRef.current?.cancel();
			streamingSessionRef.current = null;
			if (mediaRecorderRef.current?.state === "recording") {
				mediaRecorderRef.current.stop();
			}
			for (const track of streamRef.current?.getTracks() ?? []) {
				track.stop();
			}
		};
	}, []);

	const startStreaming = useCallback(async () => {
		if (!onStartStreamingRef.current) return;
		const operationId = ++operationIdRef.current;
		setIsProcessing(true);
		try {
			onStreamingStartRef.current?.();
			const session = await onStartStreamingRef.current();
			if (!mountedRef.current || operationId !== operationIdRef.current) {
				session.cancel();
				return;
			}
			streamingSessionRef.current = session;
			setIsListening(true);
			setIsProcessing(false);
			void session.done.then(
				() => {
					if (!mountedRef.current || streamingSessionRef.current !== session) {
						return;
					}
					streamingSessionRef.current = null;
					setIsListening(false);
					setIsProcessing(false);
					onStreamingEndRef.current?.();
				},
				(error) => {
					if (!mountedRef.current || streamingSessionRef.current !== session) {
						return;
					}
					streamingSessionRef.current = null;
					setIsListening(false);
					setIsProcessing(false);
					onStreamingEndRef.current?.();
					onErrorRef.current?.(error);
				},
			);
		} catch (error) {
			if (!mountedRef.current || operationId !== operationIdRef.current) {
				return;
			}
			setIsListening(false);
			setIsProcessing(false);
			onStreamingEndRef.current?.();
			onErrorRef.current?.(error);
		}
	}, []);

	const startMediaRecorder = useCallback(async () => {
		if (!onAudioRecordedRef.current) return;
		const operationId = ++operationIdRef.current;
		setIsProcessing(true);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			if (!mountedRef.current || operationId !== operationIdRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			const recorder = new MediaRecorder(stream);
			streamRef.current = stream;
			mediaRecorderRef.current = recorder;
			audioChunksRef.current = [];

			recorder.addEventListener("dataavailable", (event) => {
				if (event.data.size > 0) audioChunksRef.current.push(event.data);
			});
			recorder.addEventListener("error", (event) => {
				if (!mountedRef.current || operationId !== operationIdRef.current) {
					return;
				}
				setIsListening(false);
				setIsProcessing(false);
				operationIdRef.current += 1;
				for (const track of stream.getTracks()) track.stop();
				streamRef.current = null;
				mediaRecorderRef.current = null;
				onErrorRef.current?.(event);
			});
			recorder.addEventListener("stop", async () => {
				for (const track of stream.getTracks()) track.stop();
				streamRef.current = null;
				mediaRecorderRef.current = null;
				if (!mountedRef.current || operationId !== operationIdRef.current) {
					return;
				}
				setIsListening(false);
				const audioBlob = new Blob(audioChunksRef.current, {
					type: recorder.mimeType || "audio/webm",
				});
				audioChunksRef.current = [];
				if (audioBlob.size === 0 || !onAudioRecordedRef.current) {
					setIsProcessing(false);
					return;
				}

				setIsProcessing(true);
				try {
					const transcript = await onAudioRecordedRef.current(audioBlob);
					if (!mountedRef.current || operationId !== operationIdRef.current) {
						return;
					}
					if (transcript.trim()) {
						onTranscriptionChangeRef.current?.(transcript, "media-recorder");
					}
				} catch (error) {
					if (mountedRef.current && operationId === operationIdRef.current) {
						onErrorRef.current?.(error);
					}
				} finally {
					if (mountedRef.current && operationId === operationIdRef.current) {
						setIsProcessing(false);
					}
				}
			});

			recorder.start();
			setIsListening(true);
			setIsProcessing(false);
		} catch (error) {
			if (!mountedRef.current || operationId !== operationIdRef.current) {
				return;
			}
			setIsListening(false);
			setIsProcessing(false);
			onErrorRef.current?.(error);
		}
	}, []);

	const toggleListening = useCallback(() => {
		if (mode === "speech-recognition" && recognitionRef.current) {
			if (isListening) recognitionRef.current.stop();
			else recognitionRef.current.start();
			return;
		}
		if (mode === "media-recorder") {
			if (isListening) {
				const recorder = mediaRecorderRef.current;
				if (!recorder) return;
				// Keep the recording operation active while MediaRecorder schedules its
				// stop event and the completed audio is transcribed. Without this state
				// transition, consumers briefly observe an inactive session and may
				// discard the draft range needed by the asynchronous result.
				setIsProcessing(true);
				try {
					recorder.stop();
				} catch (error) {
					operationIdRef.current += 1;
					for (const track of streamRef.current?.getTracks() ?? [])
						track.stop();
					streamRef.current = null;
					mediaRecorderRef.current = null;
					setIsListening(false);
					setIsProcessing(false);
					onErrorRef.current?.(error);
				}
			} else {
				void startMediaRecorder();
			}
			return;
		}
		if (mode === "streaming") {
			if (isListening) {
				setIsListening(false);
				setIsProcessing(true);
				streamingSessionRef.current?.stop();
			} else {
				void startStreaming();
			}
		}
	}, [isListening, mode, startMediaRecorder, startStreaming]);

	const unavailable =
		mode === "none" ||
		(mode === "speech-recognition" && !isRecognitionReady) ||
		(mode === "media-recorder" && !onAudioRecorded) ||
		(mode === "streaming" && !onStartStreaming);

	return (
		<div className="relative inline-flex items-center justify-center">
			{isListening ? (
				<div className="absolute inset-0 animate-ping rounded-full border-2 border-destructive/40" />
			) : null}
			<Button
				{...props}
				aria-label={isListening ? "Stop recording" : "Record speech"}
				aria-pressed={isListening}
				className={cn(
					"group relative z-10 size-7 rounded-md p-1.5 transition-colors",
					isListening
						? "bg-destructive text-white hover:bg-destructive/80"
						: "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
					className,
				)}
				disabled={
					disabled || (unavailable && !allowUnavailableClick) || isProcessing
				}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented) toggleListening();
				}}
				title={
					isListening
						? "Stop recording"
						: (title ??
							(unavailable
								? "Speech input is not supported in this browser"
								: "Record speech"))
				}
				type="button"
			>
				{isProcessing ? (
					<Spinner className="size-4" />
				) : isListening ? (
					<span className="relative size-4">
						<MicIcon className="absolute inset-0 size-4 animate-pulse transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
						<SquareIcon className="absolute inset-0 m-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
					</span>
				) : (
					<MicIcon className="size-4" />
				)}
			</Button>
		</div>
	);
}
