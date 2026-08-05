// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeChatBridge } from "./realtime-voice-bridge";
import { RealtimeVoiceOverlay } from "./realtime-voice-overlay";

const mocks = vi.hoisted(() => ({
	cancelResponse: vi.fn(),
	connect: vi.fn(async () => undefined),
	disconnect: vi.fn(),
	getUserMedia: vi.fn(),
	audioTrack: {
		addEventListener: vi.fn(),
		enabled: true,
		getSettings: vi.fn(() => ({ deviceId: "studio-microphone-id" })),
		label: "Studio Microphone",
		muted: false,
		readyState: "live",
		stop: vi.fn(),
	},
	resolveEndpoint: vi.fn(async () => "http://127.0.0.1:3126"),
	sendEvent: vi.fn(),
	speakGreeting: vi.fn(),
	startAudioCapture: vi.fn(),
	stopAudioCapture: vi.fn(),
	stopPlayback: vi.fn(),
	toast: vi.fn(),
	writeLog: vi.fn(),
	onToolCall: undefined as
		| ((args: {
				toolCall: {
					toolCallId: string;
					toolName: string;
					args: unknown;
				};
		  }) => Promise<unknown> | unknown)
		| undefined,
	onEvent: undefined as
		| ((event: {
				type: string;
				itemId?: string;
				responseId?: string;
				transcript?: string;
				code?: string;
				message?: string;
				raw: unknown;
		  }) => void)
		| undefined,
	onError: undefined as ((error: Error) => void) | undefined,
	realtimeState: {
		status: "disconnected",
		isCapturing: false,
		isPlaying: false,
	},
}));

vi.mock("@ai-sdk/gateway", () => ({
	createGateway: () => ({
		experimental_realtime: vi.fn(() => ({ provider: "gateway" })),
	}),
}));
vi.mock("@ai-sdk/google", () => ({
	createGoogle: () => ({
		experimental_realtime: vi.fn(() => ({ provider: "google" })),
	}),
}));
vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: () => ({
		experimental_realtime: vi.fn(() => ({ provider: "openai" })),
	}),
}));
vi.mock("@ai-sdk/react", () => ({
	experimental_useRealtime: (options: {
		onEvent?: typeof mocks.onEvent;
		onError?: typeof mocks.onError;
		onToolCall?: typeof mocks.onToolCall;
	}) => {
		mocks.onEvent = options.onEvent;
		mocks.onError = options.onError;
		mocks.onToolCall = options.onToolCall;
		return {
			...mocks.realtimeState,
			cancelResponse: mocks.cancelResponse,
			connect: mocks.connect,
			disconnect: mocks.disconnect,
			sendEvent: mocks.sendEvent,
			startAudioCapture: mocks.startAudioCapture,
			stopAudioCapture: mocks.stopAudioCapture,
			stopPlayback: mocks.stopPlayback,
		};
	},
}));
vi.mock("@/lib/desktop-client", () => ({
	resolveDesktopBackendHttpEndpoint: mocks.resolveEndpoint,
	writeDesktopDebugLog: mocks.writeLog,
}));
vi.mock("@/hooks/use-toast", () => ({
	toast: mocks.toast,
}));

let container: HTMLDivElement;
let root: Root;

