// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechInput } from "./speech-input";

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];
	static recordedAudio: Blob | null = new Blob(["recorded audio"], {
		type: "audio/webm",
	});

	readonly mimeType = "audio/webm";
	state: RecordingState = "inactive";

	constructor(readonly stream: MediaStream) {
		super();
		FakeMediaRecorder.instances.push(this);
	}

	start(): void {
		this.state = "recording";
	}

	stop(): void {
		this.state = "inactive";
		if (FakeMediaRecorder.recordedAudio) {
			const dataEvent = new Event("dataavailable");
			Object.defineProperty(dataEvent, "data", {
				value: FakeMediaRecorder.recordedAudio,
			});
			this.dispatchEvent(dataEvent);
		}
		this.dispatchEvent(new Event("stop"));
	}
}

class FakeSpeechRecognition extends EventTarget {
	continuous = false;
	interimResults = false;
	lang = "";

	start(): void {}
	stop(): void {}
}

let container: HTMLDivElement;
let root: Root;
let stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	FakeMediaRecorder.instances = [];
	FakeMediaRecorder.recordedAudio = new Blob(["recorded audio"], {
		type: "audio/webm",
	});
	stopTrack = vi.fn();
	Object.defineProperty(window, "MediaRecorder", {
		configurable: true,
		value: FakeMediaRecorder,
	});
	Object.defineProperty(window, "SpeechRecognition", {
		configurable: true,
		value: FakeSpeechRecognition,
	});
	Object.defineProperty(window, "AudioContext", {
		configurable: true,
		value: class {},
	});
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			getUserMedia: vi.fn(async () => ({
				getTracks: () => [{ stop: stopTrack }],
			})),
		},
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	delete (
		window as typeof window & { MediaRecorder?: typeof FakeMediaRecorder }
	).MediaRecorder;
	delete (
		window as typeof window & {
			SpeechRecognition?: typeof FakeSpeechRecognition;
		}
	).SpeechRecognition;
	delete (window as typeof window & { AudioContext?: typeof AudioContext })
		.AudioContext;
	vi.restoreAllMocks();
});

