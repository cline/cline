"use client";

import { createGateway } from "@ai-sdk/gateway";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_useRealtime as useRealtime } from "@ai-sdk/react";
import { REALTIME_CLINE_AGENT_INSTRUCTIONS } from "@cline/shared/browser";
import type {
	Experimental_RealtimeClientEvent,
	Experimental_RealtimeModel,
	Experimental_RealtimeServerEvent,
	Experimental_RealtimeSessionConfig,
} from "ai";
import {
	AudioWaveform,
	CircleStop,
	Minus,
	Settings2,
	Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedOrb } from "@/components/animated-orb";
import type { RealtimeChatBridge } from "@/components/realtime-voice-bridge";
import { toast } from "@/hooks/use-toast";
import {
	resolveDesktopBackendHttpEndpoint,
	writeDesktopDebugLog,
} from "@/lib/desktop-client";
import type { RealtimeVoiceModelTarget } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";

const REALTIME_VOICE_TRANSPORT_INSTRUCTIONS = [
	"You are the speech transport for the Cline coding agent.",
	"Never answer the user or call tools on your own.",
	"User speech is transcribed and sent to Cline, which owns conversation context, tools, approvals, and persistence.",
	"Only speak when response instructions explicitly provide a completed Cline response to read aloud.",
	"Read that supplied response faithfully without adding analysis, answers, or claims of your own.",
].join(" ");

const BUSY_STATUSES = new Set(["starting", "running", "stopping"]);
const BRIDGE_READY_POLL_MS = 125;
const GOOGLE_RESPONSE_SETTLE_TIMEOUT_MS = 5_000;

type VoiceTranscriptEntry = {
	id: string;
	role: "user" | "assistant" | "error";
	text: string;
};

type RealtimeTurnToolState = {
	itemId: string | null;
	toolCallId: string | null;
};

type RealtimeMicrophone = {
	deviceId: string | null;
	label: string;
	state: "ready" | "live" | "muted" | "ended";
};

function createBrowserRealtimeModel(
	providerId: string,
	modelId: string,
): Experimental_RealtimeModel {
	if (providerId === "vercel-ai-gateway") {
		return createGateway().experimental_realtime(modelId);
	}
	if (providerId === "gemini") {
		return createGoogle().experimental_realtime(modelId);
	}
	return createOpenAI().experimental_realtime(modelId);
}

function createSessionConfig(
	voice: string | undefined,
	supportsTools: boolean,
): Experimental_RealtimeSessionConfig {
	return {
		instructions: supportsTools
			? REALTIME_CLINE_AGENT_INSTRUCTIONS
			: REALTIME_VOICE_TRANSPORT_INSTRUCTIONS,
		outputModalities: ["audio"],
		inputAudioTranscription: {},
		outputAudioTranscription: {},
		...(voice?.trim() ? { voice: voice.trim() } : {}),
		turnDetection: {
			type: "server-vad",
			prefixPaddingMs: 300,
			silenceDurationMs: 650,
		},
	};
}

