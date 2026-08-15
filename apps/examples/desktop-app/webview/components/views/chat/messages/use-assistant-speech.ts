"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { desktopClient, writeDesktopDebugLog } from "@/lib/desktop-client";
import {
	loadProviderModelCatalog,
	MODE_SETTINGS_CHANGED_EVENT,
	type SpeechGenerationModelTarget,
} from "@/lib/provider-model-catalog";
import type { AssistantSpeechPhase } from "./message-bubble";

type AssistantSpeechState = {
	messageId: string;
	phase: AssistantSpeechPhase;
};

export function useAssistantSpeech({
	sessionId,
	onOpenVoiceOutputSettings,
}: {
	sessionId: string | null;
	onOpenVoiceOutputSettings?: () => void;
}) {
	const [target, setTarget] = useState<SpeechGenerationModelTarget | null>(
		null,
	);
	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [state, setState] = useState<AssistantSpeechState | null>(null);
	const activeAudioRef = useRef<HTMLAudioElement | null>(null);
	const activeAudioUrlRef = useRef<string | null>(null);
	const requestIdRef = useRef(0);
	const sessionIdRef = useRef(sessionId);

	useEffect(() => {
		let cancelled = false;
		let loadId = 0;
		const loadVoiceOutput = () => {
			const currentLoadId = ++loadId;
			setSettingsLoaded(false);
			void loadProviderModelCatalog()
				.then((catalog) => {
					if (!cancelled && currentLoadId === loadId) {
						setTarget(catalog.modes.voiceOutput);
						setSettingsLoaded(true);
					}
				})
				.catch(() => {
					if (!cancelled && currentLoadId === loadId) {
						setTarget(null);
						setSettingsLoaded(true);
					}
				});
		};
		const handleModeSettingsChanged = (event: Event) => {
			const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
			if (!mode || mode === "voiceOutput") loadVoiceOutput();
		};

		loadVoiceOutput();
		window.addEventListener(
			MODE_SETTINGS_CHANGED_EVENT,
			handleModeSettingsChanged,
		);
		return () => {
			cancelled = true;
			loadId += 1;
			window.removeEventListener(
				MODE_SETTINGS_CHANGED_EVENT,
				handleModeSettingsChanged,
			);
		};
	}, []);

	const stop = useCallback(() => {
		requestIdRef.current += 1;
		const audio = activeAudioRef.current;
		if (audio) {
			audio.pause();
			audio.removeAttribute("src");
			activeAudioRef.current = null;
		}
		const audioUrl = activeAudioUrlRef.current;
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			activeAudioUrlRef.current = null;
		}
		setState(null);
	}, []);

	useEffect(() => {
		if (sessionIdRef.current !== sessionId) {
			sessionIdRef.current = sessionId;
			stop();
		}
	}, [sessionId, stop]);

	useEffect(() => stop, [stop]);

	const speak = useCallback(
		async (messageId: string, content: string) => {
			if (state?.messageId === messageId) {
				stop();
				return;
			}
			if (!target) {
				onOpenVoiceOutputSettings?.();
				return;
			}
			const text = content.trim();
			if (!text) return;

			stop();
			const requestId = requestIdRef.current;
			setState({ messageId, phase: "generating" });
			writeDesktopDebugLog({
				scope: "voice-output",
				level: "debug",
				message: "Assistant message requested generated speech",
				timestamp: new Date().toISOString(),
				metadata: {
					messageId,
					providerId: target.providerId,
					modelId: target.modelId,
					textCharacters: text.length,
				},
			});

			try {
				const result = await desktopClient.invoke<{
					audioBase64?: string;
					mediaType?: string;
				}>("synthesize_speech", { text });
				if (requestIdRef.current !== requestId) return;
				if (!result.audioBase64) {
					throw new Error("The speech provider returned no audio");
				}

				const mediaType = result.mediaType?.trim() || "audio/mpeg";
				const audioUrl = URL.createObjectURL(
					base64ToAudioBlob(result.audioBase64, mediaType),
				);
				const audio = new Audio(audioUrl);
				activeAudioRef.current = audio;
				activeAudioUrlRef.current = audioUrl;
				let released = false;
				const release = () => {
					if (released) return;
					released = true;
					if (activeAudioRef.current === audio) activeAudioRef.current = null;
					if (activeAudioUrlRef.current === audioUrl) {
						URL.revokeObjectURL(audioUrl);
						activeAudioUrlRef.current = null;
					}
					if (requestIdRef.current === requestId) {
						setState((current) =>
							current?.messageId === messageId ? null : current,
						);
					}
				};
				audio.addEventListener("ended", release, { once: true });
				audio.addEventListener("error", release, { once: true });
				setState({ messageId, phase: "playing" });
				await audio.play();
			} catch (error) {
				if (requestIdRef.current !== requestId) return;
				stop();
				const message = error instanceof Error ? error.message : String(error);
				writeDesktopDebugLog({
					scope: "voice-output",
					level: "error",
					message: "Assistant message voice playback failed in the webview",
					timestamp: new Date().toISOString(),
					metadata: { failure: message, messageId },
				});
				toast({
					variant: "destructive",
					title: "Voice playback failed",
					description: message,
				});
			}
		},
		[onOpenVoiceOutputSettings, state?.messageId, stop, target],
	);

	return { settingsLoaded, speak, state, target };
}

function base64ToAudioBlob(audioBase64: string, mediaType: string): Blob {
	const binary = window.atob(audioBase64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes.buffer], { type: mediaType });
}