describe("SpeechInput", () => {
	it("records audio and forwards the provider transcript", async () => {
		let resolveTranscript: (transcript: string) => void = () => {};
		const transcript = new Promise<string>((resolve) => {
			resolveTranscript = resolve;
		});
		const onAudioRecorded = vi.fn(() => transcript);
		const onActiveChange = vi.fn();
		const onProcessingChange = vi.fn();
		const onTranscriptionChange = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onActiveChange={onActiveChange}
					onAudioRecorded={onAudioRecorded}
					onProcessingChange={onProcessingChange}
					onTranscriptionChange={onTranscriptionChange}
					recordingMode="media-recorder"
				/>,
			);
		});

		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		expect(button?.disabled).toBe(false);
		expect(onActiveChange).toHaveBeenLastCalledWith(false);
		expect(button?.querySelector(".lucide-audio-lines")).not.toBeNull();
		expect(button?.querySelector(".lucide-square")).toBeNull();

		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		expect(FakeMediaRecorder.instances).toHaveLength(1);
		expect(onActiveChange).toHaveBeenLastCalledWith(true);
		expect(button?.getAttribute("aria-label")).toBe("Stop recording");
		expect(button?.title).toBe("Stop recording");
		expect(
			button?.querySelector(".lucide-audio-lines")?.getAttribute("class"),
		).toContain("animate-pulse");
		expect(
			button?.querySelector(".lucide-audio-lines")?.getAttribute("class"),
		).toContain("group-hover:opacity-0");
		expect(
			button?.querySelector(".lucide-square")?.getAttribute("class"),
		).toContain("group-hover:opacity-100");

		await act(async () => {
			button?.click();
			await Promise.resolve();
		});

		expect(onAudioRecorded).toHaveBeenCalledWith(
			expect.objectContaining({ type: "audio/webm" }),
		);
		expect(onProcessingChange).toHaveBeenCalledWith(true);
		expect(onActiveChange).toHaveBeenLastCalledWith(true);
		expect(button?.disabled).toBe(true);

		await act(async () => {
			resolveTranscript("transcribed prompt");
			await transcript;
		});

		expect(onTranscriptionChange).toHaveBeenCalledWith("transcribed prompt");
		expect(onProcessingChange).toHaveBeenLastCalledWith(false);
		expect(onActiveChange).toHaveBeenLastCalledWith(false);
		expect(stopTrack).toHaveBeenCalledOnce();
	});

	it("starts and stops a streaming transcription session", async () => {
		let resolveDone: () => void = () => {};
		const done = new Promise<void>((resolve) => {
			resolveDone = resolve;
		});
		const stop = vi.fn(resolveDone);
		const cancel = vi.fn(resolveDone);
		const onStartStreaming = vi.fn(async () => ({ done, stop, cancel }));
		const onStreamingStart = vi.fn();
		const onStreamingEnd = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onStartStreaming={onStartStreaming}
					onStreamingEnd={onStreamingEnd}
					onStreamingStart={onStreamingStart}
					recordingMode="streaming"
				/>,
			);
		});

		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		expect(onStreamingStart).toHaveBeenCalledOnce();
		expect(onStartStreaming).toHaveBeenCalledOnce();
		expect(button?.getAttribute("aria-label")).toBe("Stop recording");

		await act(async () => {
			button?.click();
			await done;
		});
		expect(stop).toHaveBeenCalledOnce();
		expect(onStreamingEnd).toHaveBeenCalledOnce();
		expect(button?.getAttribute("aria-label")).toBe("Record speech");
	});

	it("ignores a pending batch transcript after unmount", async () => {
		let resolveTranscript: (transcript: string) => void = () => {};
		const pendingTranscript = new Promise<string>((resolve) => {
			resolveTranscript = resolve;
		});
		const onTranscriptionChange = vi.fn();
		const onError = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onAudioRecorded={() => pendingTranscript}
					onError={onError}
					onTranscriptionChange={onTranscriptionChange}
					recordingMode="media-recorder"
				/>,
			);
		});
		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		await act(async () => root.render(<div />));
		await act(async () => {
			resolveTranscript("stale transcript");
			await pendingTranscript;
		});

		expect(onTranscriptionChange).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("returns to an inactive state when the recorder produces no audio", async () => {
		FakeMediaRecorder.recordedAudio = null;
		const onActiveChange = vi.fn();
		const onAudioRecorded = vi.fn(async () => "should not run");
		const onProcessingChange = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onActiveChange={onActiveChange}
					onAudioRecorded={onAudioRecorded}
					onProcessingChange={onProcessingChange}
					recordingMode="media-recorder"
				/>,
			);
		});
		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});

		expect(onAudioRecorded).not.toHaveBeenCalled();
		expect(onActiveChange).toHaveBeenLastCalledWith(false);
		expect(onProcessingChange).toHaveBeenLastCalledWith(false);
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute("aria-label")).toBe("Record speech");
	});

	it("cancels a streaming session that arrives after the component unmounts", async () => {
		let resolveSession: (session: {
			done: Promise<void>;
			stop: () => void;
			cancel: () => void;
		}) => void = () => {};
		const pendingSession = new Promise<{
			done: Promise<void>;
			stop: () => void;
			cancel: () => void;
		}>((resolve) => {
			resolveSession = resolve;
		});
		const cancel = vi.fn();
		const onStreamingEnd = vi.fn();
		const onError = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onError={onError}
					onStartStreaming={() => pendingSession}
					onStreamingEnd={onStreamingEnd}
					recordingMode="streaming"
				/>,
			);
		});

		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		await act(async () => {
			button?.click();
			await Promise.resolve();
		});
		await act(async () => root.render(<div />));
		await act(async () => {
			resolveSession({
				done: new Promise<void>(() => {}),
				stop: vi.fn(),
				cancel,
			});
			await pendingSession;
		});

		expect(cancel).toHaveBeenCalledOnce();
		expect(onStreamingEnd).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});