const target = {
	providerId: "vercel-ai-gateway",
	providerName: "Vercel AI Gateway",
	modelId: "xai/grok-voice-think-fast-1.0",
	modelName: "Grok Voice Think Fast",
	supportsTools: true,
};
const geminiTarget = {
	providerId: "gemini",
	providerName: "Google Gemini",
	modelId: "gemini-live",
	modelName: "Gemini Live",
	supportsTools: false,
};
const grokFallbackTarget = {
	...target,
	supportsTools: false,
};

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.clearAllMocks();
	class MockSpeechSynthesisUtterance {
		text: string;
		onend: (() => void) | null = null;
		onerror: ((event: { error: string }) => void) | null = null;

		constructor(text: string) {
			this.text = text;
		}
	}
	Object.assign(globalThis, {
		SpeechSynthesisUtterance: MockSpeechSynthesisUtterance,
	});
	Object.defineProperty(window, "speechSynthesis", {
		configurable: true,
		value: {
			cancel: vi.fn(),
			speak: mocks.speakGreeting,
		},
	});
	mocks.realtimeState.status = "disconnected";
	mocks.realtimeState.isCapturing = false;
	mocks.realtimeState.isPlaying = false;
	mocks.onEvent = undefined;
	mocks.onError = undefined;
	mocks.onToolCall = undefined;
	mocks.audioTrack.enabled = true;
	mocks.audioTrack.muted = false;
	mocks.audioTrack.readyState = "live";
	const stream = {
		getAudioTracks: () => [mocks.audioTrack],
		getTracks: () => [mocks.audioTrack],
	};
	mocks.getUserMedia.mockResolvedValue(stream);
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: { getUserMedia: mocks.getUserMedia },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function makeBridge(
	overrides: Partial<RealtimeChatBridge> = {},
): RealtimeChatBridge {
	return {
		threadId: "thread-1",
		sessionId: "session-1",
		providerId: "openrouter",
		modelId: "minimax/minimax-m3",
		status: "completed",
		hasChatHistory: false,
		pendingToolApprovals: [],
		pendingQuestionCount: 0,
		sendPrompt: vi.fn(async () => ({
			sessionId: "session-1",
			queued: false,
			text: "I found and fixed the issue.",
			result: {
				text: "I found and fixed the issue.",
				finishReason: "completed",
				toolCalls: [{ name: "read_file", output: "ok" }],
			},
		})),
		...overrides,
	};
}