function eventMetadata(event: Experimental_RealtimeServerEvent) {
	const metadata: Record<string, unknown> = { eventType: event.type };
	if ("responseId" in event) metadata.responseId = event.responseId;
	if ("itemId" in event) metadata.itemId = event.itemId;
	if (event.type === "input-transcription-completed") {
		metadata.transcriptLength = event.transcript.length;
	}
	if (event.type === "response-done") metadata.status = event.status;
	if (event.type === "error") {
		metadata.code = event.code;
		metadata.failure = event.message;
	}
	return metadata;
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function getRealtimeToolRequest(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const request = Reflect.get(args, "request");
	return typeof request === "string" ? request.trim() : "";
}

function isBenignCancellationFailure(error: Error | string): boolean {
	const message = (
		typeof error === "string" ? error : error.message
	).toLowerCase();
	return (
		message.includes("cancellation failed") &&
		message.includes("no active response")
	);
}

function ConfiguredRealtimeVoiceOverlay({
	bridge,
	onConfigure,
	onOpenChange,
	target,
}: {
	bridge: RealtimeChatBridge | null;
	onConfigure: () => void;
	onOpenChange: (open: boolean) => void;
	target: RealtimeVoiceModelTarget;
}) {
	const { modelId, modelName, providerId, providerName, supportsTools, voice } =
		target;
	const [tokenEndpoint, setTokenEndpoint] = useState("");
	const [starting, setStarting] = useState(false);
	const [panelVisible, setPanelVisible] = useState(false);
	const [processingTurn, setProcessingTurn] = useState(false);
	const [queuedTurnCount, setQueuedTurnCount] = useState(0);
	const [lastError, setLastError] = useState<string | null>(null);
	const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
	const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
	const [microphone, setMicrophone] = useState<RealtimeMicrophone | null>(null);
	const [microphoneMuted, setMicrophoneMuted] = useState(false);
	const [hearingSpeech, setHearingSpeech] = useState(false);
	const [voiceIntensity, setVoiceIntensity] = useState(0);
	const streamRef = useRef<MediaStream | null>(null);
	const voiceMeterContextRef = useRef<AudioContext | null>(null);
	const voiceMeterFrameRef = useRef<number | null>(null);
	const captureStartedRef = useRef(false);
	const microphoneMutedRef = useRef(false);
	const speechInProgressRef = useRef(false);
	const activeSpeechItemRef = useRef<string | null>(null);
	const discardedVoiceItemsRef = useRef(new Set<string>());
	const voiceActiveRef = useRef(false);
	const failedRef = useRef(false);
	const playbackActiveRef = useRef(false);
	const readyCueRequestedRef = useRef(false);
	const previousStatusRef = useRef<string | null>(null);
	const autoStartAttemptedRef = useRef(false);
	const handledTranscriptItemsRef = useRef(new Set<string>());
	const latestUserTranscriptRef = useRef("");
	const realtimeTurnToolStateRef = useRef<RealtimeTurnToolState>({
		itemId: null,
		toolCallId: null,
	});
	const intendedResponseCountRef = useRef(0);
	const googlePlaybackAllowedRef = useRef(false);
	const googleResponseInProgressRef = useRef(false);
	const turnQueueRef = useRef<Array<{ id: string; text: string }>>([]);
	const processingQueueRef = useRef(false);
	const realtimeToolChainRef = useRef<Promise<void>>(Promise.resolve());
	const mountedRef = useRef(true);
	const bridgeRef = useRef(bridge);
	bridgeRef.current = bridge;
	const actionsRef = useRef<{
		cancelResponse: () => void;
		disconnect: () => void;
		sendEvent: (event: Experimental_RealtimeClientEvent) => void;
		startAudioCapture: (stream: MediaStream) => void;
		stopAudioCapture: () => void;
		stopPlayback: () => void;
	}>({
		cancelResponse: () => {},
		disconnect: () => {},
		sendEvent: () => {},
		startAudioCapture: () => {},
		stopAudioCapture: () => {},
		stopPlayback: () => {},
	});
	const processTurnQueueRef = useRef<() => Promise<void>>(async () => {});
	const model = useMemo(
		() => createBrowserRealtimeModel(providerId, modelId),
		[modelId, providerId],
	);
	const sessionConfig = useMemo(
		() => createSessionConfig(voice, supportsTools),
		[supportsTools, voice],
	);

	const appendTranscript = useCallback((entry: VoiceTranscriptEntry) => {
		setTranscript((current) => [
			...current.filter((candidate) => candidate.id !== entry.id).slice(-7),
			entry,
		]);
	}, []);

	const latestTranscriptMessage = transcript.at(-1);
	useEffect(() => {
		if (!latestTranscriptMessage) return;
		const viewport = transcriptViewportRef.current;
		if (!viewport) return;
		viewport.scrollTop = viewport.scrollHeight;
	}, [latestTranscriptMessage]);

	const stopVoiceMeter = useCallback(() => {
		if (voiceMeterFrameRef.current !== null) {
			window.cancelAnimationFrame(voiceMeterFrameRef.current);
			voiceMeterFrameRef.current = null;
		}
		const context = voiceMeterContextRef.current;
		voiceMeterContextRef.current = null;
		if (context && context.state !== "closed") void context.close();
		if (mountedRef.current) setVoiceIntensity(0);
	}, []);

	const startVoiceMeter = useCallback(
		(stream: MediaStream) => {
			stopVoiceMeter();
			if (!("AudioContext" in window)) return;

			const context = new AudioContext();
			const analyser = context.createAnalyser();
			analyser.fftSize = 256;
			analyser.smoothingTimeConstant = 0.72;
			context.createMediaStreamSource(stream).connect(analyser);
			voiceMeterContextRef.current = context;
			const samples = new Uint8Array(analyser.fftSize);
			let smoothedIntensity = 0;

			const measure = () => {
				analyser.getByteTimeDomainData(samples);
				let sumOfSquares = 0;
				for (const sample of samples) {
					const amplitude = (sample - 128) / 128;
					sumOfSquares += amplitude * amplitude;
				}
				const rms = Math.sqrt(sumOfSquares / samples.length);
				const measuredIntensity = microphoneMutedRef.current
					? 0
					: Math.min(1, Math.max(0, (rms - 0.015) * 9));
				smoothedIntensity += (measuredIntensity - smoothedIntensity) * 0.3;
				setVoiceIntensity(smoothedIntensity);
				voiceMeterFrameRef.current = window.requestAnimationFrame(measure);
			};

			voiceMeterFrameRef.current = window.requestAnimationFrame(measure);
		},
		[stopVoiceMeter],
	);

	const stopMedia = useCallback(() => {
		captureStartedRef.current = false;
		microphoneMutedRef.current = false;
		speechInProgressRef.current = false;
		activeSpeechItemRef.current = null;
		discardedVoiceItemsRef.current.clear();
		actionsRef.current.stopAudioCapture();
		actionsRef.current.stopPlayback();
		actionsRef.current.disconnect();
		stopVoiceMeter();
		for (const track of streamRef.current?.getTracks() ?? []) {
			track.stop();
		}
		streamRef.current = null;
		if (mountedRef.current) {
			setMicrophoneMuted(false);
			setHearingSpeech(false);
			setMicrophone((current) =>
				current ? { ...current, state: "ended" } : current,
			);
		}
	}, [stopVoiceMeter]);

	const handleError = useCallback(
		(error: Error) => {
			if (failedRef.current) return;
			const failure =
				error.message.trim() ||
				"Realtime provider returned an error without additional details.";
			voiceActiveRef.current = false;
			failedRef.current = true;
			readyCueRequestedRef.current = false;
			stopMedia();
			setStarting(false);
			setLastError(failure);
			writeDesktopDebugLog({
				scope: "realtime-voice",
				level: "error",
				message: "Realtime voice session failed in the webview",
				timestamp: new Date().toISOString(),
				metadata: {
					providerId,
					modelId,
					failure,
				},
			});
			toast({
				variant: "destructive",
				title: "Realtime voice failed",
				description: failure,
			});
			onOpenChange(false);
		},
		[modelId, onOpenChange, providerId, stopMedia],
	);

	const handleProviderError = useCallback(
		(error: Error) => {
			if (isBenignCancellationFailure(error)) return;
			handleError(error);
		},
		[handleError],
	);

	const startMicrophoneCapture = useCallback(() => {
		const stream = streamRef.current;
		if (!voiceActiveRef.current || !stream || captureStartedRef.current) {
			return;
		}
		const track = stream.getAudioTracks()[0];
		if (!track || track.readyState === "ended") {
			handleError(new Error("The selected microphone is no longer available."));
			return;
		}
		captureStartedRef.current = true;
		actionsRef.current.startAudioCapture(stream);
		setMicrophone((current) =>
			current
				? {
						...current,
						state:
							microphoneMutedRef.current || track.muted || !track.enabled
								? "muted"
								: "live",
					}
				: current,
		);
		writeDesktopDebugLog({
			scope: "realtime-voice",
			level: "debug",
			message: "Realtime microphone capture started",
			timestamp: new Date().toISOString(),
			metadata: {
				providerId,
				modelId,
				deviceId: track.getSettings().deviceId ?? null,
				deviceLabel: track.label || "System default microphone",
				enabled: track.enabled,
				muted: track.muted,
				readyState: track.readyState,
			},
		});
	}, [handleError, modelId, providerId]);

	const toggleMicrophoneMute = useCallback(() => {
		const track = streamRef.current?.getAudioTracks()[0];
		if (!track || track.readyState === "ended") return;
		const muted = !microphoneMutedRef.current;
		microphoneMutedRef.current = muted;
		track.enabled = !muted;
		setMicrophoneMuted(muted);
		setHearingSpeech(muted ? false : speechInProgressRef.current);
		setMicrophone((current) =>
			current
				? {
						...current,
						state: muted
							? "muted"
							: track.muted
								? "muted"
								: captureStartedRef.current
									? "live"
									: "ready",
					}
				: current,
		);
		let discardedItemId: string | null = null;
		if (muted && speechInProgressRef.current && activeSpeechItemRef.current) {
			discardedItemId = activeSpeechItemRef.current;
			discardedVoiceItemsRef.current.add(discardedItemId);
		}
		writeDesktopDebugLog({
			scope: "realtime-voice",
			level: "debug",
			message: muted
				? "Realtime microphone muted"
				: "Realtime microphone unmuted",
			timestamp: new Date().toISOString(),
			metadata: {
				providerId,
				modelId,
				deviceId: track.getSettings().deviceId ?? null,
				discardedItemId,
				enabled: track.enabled,
			},
		});
	}, [modelId, providerId]);

	const executeRealtimeToolCall = useCallback(
		async ({
			toolCall,
		}: {
			toolCall: {
				toolCallId: string;
				toolName: string;
				args: unknown;
			};
		}) => {
			if (toolCall.toolName !== "run_cline") {
				const failure = `Unsupported realtime tool "${toolCall.toolName}"`;
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "error",
					message: "Realtime model requested an unsupported tool",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						toolName: toolCall.toolName,
						toolCallId: toolCall.toolCallId,
					},
				});
				return { ok: false, error: failure };
			}

			const currentTurn = realtimeTurnToolStateRef.current;
			if (
				currentTurn.itemId &&
				discardedVoiceItemsRef.current.has(currentTurn.itemId)
			) {
				discardedVoiceItemsRef.current.delete(currentTurn.itemId);
				realtimeTurnToolStateRef.current = {
					...currentTurn,
					toolCallId: toolCall.toolCallId,
				};
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message: "Discarded a realtime tool turn muted by the user",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						itemId: currentTurn.itemId,
						toolCallId: toolCall.toolCallId,
					},
				});
				return { ok: true, discarded: true, response: "" };
			}
			if (currentTurn.toolCallId) {
				const failure =
					"Cline has already processed this voice turn. Do not call run_cline again.";
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "warn",
					message: "Realtime model attempted to delegate one voice turn twice",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						firstToolCallId: currentTurn.toolCallId,
						rejectedToolCallId: toolCall.toolCallId,
					},
				});
				return { ok: false, retryable: false, error: failure };
			}
			realtimeTurnToolStateRef.current = {
				...currentTurn,
				toolCallId: toolCall.toolCallId,
			};

			const request =
				getRealtimeToolRequest(toolCall.args) ||
				latestUserTranscriptRef.current.trim();
			if (!request) {
				return {
					ok: false,
					retryable: false,
					error: "The realtime model did not provide the user's request.",
				};
			}

			setProcessingTurn(true);
			setLastError(null);
			let currentBridge = bridgeRef.current;
			try {
				while (mountedRef.current && playbackActiveRef.current) {
					await delay(BRIDGE_READY_POLL_MS);
				}
				while (
					mountedRef.current &&
					currentBridge &&
					BUSY_STATUSES.has(currentBridge.status)
				) {
					await delay(BRIDGE_READY_POLL_MS);
					currentBridge = bridgeRef.current;
				}
				if (!currentBridge) {
					throw new Error(
						"The active chat session is not ready. Open a chat and try again.",
					);
				}

				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message: "Realtime model delegated the voice turn to Cline",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						chatProviderId: currentBridge.providerId,
						chatModelId: currentBridge.modelId,
						threadId: currentBridge.threadId,
						sessionId: currentBridge.sessionId,
						toolCallId: toolCall.toolCallId,
						requestLength: request.length,
					},
				});
				const completion = await currentBridge.sendPrompt(request);
				if (!completion) {
					throw new Error(
						"Cline did not complete the voice turn. Review the chat for details.",
					);
				}
				if (completion.queued) {
					throw new Error(
						"Cline was already processing another request. Try the voice turn again when it finishes.",
					);
				}
				if (completion.result?.finishReason === "error") {
					const agentFailure =
						completion.result.text?.trim() ||
						"Cline failed to complete the voice turn.";
					throw new Error(
						`Cline agent (${currentBridge.providerId} / ${currentBridge.modelId}) failed: ${agentFailure}`,
					);
				}

				const responseText =
					completion.text?.trim() || "The response is ready in chat.";
				appendTranscript({
					id: `assistant:${toolCall.toolCallId}`,
					role: "assistant",
					text: responseText,
				});
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message:
						"Cline voice tool completed; returning its result to realtime",
					timestamp: new Date().toISOString(),
					metadata: {
						sessionId: completion.sessionId,
						toolCallId: toolCall.toolCallId,
						responseLength: responseText.length,
						toolCallCount: completion.result?.toolCalls?.length ?? 0,
					},
				});
				return {
					ok: true,
					response: responseText,
					sessionId: completion.sessionId,
				};
			} catch (error) {
				const failure = error instanceof Error ? error.message : String(error);
				setLastError(failure);
				appendTranscript({
					id: `error:${toolCall.toolCallId}`,
					role: "error",
					text: failure,
				});
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "error",
					message: "Cline realtime tool call failed",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						chatProviderId: currentBridge?.providerId,
						chatModelId: currentBridge?.modelId,
						toolCallId: toolCall.toolCallId,
						failure,
					},
				});
				return { ok: false, retryable: false, error: failure };
			} finally {
				if (mountedRef.current) setProcessingTurn(false);
			}
		},
		[appendTranscript, modelId, providerId],
	);

	const handleRealtimeToolCall = useCallback(
		(args: Parameters<typeof executeRealtimeToolCall>[0]) => {
			const execution = realtimeToolChainRef.current.then(() =>
				executeRealtimeToolCall(args),
			);
			realtimeToolChainRef.current = execution.then(
				() => undefined,
				() => undefined,
			);
			return execution;
		},
		[executeRealtimeToolCall],
	);

	const handleEvent = useCallback(
		(event: Experimental_RealtimeServerEvent) => {
			if (failedRef.current) return;
			if (event.type === "speech-started") {
				const itemId = event.itemId ?? null;
				if (
					supportsTools &&
					itemId !== realtimeTurnToolStateRef.current.itemId
				) {
					realtimeTurnToolStateRef.current = {
						itemId,
						toolCallId: null,
					};
				}
				activeSpeechItemRef.current = itemId;
				speechInProgressRef.current = true;
				if (microphoneMutedRef.current && itemId) {
					discardedVoiceItemsRef.current.add(itemId);
				}
				setHearingSpeech(!microphoneMutedRef.current);
			} else if (
				event.type === "speech-stopped" ||
				event.type === "input-transcription-completed"
			) {
				speechInProgressRef.current = false;
				setHearingSpeech(false);
			}
			if (providerId === "gemini" && !supportsTools) {
				if (event.type === "input-transcription-completed") {
					googlePlaybackAllowedRef.current = false;
					googleResponseInProgressRef.current = true;
				} else if (
					event.type === "audio-delta" ||
					event.type === "text-delta"
				) {
					googleResponseInProgressRef.current = true;
					if (
						event.type === "audio-delta" &&
						!googlePlaybackAllowedRef.current
					) {
						// Gemini Live responds automatically to server-VAD turns and
						// does not implement response-cancel. Keep that parallel
						// response inaudible; only Cline-authored playback is allowed.
						queueMicrotask(() => actionsRef.current.stopPlayback());
					}
				} else if (event.type === "response-done") {
					googlePlaybackAllowedRef.current = false;
					googleResponseInProgressRef.current = false;
				} else if (event.type === "speech-started") {
					googlePlaybackAllowedRef.current = false;
				}
			}
			if (event.type === "response-created") {
				if (intendedResponseCountRef.current > 0) {
					intendedResponseCountRef.current -= 1;
				} else if (!supportsTools) {
					// Server VAD asks the realtime model to answer automatically.
					// Models without tool calling use the transcript bridge, so
					// suppress their parallel provider-authored response.
					actionsRef.current.cancelResponse();
				}
			}
			if (event.type === "input-transcription-completed") {
				const text = event.transcript.trim();
				const discarded = discardedVoiceItemsRef.current.has(event.itemId);
				if (discarded && !supportsTools) {
					discardedVoiceItemsRef.current.delete(event.itemId);
				}
				if (activeSpeechItemRef.current === event.itemId) {
					activeSpeechItemRef.current = null;
				}
				if (discarded) {
					handledTranscriptItemsRef.current.add(event.itemId);
					writeDesktopDebugLog({
						scope: "realtime-voice",
						level: "debug",
						message: "Discarded a voice transcript muted by the user",
						timestamp: new Date().toISOString(),
						metadata: {
							itemId: event.itemId,
							transcriptLength: text.length,
						},
					});
				} else if (
					text &&
					!handledTranscriptItemsRef.current.has(event.itemId)
				) {
					handledTranscriptItemsRef.current.add(event.itemId);
					latestUserTranscriptRef.current = text;
					if (
						supportsTools &&
						event.itemId !== realtimeTurnToolStateRef.current.itemId
					) {
						realtimeTurnToolStateRef.current = {
							itemId: event.itemId,
							toolCallId: null,
						};
					}
					appendTranscript({
						id: `user:${event.itemId}`,
						role: "user",
						text,
					});
					if (!supportsTools) {
						turnQueueRef.current.push({ id: event.itemId, text });
						setQueuedTurnCount(turnQueueRef.current.length);
						writeDesktopDebugLog({
							scope: "realtime-voice",
							level: "debug",
							message: "Queued finalized voice transcript for Cline",
							timestamp: new Date().toISOString(),
							metadata: {
								itemId: event.itemId,
								queueLength: turnQueueRef.current.length,
								transcriptLength: text.length,
							},
						});
						void processTurnQueueRef.current();
					}
				}
			}
			if (
				event.type === "session-created" ||
				event.type === "session-updated" ||
				event.type === "speech-started" ||
				event.type === "speech-stopped" ||
				event.type === "audio-committed" ||
				event.type === "input-transcription-completed" ||
				event.type === "response-created" ||
				event.type === "response-done" ||
				event.type === "error"
			) {
				const benignCancellation =
					event.type === "error" && isBenignCancellationFailure(event.message);
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level:
						event.type === "error" && !benignCancellation ? "error" : "debug",
					message: benignCancellation
						? "Realtime provider reported a harmless cancellation race"
						: "Realtime provider event",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						delivery:
							supportsTools === true
								? "realtime-tool"
								: "cline-transcript-fallback",
						...eventMetadata(event),
					},
				});
			}
			if (event.type === "error") {
				const failure =
					event.message.trim() ||
					event.code?.trim() ||
					"Realtime provider returned an error";
				handleProviderError(new Error(failure));
			}
		},
		[appendTranscript, handleProviderError, modelId, providerId, supportsTools],
	);

	const {
		cancelResponse,
		connect,
		disconnect,
		isCapturing,
		isPlaying,
		sendEvent,
		startAudioCapture,
		status,
		stopAudioCapture,
		stopPlayback,
	} = useRealtime({
		model,
		api: { token: tokenEndpoint || "about:blank" },
		sessionConfig,
		onError: handleProviderError,
		onEvent: handleEvent,
		onToolCall: handleRealtimeToolCall,
	});
	playbackActiveRef.current = isPlaying;
	actionsRef.current = {
		cancelResponse,
		disconnect,
		sendEvent,
		startAudioCapture,
		stopAudioCapture,
		stopPlayback,
	};

	const requestSpeech = useCallback(
		(text: string) => {
			const spokenText = text.trim();
			if (!spokenText) return;
			const instructions = [
				"Read the following Cline response aloud faithfully.",
				"Do not add, remove, answer, or reinterpret anything.",
				"",
				spokenText,
			].join("\n");
			if (providerId === "gemini") {
				// Gemini Live automatically responds to realtimeInput and ignores
				// the normalized response-create event. A text conversation item
				// is therefore the provider-native way to request Cline playback.
				googlePlaybackAllowedRef.current = true;
				googleResponseInProgressRef.current = true;
				actionsRef.current.sendEvent({
					type: "conversation-item-create",
					item: {
						type: "text-message",
						role: "user",
						text: instructions,
					},
				});
				return;
			}
			intendedResponseCountRef.current += 1;
			actionsRef.current.sendEvent({
				type: "response-create",
				options: {
					modalities: ["audio"],
					instructions,
					metadata: { source: "cline-text-agent" },
				},
			});
		},
		[providerId],
	);

	const processTurnQueue = useCallback(async () => {
		if (processingQueueRef.current) return;
		processingQueueRef.current = true;
		try {
			while (mountedRef.current && turnQueueRef.current.length > 0) {
				const turn = turnQueueRef.current.shift();
				setQueuedTurnCount(turnQueueRef.current.length);
				if (!turn) continue;
				setProcessingTurn(true);
				setLastError(null);
				let currentBridge = bridgeRef.current;
				while (mountedRef.current && playbackActiveRef.current) {
					await delay(BRIDGE_READY_POLL_MS);
				}
				while (
					mountedRef.current &&
					currentBridge &&
					BUSY_STATUSES.has(currentBridge.status)
				) {
					await delay(BRIDGE_READY_POLL_MS);
					currentBridge = bridgeRef.current;
				}
				if (!currentBridge) {
					throw new Error(
						"The active chat session is not ready. Open a chat and try again.",
					);
				}
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message: "Sending finalized voice transcript to the Cline agent",
					timestamp: new Date().toISOString(),
					metadata: {
						chatProviderId: currentBridge.providerId,
						chatModelId: currentBridge.modelId,
						threadId: currentBridge.threadId,
						sessionId: currentBridge.sessionId,
						transcriptLength: turn.text.length,
					},
				});
				const completion = await currentBridge.sendPrompt(turn.text);
				if (!completion) {
					throw new Error(
						"Cline did not complete the voice turn. Review the chat for details.",
					);
				}
				if (completion.queued) {
					throw new Error(
						"Cline was already processing another request. Try the voice turn again when it finishes.",
					);
				}
				if (completion.result?.finishReason === "error") {
					const agentFailure =
						completion.result.text?.trim() ||
						"Cline failed to complete the voice turn.";
					throw new Error(
						`Cline agent (${currentBridge.providerId} / ${currentBridge.modelId}) failed: ${agentFailure}`,
					);
				}
				const responseText =
					completion.text?.trim() || "The response is ready in chat.";
				appendTranscript({
					id: `assistant:${turn.id}`,
					role: "assistant",
					text: responseText,
				});
				if (mountedRef.current && voiceActiveRef.current) {
					if (providerId === "gemini") {
						const settleDeadline =
							Date.now() + GOOGLE_RESPONSE_SETTLE_TIMEOUT_MS;
						while (
							mountedRef.current &&
							googleResponseInProgressRef.current &&
							Date.now() < settleDeadline
						) {
							await delay(BRIDGE_READY_POLL_MS);
						}
						actionsRef.current.stopPlayback();
					}
					requestSpeech(responseText);
				}
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message: "Cline voice turn completed and was sent for playback",
					timestamp: new Date().toISOString(),
					metadata: {
						sessionId: completion.sessionId,
						responseLength: responseText.length,
						toolCallCount: completion.result?.toolCalls?.length ?? 0,
					},
				});
			}
		} catch (error) {
			const failure = error instanceof Error ? error.message : String(error);
			turnQueueRef.current = [];
			setQueuedTurnCount(0);
			setLastError(failure);
			appendTranscript({
				id: `error:${Date.now()}`,
				role: "error",
				text: failure,
			});
			writeDesktopDebugLog({
				scope: "realtime-voice",
				level: "error",
				message: "Cline voice turn failed",
				timestamp: new Date().toISOString(),
				metadata: { failure },
			});
		} finally {
			processingQueueRef.current = false;
			if (mountedRef.current) setProcessingTurn(false);
		}
	}, [appendTranscript, providerId, requestSpeech]);
	processTurnQueueRef.current = processTurnQueue;

	useEffect(() => {
		let cancelled = false;
		resolveDesktopBackendHttpEndpoint()
			.then((endpoint) => {
				if (cancelled) return;
				const resolvedTokenEndpoint = `${endpoint}/api/modes/realtime/session`;
				setTokenEndpoint(resolvedTokenEndpoint);
				writeDesktopDebugLog({
					scope: "realtime-voice",
					level: "debug",
					message: "Realtime voice token endpoint resolved",
					timestamp: new Date().toISOString(),
					metadata: {
						providerId,
						modelId,
						endpoint: resolvedTokenEndpoint,
					},
				});
			})
			.catch((error) => {
				if (!cancelled) {
					handleError(
						error instanceof Error ? error : new Error(String(error)),
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [handleError, modelId, providerId]);

	useEffect(() => {
		// React development effect replay and Fast Refresh run the previous
		// cleanup while preserving refs. Restore the guard in every setup so a
		// live overlay never leaves its transcript queue permanently disabled.
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			voiceActiveRef.current = false;
			turnQueueRef.current = [];
			stopMedia();
		};
	}, [stopMedia]);

	const stop = useCallback(() => {
		voiceActiveRef.current = false;
		stopMedia();
		turnQueueRef.current = [];
		realtimeTurnToolStateRef.current = { itemId: null, toolCallId: null };
		setQueuedTurnCount(0);
		failedRef.current = false;
		readyCueRequestedRef.current = false;
		setStarting(false);
		setLastError(null);
		writeDesktopDebugLog({
			scope: "realtime-voice",
			level: "debug",
			message: "Realtime voice session stopped",
			timestamp: new Date().toISOString(),
			metadata: { providerId, modelId },
		});
	}, [modelId, providerId, stopMedia]);

	const start = useCallback(async () => {
		if (!tokenEndpoint || starting) return;
		voiceActiveRef.current = true;
		captureStartedRef.current = false;
		microphoneMutedRef.current = false;
		speechInProgressRef.current = false;
		activeSpeechItemRef.current = null;
		discardedVoiceItemsRef.current.clear();
		realtimeTurnToolStateRef.current = { itemId: null, toolCallId: null };
		setStarting(true);
		setLastError(null);
		setHearingSpeech(false);
		setMicrophoneMuted(false);
		setMicrophone(null);
		failedRef.current = false;
		readyCueRequestedRef.current = false;
		writeDesktopDebugLog({
			scope: "realtime-voice",
			level: "debug",
			message: "Realtime voice start requested",
			timestamp: new Date().toISOString(),
			metadata: { providerId, modelId },
		});
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					autoGainControl: true,
					echoCancellation: true,
					noiseSuppression: true,
				},
			});
			streamRef.current = stream;
			startVoiceMeter(stream);
			const track = stream.getAudioTracks()[0];
			if (!track) {
				throw new Error("No microphone input track was returned.");
			}
			const settings = track.getSettings();
			const microphoneInfo: RealtimeMicrophone = {
				deviceId: settings.deviceId ?? null,
				label: track.label.trim() || "System default microphone",
				state: track.muted ? "muted" : "ready",
			};
			setMicrophone(microphoneInfo);
			track.addEventListener("mute", () => {
				if (!voiceActiveRef.current) return;
				setHearingSpeech(false);
				setMicrophone((current) =>
					current ? { ...current, state: "muted" } : current,
				);
			});
			track.addEventListener("unmute", () => {
				if (!voiceActiveRef.current) return;
				if (microphoneMutedRef.current) return;
				setMicrophone((current) =>
					current ? { ...current, state: "live" } : current,
				);
			});
			track.addEventListener("ended", () => {
				if (!voiceActiveRef.current) return;
				setMicrophone((current) =>
					current ? { ...current, state: "ended" } : current,
				);
				handleError(
					new Error(`Microphone "${microphoneInfo.label}" became unavailable.`),
				);
			});
			writeDesktopDebugLog({
				scope: "realtime-voice",
				level: "debug",
				message: "Realtime microphone acquired",
				timestamp: new Date().toISOString(),
				metadata: {
					providerId,
					modelId,
					deviceId: microphoneInfo.deviceId,
					deviceLabel: microphoneInfo.label,
					enabled: track.enabled,
					muted: track.muted,
					readyState: track.readyState,
					settings,
				},
			});
			await connect();
			if (failedRef.current) {
				for (const track of stream.getTracks()) track.stop();
			}
		} catch (error) {
			handleError(error instanceof Error ? error : new Error(String(error)));
		} finally {
			setStarting(false);
		}
	}, [
		connect,
		handleError,
		modelId,
		providerId,
		startVoiceMeter,
		starting,
		tokenEndpoint,
	]);

	useEffect(() => {
		if (
			tokenEndpoint &&
			status === "disconnected" &&
			!starting &&
			!autoStartAttemptedRef.current
		) {
			autoStartAttemptedRef.current = true;
			void start();
		}
	}, [start, starting, status, tokenEndpoint]);

	useEffect(() => {
		if (previousStatusRef.current === status) return;
		previousStatusRef.current = status;
		writeDesktopDebugLog({
			scope: "realtime-voice",
			level: "debug",
			message: "Realtime voice connection status changed",
			timestamp: new Date().toISOString(),
			metadata: { providerId, modelId, status },
		});
	}, [modelId, providerId, status]);

	useEffect(() => {
		if (status !== "connecting") return;
		const timeoutId = window.setTimeout(() => {
			handleError(
				new Error(
					"Realtime connection timed out. Check the realtime-voice console logs and try again.",
				),
			);
		}, 15_000);
		return () => window.clearTimeout(timeoutId);
	}, [handleError, status]);

	useEffect(() => {
		if (
			status !== "connected" ||
			!voiceActiveRef.current ||
			readyCueRequestedRef.current ||
			failedRef.current
		) {
			return;
		}
		readyCueRequestedRef.current = true;
		startMicrophoneCapture();
	}, [startMicrophoneCapture, status]);

	const active =
		starting ||
		isCapturing ||
		status === "connecting" ||
		status === "connected";
	const pendingApprovalCount = bridge?.pendingToolApprovals.length ?? 0;
	const pendingQuestionCount = bridge?.pendingQuestionCount ?? 0;
	const needsAttention = pendingApprovalCount + pendingQuestionCount > 0;
	const statusLabel =
		lastError !== null
			? "Voice turn failed"
			: needsAttention
				? pendingApprovalCount > 0
					? "Tool approval required"
					: "Cline has a question"
				: processingTurn
					? queuedTurnCount > 0
						? `Cline is working · ${queuedTurnCount} more voice turn${queuedTurnCount === 1 ? "" : "s"} queued`
						: "Cline is working…"
					: queuedTurnCount > 0
						? `Sending ${queuedTurnCount} voice turn${queuedTurnCount === 1 ? "" : "s"} to Cline…`
						: starting || status === "connecting"
							? "Connecting…"
							: isPlaying
								? "Speaking…"
								: hearingSpeech
									? "Hearing you…"
									: status === "connected" && isCapturing
										? "Listening…"
										: status === "connected"
											? "Connected"
											: "Ready";

	return (
		<fieldset
			className="relative m-0 flex shrink-0 items-center gap-1 border-0 p-0"
			onMouseEnter={() => {
				if (active) setPanelVisible(true);
			}}
			onMouseLeave={() => setPanelVisible(false)}
		>
			<div
				aria-hidden={!panelVisible}
				aria-live="polite"
				className={cn(
					"absolute bottom-full right-0 z-70 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl transition-[opacity,visibility] duration-150",
					panelVisible
						? "visible opacity-100"
						: "pointer-events-none invisible opacity-0",
				)}
				inert={!panelVisible ? true : undefined}
			>
				<div className="flex items-start gap-2 border-b border-border px-3 py-3">
					<button
						aria-label="Configure realtime voice"
						className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => {
							stop();
							onOpenChange(false);
							onConfigure();
						}}
						type="button"
					>
						<Settings2 className="size-3.5" />
					</button>
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold" title={modelName}>
							{modelName}
						</div>
						<div className="mt-0.5 truncate text-xs text-muted-foreground">
							{providerName}
						</div>
					</div>
					<button
						aria-label="Hide realtime voice"
						className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setPanelVisible(false)}
						title="Hide realtime voice panel"
						type="button"
					>
						<Minus className="size-3.5" />
					</button>
				</div>
				<div
					aria-label="Realtime voice transcript"
					className="h-32 space-y-2 overflow-y-auto px-3 py-2.5 text-xs"
					onWheel={(event) => event.stopPropagation()}
					ref={transcriptViewportRef}
					role="log"
				>
					{transcript.length > 0 ? (
						transcript.map((message) => (
							<div className="grid gap-0.5" key={message.id}>
								<span
									className={cn(
										"font-medium text-muted-foreground",
										message.role === "error" && "text-destructive",
									)}
								>
									{message.role === "user"
										? "You"
										: message.role === "assistant"
											? "Cline"
											: "Error"}
								</span>
								<p
									className={cn(
										"whitespace-pre-wrap leading-relaxed",
										message.role === "error" && "text-destructive",
									)}
								>
									{message.text}
								</p>
							</div>
						))
					) : (
						<p className="text-muted-foreground">
							{status === "connected"
								? "Speak to the same Cline agent as this chat."
								: "Preparing the secure realtime connection…"}
						</p>
					)}
				</div>
				<div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
					<div className="flex min-w-0 items-center gap-2 text-xs font-medium">
						<div
							className={cn(
								"size-2 shrink-0 rounded-full",
								lastError
									? "bg-destructive"
									: needsAttention
										? "animate-pulse bg-amber-500"
										: isPlaying
											? "animate-pulse bg-primary"
											: status === "connected"
												? "animate-pulse bg-emerald-500"
												: "animate-pulse bg-amber-500",
							)}
						/>
						{isPlaying ? <Volume2 className="size-3.5 shrink-0" /> : null}
						<span className="truncate">{statusLabel}</span>
					</div>
					<div className="ml-auto flex items-center gap-1.5">
						{active && microphone ? (
							<button
								aria-label={
									microphoneMuted
										? "Unmute realtime microphone"
										: "Mute realtime microphone"
								}
								aria-pressed={microphoneMuted}
								className={cn(
									"inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
									microphoneMuted &&
										"border-destructive/40 bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground",
								)}
								onClick={toggleMicrophoneMute}
								title={
									microphoneMuted ? "Unmute microphone" : "Mute microphone"
								}
								type="button"
							>
								{microphoneMuted ? "Unmute" : "Mute"}
							</button>
						) : null}
						<button
							aria-label="Stop realtime voice"
							className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-xs text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
							onClick={() => {
								stop();
								onOpenChange(false);
							}}
							type="button"
						>
							<CircleStop className="size-3.5" />
							Stop
						</button>
					</div>
				</div>
			</div>
			<button
				aria-label={active ? "Realtime voice active" : "Start realtime voice"}
				aria-pressed={active}
				className={cn(
					"group relative flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
					active && "hover:bg-transparent",
					status === "connected" &&
						!isPlaying &&
						"animate-[pulse_1.8s_ease-in-out_infinite]",
				)}
				disabled={!tokenEndpoint}
				onClick={() => {
					if (!active) void start();
				}}
				onFocus={() => {
					if (active) setPanelVisible(true);
				}}
				title={active ? "Realtime voice active" : "Start realtime voice"}
				type="button"
			>
				{active ? (
					<AnimatedOrb
						intensity={Math.max(voiceIntensity, hearingSpeech ? 0.35 : 0)}
					/>
				) : (
					<AudioWaveform className="size-4" />
				)}
				{isPlaying ? (
					<span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full border-2 border-background bg-primary" />
				) : null}
			</button>
		</fieldset>
	);
}

export function RealtimeVoiceOverlay({
	bridge,
	onConfigure,
	onOpenChange,
	open,
	target,
}: {
	bridge: RealtimeChatBridge | null;
	onConfigure: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	target: RealtimeVoiceModelTarget | null;
}) {
	if (!open) {
		return (
			<button
				aria-label={
					target ? "Start realtime voice" : "Configure realtime voice"
				}
				className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onClick={() => {
					if (target) {
						onOpenChange(true);
					} else {
						onConfigure();
					}
				}}
				title={target ? "Realtime voice" : "Configure realtime voice"}
				type="button"
			>
				<AudioWaveform className="size-4" />
			</button>
		);
	}
	if (!target) {
		return (
			<button
				aria-label="Configure realtime voice"
				className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onClick={() => {
					onOpenChange(false);
					onConfigure();
				}}
				title="Configure realtime voice"
				type="button"
			>
				<AudioWaveform className="size-4" />
			</button>
		);
	}
	return (
		<ConfiguredRealtimeVoiceOverlay
			bridge={bridge}
			key={`${target.providerId}:${target.modelId}:${target.voice ?? ""}`}
			onConfigure={onConfigure}
			onOpenChange={onOpenChange}
			target={target}
		/>
	);
}
