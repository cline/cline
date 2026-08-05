// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechInput } from "./speech-input";

class FakeMediaRecorder extends EventTarget {
	static instances: FakeMediaRecorder[] = [];

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
		const dataEvent = new Event("dataavailable");
		Object.defineProperty(dataEvent, "data", {
			value: new Blob(["recorded audio"], { type: this.mimeType }),
		});
		this.dispatchEvent(dataEvent);
		this.dispatchEvent(new Event("stop"));
	}
}

class FakeSpeechRecognition extends EventTarget {
	static instances: FakeSpeechRecognition[] = [];

	continuous = false;
	interimResults = false;
	lang = "";

	constructor() {
		super();
		FakeSpeechRecognition.instances.push(this);
	}

	start(): void {
		this.dispatchEvent(new Event("start"));
	}
	stop(): void {}
}

let container: HTMLDivElement;
let root: Root;
let stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	FakeMediaRecorder.instances = [];
	FakeSpeechRecognition.instances = [];
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
	it("shows finalized speech recognition text without stopping the microphone", async () => {
		const onTranscriptionChange = vi.fn();

		await act(async () => {
			root.render(
				<SpeechInput
					onAudioRecorded={vi.fn(async () => "fallback transcript")}
					onTranscriptionChange={onTranscriptionChange}
					recordingMode="auto"
				/>,
			);
		});

		const button = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		await act(async () => button?.click());

		const recognition = FakeSpeechRecognition.instances[0];
		expect(recognition?.continuous).toBe(true);
		expect(recognition?.interimResults).toBe(true);
		const resultEvent = new Event("result");
		Object.defineProperties(resultEvent, {
			resultIndex: { value: 0 },
			results: {
				value: Object.assign(
					[
						Object.assign([{ transcript: "live transcript", confidence: 1 }], {
							isFinal: true,
						}),
					],
					{ length: 1 },
				),
			},
		});
		await act(async () => recognition?.dispatchEvent(resultEvent));

		expect(onTranscriptionChange).toHaveBeenCalledWith("live transcript");
		expect(button?.getAttribute("aria-label")).toBe("Stop recording");
		expect(FakeMediaRecorder.instances).toHaveLength(0);
	});

	it("records audio and forwards the provider transcript", async () => {
		const onAudioRecorded = vi.fn(async () => "transcribed prompt");
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
		expect(button?.querySelector(".lucide-mic")).not.toBeNull();
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
			button?.querySelector(".lucide-mic")?.getAttribute("class"),
		).toContain("animate-pulse");
		expect(
			button?.querySelector(".lucide-mic")?.getAttribute("class"),
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
		expect(onTranscriptionChange).toHaveBeenCalledWith("transcribed prompt");
		expect(onActiveChange).toHaveBeenLastCalledWith(false);
		expect(onProcessingChange).toHaveBeenCalledWith(true);
		expect(onProcessingChange).toHaveBeenLastCalledWith(false);
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
});