describe("RealtimeVoiceOverlay", () => {
	it("acquires the configured system microphone before connecting", async () => {
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={vi.fn()}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
		expect(container.textContent).toContain(
			"Preparing the secure realtime connection",
		);
		expect(container.textContent).not.toContain("Configuration");
		expect(container.textContent).not.toContain("Studio Microphone");
		expect(mocks.startAudioCapture).not.toHaveBeenCalled();
	});

	it("starts listening silently after the realtime connection is ready", async () => {
		const props = {
			bridge: makeBridge(),
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());

		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		expect(container.textContent).toContain(target.modelName);
		expect(container.textContent).toContain("Listening");
		expect(container.textContent).not.toContain("Agent:");
		expect(mocks.speakGreeting).not.toHaveBeenCalled();
		expect(mocks.sendEvent).not.toHaveBeenCalled();
		expect(props.bridge.sendPrompt).not.toHaveBeenCalled();
		expect(mocks.stopAudioCapture).not.toHaveBeenCalled();
		expect(mocks.startAudioCapture).toHaveBeenCalledOnce();
		const muteButton = container.querySelector(
			'[aria-label="Mute realtime microphone"]',
		);
		expect(muteButton).not.toBeNull();
		expect(muteButton?.querySelector("svg")).toBeNull();
		expect(
			container.querySelector('[aria-label="Realtime voice transcript"]')
				?.className,
		).toContain("h-32");
		expect(
			container.querySelector('[aria-label="Configure realtime voice"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Hide realtime voice"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Stop realtime voice session"]'),
		).toBeNull();
	});

	it("hides the realtime panel without stopping and restores it on hover", async () => {
		const onOpenChange = vi.fn();
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={onOpenChange}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});

		const hideButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Hide realtime voice"]',
		);
		await act(async () => hideButton?.click());
		expect(
			container.querySelector('[aria-label="Realtime voice transcript"]'),
		).toBeNull();
		expect(mocks.disconnect).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();

		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Stop realtime voice"]',
		);
		await act(async () => {
			trigger?.parentElement?.dispatchEvent(
				new MouseEvent("mouseover", { bubbles: true }),
			);
		});
		expect(
			container.querySelector('[aria-label="Realtime voice transcript"]'),
		).not.toBeNull();
	});

	it("starts listening silently when the chat already has history", async () => {
		const props = {
			bridge: makeBridge({ hasChatHistory: true }),
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());

		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		expect(mocks.speakGreeting).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain(
			"Hi! I'm Cline. Your voice session is ready. How can I help you?",
		);
		expect(mocks.startAudioCapture).toHaveBeenCalledOnce();
		expect(container.textContent).not.toContain("Studio Microphone");
		expect(
			container.querySelector('[aria-label="Stop realtime voice"]')?.className,
		).toContain("animate-");
	});

	it("mutes ambient turns without dropping speech completed before mute", async () => {
		const bridge = makeBridge();
		const props = {
			bridge,
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target: grokFallbackTarget,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});
		act(() => {
			mocks.onEvent?.({
				type: "speech-started",
				itemId: "intended-turn",
				raw: {},
			});
			mocks.onEvent?.({
				type: "speech-stopped",
				itemId: "intended-turn",
				raw: {},
			});
		});
		const muteButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Mute realtime microphone"]',
		);
		expect(muteButton).not.toBeNull();
		expect(muteButton?.closest('[aria-live="polite"]')).not.toBeNull();
		act(() => muteButton?.click());
		expect(mocks.audioTrack.enabled).toBe(false);
		expect(container.textContent).toContain("Unmute");
		const transcriptViewport = container.querySelector<HTMLElement>(
			'[aria-label="Realtime voice transcript"]',
		);
		Object.defineProperty(transcriptViewport, "scrollHeight", {
			configurable: true,
			value: 320,
		});

		act(() => {
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "intended-turn",
				transcript: "Investigate the failing test.",
				raw: {},
			});
		});
		await vi.waitFor(() =>
			expect(bridge.sendPrompt).toHaveBeenCalledWith(
				"Investigate the failing test.",
			),
		);
		expect(transcriptViewport?.scrollTop).toBe(320);

		act(() => {
			mocks.onEvent?.({
				type: "speech-started",
				itemId: "ambient-turn",
				raw: {},
			});
			mocks.onEvent?.({
				type: "speech-stopped",
				itemId: "ambient-turn",
				raw: {},
			});
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "ambient-turn",
				transcript: "Background television dialogue.",
				raw: {},
			});
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(bridge.sendPrompt).toHaveBeenCalledOnce();
		expect(container.textContent).not.toContain(
			"Background television dialogue.",
		);

		const unmuteButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Unmute realtime microphone"]',
		);
		act(() => unmuteButton?.click());
		expect(mocks.audioTrack.enabled).toBe(true);
		expect(container.textContent).toContain("Mute");
	});

	it("does not delegate a muted realtime tool turn to Cline", async () => {
		const bridge = makeBridge();
		const props = {
			bridge,
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		act(() => {
			mocks.onEvent?.({
				type: "speech-started",
				itemId: "muted-tool-turn",
				raw: {},
			});
		});
		const muteButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Mute realtime microphone"]',
		);
		act(() => muteButton?.click());
		act(() => {
			mocks.onEvent?.({
				type: "speech-stopped",
				itemId: "muted-tool-turn",
				raw: {},
			});
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "muted-tool-turn",
				transcript: "Unwanted background request.",
				raw: {},
			});
		});

		let toolResult: unknown;
		await act(async () => {
			toolResult = await mocks.onToolCall?.({
				toolCall: {
					toolCallId: "muted-tool-call",
					toolName: "run_cline",
					args: { request: "Unwanted background request." },
				},
			});
		});

		expect(toolResult).toEqual({
			ok: true,
			discarded: true,
			response: "",
		});
		expect(bridge.sendPrompt).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain("Unwanted background request.");
	});

	it("does not add or speak a greeting when the voice session restarts", async () => {
		const greeting =
			"Hi! I'm Cline. Your voice session is ready. How can I help you?";
		const props = {
			bridge: makeBridge(),
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		const stopButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Stop realtime voice"]',
		);
		act(() => stopButton?.click());
		mocks.realtimeState.status = "disconnected";
		mocks.realtimeState.isCapturing = false;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		const startButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Start realtime voice"]',
		);
		await act(async () => {
			startButton?.click();
			await Promise.resolve();
		});
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});

		const greetingEntries = [...container.querySelectorAll("p")].filter(
			(entry) => entry.textContent === greeting,
		);
		expect(greetingEntries).toHaveLength(0);
		expect(mocks.speakGreeting).not.toHaveBeenCalled();
	});

	it("terminates the realtime session once when the provider returns an error", async () => {
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={onOpenChange}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.disconnect.mockClear();
		mocks.stopAudioCapture.mockClear();
		mocks.stopPlayback.mockClear();

		act(() => {
			mocks.onEvent?.({
				type: "error",
				code: "user_not_found",
				message: "User not found.",
				raw: {},
			});
			mocks.onEvent?.({
				type: "error",
				code: "user_not_found",
				message: "User not found.",
				raw: {},
			});
		});

		expect(mocks.stopAudioCapture).toHaveBeenCalledOnce();
		expect(mocks.stopPlayback).toHaveBeenCalledOnce();
		expect(mocks.disconnect).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(mocks.toast).toHaveBeenCalledOnce();
		expect(mocks.toast).toHaveBeenCalledWith({
			variant: "destructive",
			title: "Realtime voice failed",
			description: "User not found.",
		});
	});

	it("shows a useful failure when the provider omits its error message", async () => {
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={onOpenChange}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());

		act(() => mocks.onError?.(new Error("")));

		const failure =
			"Realtime provider returned an error without additional details.";
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(mocks.toast).toHaveBeenCalledWith({
			variant: "destructive",
			title: "Realtime voice failed",
			description: failure,
		});
		expect(mocks.writeLog).toHaveBeenCalledWith(
			expect.objectContaining({
				level: "error",
				metadata: expect.objectContaining({ failure }),
			}),
		);
	});

	it("keeps the session open when a best-effort response cancellation loses its race", async () => {
		const onOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={onOpenChange}
					open
					target={geminiTarget}
				/>,
			);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.disconnect.mockClear();
		mocks.stopAudioCapture.mockClear();

		const cancellationFailure = new Error(
			"Cancellation failed: no active response found",
		);
		act(() => {
			mocks.onEvent?.({
				type: "error",
				code: "invalid_request_error",
				message: cancellationFailure.message,
				raw: {},
			});
			mocks.onError?.(cancellationFailure);
		});

		expect(mocks.disconnect).not.toHaveBeenCalled();
		expect(mocks.stopAudioCapture).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalled();
	});

	it("stops media and disconnects when the global overlay closes", async () => {
		const props = {
			bridge: makeBridge(),
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			target,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} open />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.disconnect.mockClear();
		mocks.stopAudioCapture.mockClear();
		mocks.stopPlayback.mockClear();

		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} open={false} />);
		});

		expect(container.textContent).toBe("");
		expect(mocks.stopAudioCapture).toHaveBeenCalledOnce();
		expect(mocks.stopPlayback).toHaveBeenCalledOnce();
		expect(mocks.disconnect).toHaveBeenCalledOnce();
	});

	it("lets the realtime model invoke Cline and returns its persisted result", async () => {
		const bridge = makeBridge();
		const props = {
			bridge,
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target,
		};

		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});
		mocks.sendEvent.mockClear();

		await act(async () => {
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "voice-turn-1",
				transcript: "Inspect the failing test and fix it.",
				raw: {},
			});
			await Promise.resolve();
		});

		expect(container.textContent).toContain(
			"Inspect the failing test and fix it.",
		);
		expect(bridge.sendPrompt).not.toHaveBeenCalled();

		let toolResult: unknown;
		await act(async () => {
			toolResult = await mocks.onToolCall?.({
				toolCall: {
					toolCallId: "tool-call-1",
					toolName: "run_cline",
					args: { request: "Inspect the failing test and fix it." },
				},
			});
		});

		expect(bridge.sendPrompt).toHaveBeenCalledWith(
			"Inspect the failing test and fix it.",
		);
		expect(toolResult).toEqual({
			ok: true,
			response: "I found and fixed the issue.",
			sessionId: "session-1",
		});
		let duplicateToolResult: unknown;
		await act(async () => {
			duplicateToolResult = await mocks.onToolCall?.({
				toolCall: {
					toolCallId: "tool-call-duplicate",
					toolName: "run_cline",
					args: { request: "Inspect the failing test and fix it." },
				},
			});
		});
		expect(bridge.sendPrompt).toHaveBeenCalledOnce();
		expect(duplicateToolResult).toEqual({
			ok: false,
			retryable: false,
			error:
				"Cline has already processed this voice turn. Do not call run_cline again.",
		});
		expect(mocks.sendEvent).not.toHaveBeenCalled();
		expect(container.textContent).toContain("I found and fixed the issue.");
	});

	it("reports text-agent failures without blaming or closing realtime", async () => {
		const onOpenChange = vi.fn();
		const bridge = makeBridge({
			sendPrompt: vi.fn(async () => ({
				sessionId: "session-1",
				queued: false,
				text: "User not found.",
				result: {
					text: "User not found.",
					finishReason: "error",
				},
			})),
		});
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={bridge}
					onConfigure={vi.fn()}
					onOpenChange={onOpenChange}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		act(() => {
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "voice-turn-agent-error",
				transcript: "Inspect the project.",
				raw: {},
			});
		});

		let toolResult: unknown;
		await act(async () => {
			toolResult = await mocks.onToolCall?.({
				toolCall: {
					toolCallId: "tool-call-agent-error",
					toolName: "run_cline",
					args: { request: "Inspect the project." },
				},
			});
		});

		const failure =
			"Cline agent (openrouter / minimax/minimax-m3) failed: User not found.";
		expect(toolResult).toEqual({
			ok: false,
			retryable: false,
			error: failure,
		});
		expect(container.textContent).toContain(failure);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(mocks.toast).not.toHaveBeenCalled();
	});

	it("allows a tool-capable realtime model to answer through Cline", async () => {
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={vi.fn()}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});

		act(() => {
			mocks.onEvent?.({
				type: "response-created",
				responseId: "automatic-response",
				raw: {},
			});
		});

		expect(mocks.cancelResponse).not.toHaveBeenCalled();
	});

	it("suppresses automatic answers when the model needs transcript fallback", async () => {
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={makeBridge()}
					onConfigure={vi.fn()}
					onOpenChange={vi.fn()}
					open
					target={geminiTarget}
				/>,
			);
			await Promise.resolve();
		});

		act(() => {
			mocks.onEvent?.({
				type: "response-created",
				responseId: "automatic-response",
				raw: {},
			});
		});

		expect(mocks.cancelResponse).toHaveBeenCalledOnce();
	});

	it("consumes transcript-fallback turns after React development effect replay", async () => {
		const bridge = makeBridge();
		const overlay = (
			<StrictMode>
				<RealtimeVoiceOverlay
					bridge={bridge}
					onConfigure={vi.fn()}
					onOpenChange={vi.fn()}
					open
					target={geminiTarget}
				/>
			</StrictMode>
		);
		await act(async () => {
			root.render(overlay);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());

		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(overlay);
		});
		act(() => {
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "strict-mode-turn",
				transcript: "Check the promotion status.",
				raw: {},
			});
		});

		await vi.waitFor(() =>
			expect(bridge.sendPrompt).toHaveBeenCalledWith(
				"Check the promotion status.",
			),
		);
		expect(container.textContent).not.toContain("voice turn waiting");
	});

	it("uses Gemini realtime input for Cline-authored playback", async () => {
		const bridge = makeBridge();
		const props = {
			bridge,
			onConfigure: vi.fn(),
			onOpenChange: vi.fn(),
			open: true,
			target: geminiTarget,
		};
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
			await Promise.resolve();
		});
		await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledOnce());
		mocks.realtimeState.status = "connected";
		mocks.realtimeState.isCapturing = true;
		await act(async () => {
			root.render(<RealtimeVoiceOverlay {...props} />);
		});
		mocks.sendEvent.mockClear();

		act(() => {
			mocks.onEvent?.({
				type: "input-transcription-completed",
				itemId: "gemini-turn-1",
				transcript: "Run the tests.",
				raw: {},
			});
		});
		await vi.waitFor(() =>
			expect(bridge.sendPrompt).toHaveBeenCalledWith("Run the tests."),
		);
		act(() => {
			mocks.onEvent?.({
				type: "response-done",
				responseId: "gemini-automatic-response",
				raw: {},
			});
		});

		await vi.waitFor(() =>
			expect(mocks.sendEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "conversation-item-create",
					item: expect.objectContaining({
						type: "text-message",
						text: expect.stringContaining("I found and fixed the issue."),
					}),
				}),
			),
		);
	});

	it("surfaces tool approval state in the composer panel", async () => {
		mocks.realtimeState.status = "connected";
		const bridge = makeBridge({
			status: "running",
			pendingToolApprovals: [
				{
					requestId: "approval-1",
					sessionId: "session-1",
					createdAt: new Date().toISOString(),
					toolCallId: "tool-1",
					toolName: "execute_command",
				},
			],
		});
		await act(async () => {
			root.render(
				<RealtimeVoiceOverlay
					bridge={bridge}
					onConfigure={vi.fn()}
					onOpenChange={vi.fn()}
					open
					target={target}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Tool approval required");
		expect(container.textContent).not.toContain("Review in chat");
	});
});
