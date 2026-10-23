import { useState } from "react";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { type UseVoiceDictation, useVoiceDictation } from "./dictation";

const native = vi.hoisted(() => ({
	available: vi.fn(() => true),
	permissions: vi.fn(async () => ({ granted: true, canAskAgain: true })),
	start: vi.fn(),
	stop: vi.fn(),
	abort: vi.fn(),
	listeners: new Map<string, Set<(event: unknown) => void>>(),
}));

vi.mock("expo-speech-recognition", async () => {
	const { useEffect } = await import("react");
	return {
		ExpoSpeechRecognitionModule: {
			isRecognitionAvailable: native.available,
			requestPermissionsAsync: native.permissions,
			start: native.start,
			stop: native.stop,
			abort: native.abort,
		},
		useSpeechRecognitionEvent: (
			name: string,
			callback: (event: unknown) => void,
		) => {
			useEffect(() => {
				const listeners =
					native.listeners.get(name) ?? new Set<(event: unknown) => void>();
				listeners.add(callback);
				native.listeners.set(name, listeners);
				return () => {
					listeners.delete(callback);
				};
			}, [name, callback]);
		},
	};
});

function mount(initial = "") {
	let voice!: UseVoiceDictation;
	let draft = initial;
	function Harness() {
		const [value, setValue] = useState(initial);
		const [selection, setSelection] = useState({
			start: initial.length,
			end: initial.length,
		});
		draft = value;
		voice = useVoiceDictation({
			value,
			selection,
			onChange: setValue,
			onSelectionChange: setSelection,
		});
		return null;
	}
	const mounted = render(<Harness />);
	return {
		...mounted,
		get voice() {
			return voice;
		},
		get draft() {
			return draft;
		},
	};
}

function emit(name: string, event = {}) {
	act(() => {
		for (const listener of native.listeners.get(name) ?? []) listener(event);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	native.listeners.clear();
	native.available.mockReturnValue(true);
	native.permissions.mockResolvedValue({ granted: true, canAskAgain: true });
});

describe("dictation native-event lifecycle (mocked speech service)", () => {
	it("keeps a new composer idle when another mounted composer reports no speech", async () => {
		const home = mount("New session draft");
		const chat = mount("Existing session draft");
		expect(native.permissions).not.toHaveBeenCalled();
		expect(native.start).not.toHaveBeenCalled();
		await act(() => chat.voice.start());
		emit("start");
		emit("error", { error: "no-speech", message: "No speech was detected." });
		emit("end");
		expect(chat.voice.error).toBe("No speech was detected. Try again.");
		expect(home.voice.state).toBe("idle");
		expect(home.voice.error).toBeUndefined();
		expect(home.draft).toBe("New session draft");
		chat.unmount();
		home.unmount();
	});

	it("ignores delayed native errors after leaving a composer", async () => {
		const chat = mount();
		await act(() => chat.voice.start());
		emit("start");
		chat.unmount();
		const home = mount();
		emit("error", { error: "no-speech", message: "No speech was detected." });
		emit("end");
		expect(home.voice.state).toBe("idle");
		expect(home.voice.error).toBeUndefined();
		expect(native.start).toHaveBeenCalledOnce();
		home.unmount();
	});

	it("replaces interim text, accepts the final result, and releases busy state after stop", async () => {
		const app = mount("Please");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledOnce();
		emit("start");
		expect(app.voice.state).toBe("listening");
		emit("result", { results: [{ transcript: "fix" }], isFinal: false });
		emit("result", {
			results: [{ transcript: "fix the tests" }],
			isFinal: true,
		});
		expect(app.draft).toBe("Please fix the tests");
		act(() => app.voice.stop());
		expect(native.stop).toHaveBeenCalledOnce();
		expect(app.voice.state).toBe("transcribing");
		emit("end");
		expect(app.voice.active).toBe(false);
		app.unmount();
	});

	it("preserves a draft after the observed simulator failure and allows retry", async () => {
		const app = mount("Keep this draft");
		await act(() => app.voice.start());
		emit("error", {
			error: "audio-capture",
			message: "Failed to initialize recognizer",
		});
		emit("end");
		expect(app.voice.state).toBe("error");
		expect(app.voice.active).toBe(false);
		expect(app.draft).toBe("Keep this draft");
		await act(() => app.voice.start());
		expect(app.voice.error).toBeUndefined();
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
	});

	it("does not start recording after permission is denied", async () => {
		native.permissions.mockResolvedValue({
			granted: false,
			canAskAgain: false,
		});
		const app = mount();
		await act(() => app.voice.start());
		expect(native.start).not.toHaveBeenCalled();
		expect(app.voice.error).toContain("Settings");
		expect(app.voice.active).toBe(false);
		app.unmount();
	});

	it.each([
		"no-speech",
		"network",
	])("recovers from %s without accepting a late transcript", async (error) => {
		const app = mount("Unsent draft");
		await act(() => app.voice.start());
		emit("start");
		emit("error", { error, message: "Native failure" });
		emit("result", {
			results: [{ transcript: "late transcript" }],
			isFinal: true,
		});
		emit("end");
		expect(app.draft).toBe("Unsent draft");
		expect(app.voice.active).toBe(false);
		expect(app.voice.error).toBeTruthy();
		await act(() => app.voice.start());
		emit("start");
		expect(app.voice.state).toBe("listening");
		app.unmount();
	});

	it("fails cleanly when recognition is unavailable", async () => {
		native.available.mockReturnValue(false);
		const app = mount();
		await act(() => app.voice.start());
		expect(native.permissions).not.toHaveBeenCalled();
		expect(native.start).not.toHaveBeenCalled();
		expect(app.voice.active).toBe(false);
		app.unmount();
	});

	it("does not start after leaving while the permission prompt is pending", async () => {
		let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
		native.permissions.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					grant = resolve;
				}),
		);
		const app = mount();
		let pending!: Promise<void>;
		act(() => {
			pending = app.voice.start();
		});
		app.unmount();
		await act(async () => {
			grant({ granted: true, canAskAgain: true });
			await pending;
		});
		expect(native.start).not.toHaveBeenCalled();
	});

	it("aborts recognition when leaving an active composer", async () => {
		const app = mount();
		await act(() => app.voice.start());
		emit("start");
		app.unmount();
		expect(native.abort).toHaveBeenCalledOnce();
	});
});
