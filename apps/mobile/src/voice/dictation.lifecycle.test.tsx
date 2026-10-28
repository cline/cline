import { useState } from "react";
import { NavigationContext } from "expo-router/react-navigation";
import { AppState } from "react-native";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { Text } from "@/ui";
import {
	type UseVoiceDictation,
	useVoiceDictation,
	VoiceInputFeedback,
} from "./dictation";

const native = vi.hoisted(() => ({
	available: vi.fn(() => true),
	getPermissions: vi.fn(async () => ({ granted: false, canAskAgain: true })),
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
			getPermissionsAsync: native.getPermissions,
			requestPermissionsAsync: native.permissions,
			start: native.start,
			stop: native.stop,
			abort: native.abort,
			addListener: (name: string, callback: (event: unknown) => void) => {
				const listeners =
					native.listeners.get(name) ?? new Set<(event: unknown) => void>();
				listeners.add(callback);
				native.listeners.set(name, listeners);
				return {
					remove: () => {
						listeners.delete(callback);
					},
				};
			},
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

function mount(initial = "", navigation?: ReturnType<typeof createNavigation>) {
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
	const mounted = render(
		navigation ? (
			<NavigationContext.Provider value={navigation as never}>
				<Harness />
			</NavigationContext.Provider>
		) : (
			<Harness />
		),
	);
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
	AppState.currentState = "active";
	native.listeners.clear();
	native.abort.mockImplementation(() => {
		for (const listener of native.listeners.get("end") ?? []) listener({});
	});
	native.available.mockReturnValue(true);
	native.getPermissions.mockResolvedValue({
		granted: false,
		canAskAgain: true,
	});
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
		await act(async () => {});
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

function createNavigation() {
	let focused = true;
	const blurListeners = new Set<() => void>();
	return {
		isFocused: () => focused,
		addListener: (name: string, listener: () => void) => {
			if (name === "blur") blurListeners.add(listener);
			return () => {
				blurListeners.delete(listener);
			};
		},
		blur: () => {
			focused = false;
			for (const listener of blurListeners) listener();
		},
	};
}

describe("dictation retained-route ownership (mocked native service)", () => {
	it("cancels a still-mounted composer on route blur and ignores later partial results", async () => {
		const navigation = createNavigation();
		const app = mount("Keep private draft", navigation);
		await act(() => app.voice.start());
		emit("start");
		act(() => navigation.blur());
		expect(native.abort).toHaveBeenCalledOnce();
		expect(app.voice.active).toBe(false);
		emit("result", {
			results: [{ transcript: "hidden route transcript" }],
			isFinal: false,
		});
		expect(app.draft).toBe("Keep private draft");
		app.unmount();
	});
	it("does not begin recognition after permission resolves on a hidden retained route", async () => {
		let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
		native.permissions.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					grant = resolve;
				}),
		);
		const navigation = createNavigation(),
			app = mount("Draft", navigation);
		let pending!: Promise<void>;
		act(() => {
			pending = app.voice.start();
		});
		await act(async () => {});
		act(() => navigation.blur());
		await act(async () => {
			grant({ granted: true, canAskAgain: true });
			await pending;
		});
		expect(native.start).not.toHaveBeenCalled();
		expect(app.voice.active).toBe(false);
		app.unmount();
	});
	it("cancels pending permission work when the app backgrounds without restarting on return", async () => {
		let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
		native.permissions.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					grant = resolve;
				}),
		);
		const app = mount("Draft");
		let pending!: Promise<void>;
		act(() => {
			pending = app.voice.start();
		});
		await act(async () => {});
		act(() => {
			for (const [name, listener] of vi.mocked(AppState.addEventListener).mock
				.calls)
				if (name === "change") listener("background");
		});
		await act(async () => {
			grant({ granted: true, canAskAgain: true });
			await pending;
		});
		expect(native.start).not.toHaveBeenCalled();
		expect(app.voice.active).toBe(false);
		app.unmount();
	});
	it("keeps only the latest mounted composer as owner of global speech events", async () => {
		const home = mount("Home draft"),
			chat = mount("Chat draft");
		await act(() => home.voice.start());
		emit("start");
		await act(() => chat.voice.start());
		emit("start");
		emit("result", {
			results: [{ transcript: "new spoken text" }],
			isFinal: false,
		});
		expect(home.draft).toBe("Home draft");
		expect(home.voice.active).toBe(false);
		expect(chat.draft).toBe("Chat draft new spoken text");
		chat.unmount();
		home.unmount();
	});
});

it("does not revive an old permission request after a new composer acquires dictation", async () => {
	let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.permissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				grant = resolve;
			}),
	);
	const old = mount("Old draft"),
		current = mount("Current draft");
	let pending!: Promise<void>;
	act(() => {
		pending = old.voice.start();
	});
	await act(async () => {});
	await act(() => current.voice.start());
	emit("start");
	await act(async () => {
		grant({ granted: true, canAskAgain: true });
		await pending;
	});
	emit("result", {
		results: [{ transcript: "current speech" }],
		isFinal: false,
	});
	expect(native.start).toHaveBeenCalledOnce();
	expect(old.draft).toBe("Old draft");
	expect(old.voice.active).toBe(false);
	expect(current.draft).toBe("Current draft current speech");
	old.unmount();
	current.unmount();
});
it("stops active dictation in the background and requires explicit retry after returning", async () => {
	const app = mount("Draft");
	await act(() => app.voice.start());
	emit("start");
	act(() => {
		for (const [name, listener] of vi.mocked(AppState.addEventListener).mock
			.calls)
			if (name === "change") listener("background");
	});
	expect(native.abort).toHaveBeenCalledOnce();
	expect(app.voice.active).toBe(false);
	emit("result", {
		results: [{ transcript: "background speech" }],
		isFinal: true,
	});
	act(() => {
		for (const [name, listener] of vi.mocked(AppState.addEventListener).mock
			.calls)
			if (name === "change") listener("active");
	});
	expect(native.start).toHaveBeenCalledOnce();
	expect(app.draft).toBe("Draft");
	await act(() => app.voice.start());
	expect(native.start).toHaveBeenCalledTimes(2);
	app.unmount();
});
it("allows the permission prompt's inactive transition without treating it as app backgrounding", async () => {
	let grant!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.permissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				grant = resolve;
			}),
	);
	const app = mount("Draft");
	let pending!: Promise<void>;
	act(() => {
		pending = app.voice.start();
	});
	await act(async () => {});
	act(() => {
		for (const [name, listener] of vi.mocked(AppState.addEventListener).mock
			.calls)
			if (name === "change") listener("inactive");
	});
	await act(async () => {
		grant({ granted: true, canAskAgain: true });
		await pending;
	});
	expect(native.start).toHaveBeenCalledOnce();
	app.unmount();
});

it("waits for the previous owner's abort end before starting a replacement and ignores its delayed events", async () => {
	native.abort.mockImplementationOnce(() => {});
	const old = mount("Old"),
		current = mount("Current");
	await act(() => old.voice.start());
	emit("start");
	let starting!: Promise<void>;
	act(() => {
		starting = current.voice.start();
	});
	await act(async () => {});
	expect(native.start).toHaveBeenCalledOnce();
	emit("result", {
		results: [{ transcript: "old delayed words" }],
		isFinal: true,
	});
	emit("error", { error: "aborted", message: "Old request cancelled" });
	expect(current.draft).toBe("Current");
	emit("end");
	await act(async () => {
		await starting;
	});
	expect(native.start).toHaveBeenCalledTimes(2);
	emit("start");
	emit("result", {
		results: [{ transcript: "replacement words" }],
		isFinal: false,
	});
	expect(current.draft).toBe("Current replacement words");
	expect(old.draft).toBe("Old");
	old.unmount();
	current.unmount();
});

it("keeps the native end listener across an old composer's unmount before starting its replacement", async () => {
	native.abort.mockImplementationOnce(() => {});
	const old = mount("Old");
	await act(() => old.voice.start());
	emit("start");
	old.unmount();
	const current = mount("Current");
	let starting!: Promise<void>;
	act(() => {
		starting = current.voice.start();
	});
	await act(async () => {});
	expect(native.start).toHaveBeenCalledOnce();
	emit("end");
	await act(async () => {
		await starting;
	});
	expect(native.start).toHaveBeenCalledTimes(2);
	current.unmount();
});
it("fails closed with recovery instructions when native abort never ends, without reviving a draft", async () => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {});
		const old = mount("Old draft"),
			current = mount("Current draft");
		await act(() => old.voice.start());
		emit("start");
		let starting!: Promise<void>;
		act(() => {
			starting = current.voice.start();
		});
		await act(async () => {});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
			await starting;
		});
		expect(current.voice.active).toBe(false);
		expect(current.voice.error).toContain("Close and reopen the app");
		expect(native.start).toHaveBeenCalledOnce();
		expect(current.draft).toBe("Current draft");
		expect(old.draft).toBe("Old draft");
		await act(() => current.voice.start());
		expect(current.voice.active).toBe(false);
		expect(native.start).toHaveBeenCalledOnce();
		emit("end");
		await act(() => current.voice.start());
		expect(native.start).toHaveBeenCalledTimes(2);
		old.unmount();
		current.unmount();
	} finally {
		vi.useRealTimers();
	}
});
it("reports a throwing native abort and keeps the replacement blocked until native end", async () => {
	native.abort.mockImplementationOnce(() => {
		throw new Error("native abort failed");
	});
	const old = mount("Keep old"),
		current = mount("Keep current");
	await act(() => old.voice.start());
	emit("start");
	await act(() => current.voice.start());
	expect(current.voice.active).toBe(false);
	expect(current.voice.error).toContain("Close and reopen the app");
	expect(native.start).toHaveBeenCalledOnce();
	expect(current.draft).toBe("Keep current");
	emit("end");
	await act(() => current.voice.start());
	expect(native.start).toHaveBeenCalledTimes(2);
	old.unmount();
	current.unmount();
});

it("recovers a silent native Stop after a final-transcription grace period, preserving the draft and draining old events", async () => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {});
		const app = mount("Keep");
		await act(() => app.voice.start());
		emit("start");
		emit("result", { results: [{ transcript: "my words" }], isFinal: false });
		act(() => app.voice.stop());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(app.voice.active).toBe(false);
		expect(app.voice.error).toContain("took too long");
		expect(native.abort).toHaveBeenCalledOnce();
		expect(app.draft).toBe("Keep my words");
		const next = mount("Other draft");
		let starting!: Promise<void>;
		act(() => {
			starting = next.voice.start();
		});
		await act(async () => {});
		expect(native.start).toHaveBeenCalledOnce();
		emit("result", {
			results: [{ transcript: "retired transcript" }],
			isFinal: true,
		});
		expect(next.draft).toBe("Other draft");
		expect(app.draft).toBe("Keep my words");
		emit("end");
		await act(() => starting);
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
		next.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("allows a slow final transcript after Stop and cancels its watchdog on native end", async () => {
	vi.useFakeTimers();
	try {
		const app = mount("Keep");
		await act(() => app.voice.start());
		emit("start");
		act(() => app.voice.stop());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(12000);
		});
		expect(app.voice.state).toBe("transcribing");
		expect(native.abort).not.toHaveBeenCalled();
		emit("result", {
			results: [{ transcript: "the final words" }],
			isFinal: true,
		});
		emit("end");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(app.voice.state).toBe("idle");
		expect(app.voice.error).toBeUndefined();
		expect(app.draft).toBe("Keep the final words");
		expect(native.abort).not.toHaveBeenCalled();
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("reports restart recovery if silent Stop cannot drain, then accepts explicit retry only after end", async () => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {});
		const app = mount("Unsent draft");
		await act(() => app.voice.start());
		emit("start");
		act(() => app.voice.stop());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(17000);
		});
		expect(app.voice.active).toBe(false);
		expect(app.voice.error).toContain("Close and reopen the app");
		expect(app.draft).toBe("Unsent draft");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledOnce();
		emit("end");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("cancels a stopped owner's final-transcript deadline when navigation hands speech to another composer", async () => {
	vi.useFakeTimers();
	try {
		const navigation = createNavigation();
		const old = mount("Old draft", navigation);
		await act(() => old.voice.start());
		emit("start");
		act(() => old.voice.stop());
		act(() => navigation.blur());
		const current = mount("Current draft");
		await act(() => current.voice.start());
		emit("start");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(17000);
		});
		expect(current.voice.state).toBe("listening");
		expect(old.voice.state).toBe("idle");
		expect(native.abort).toHaveBeenCalledOnce();
		expect(current.draft).toBe("Current draft");
		old.unmount();
		current.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("keeps a silent Stop recoverable when abort throws, without accepting a late result", async () => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {
			throw new Error("native abort failed");
		});
		const app = mount("Keep this");
		await act(() => app.voice.start());
		emit("start");
		act(() => app.voice.stop());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15000);
		});
		expect(app.voice.active).toBe(false);
		expect(app.voice.error).toContain("Close and reopen the app");
		emit("result", { results: [{ transcript: "late words" }], isFinal: true });
		expect(app.draft).toBe("Keep this");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledOnce();
		emit("end");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

function appState(next: "active" | "background") {
	AppState.currentState = next;
	act(() => {
		for (const [name, listener] of vi.mocked(AppState.addEventListener).mock
			.calls)
			if (name === "change") listener(next);
	});
}

it.each([
	true,
	false,
])("reports the permission result after Android pause/resume without automatically recording (granted=%s)", async (granted) => {
	let finish!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.permissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const app = mount("Original draft", createNavigation());
	let starting!: Promise<void>;
	act(() => {
		starting = app.voice.start();
	});
	await act(async () => {});
	appState("background");
	appState("active");
	await act(async () => {
		finish({ granted, canAskAgain: true });
		await starting;
	});
	expect(native.start).not.toHaveBeenCalled();
	expect(app.voice.active).toBe(false);
	expect(app.draft).toBe("Original draft");
	if (granted) {
		expect(app.voice.error).toBeUndefined();
		expect(app.voice).toHaveProperty(
			"notice",
			"Microphone enabled. Tap the microphone again to dictate.",
		);
	} else {
		expect(app.voice.error).toBe(
			"Microphone and speech recognition permission are required.",
		);
	}
	await act(() => app.voice.start());
	expect(native.start).toHaveBeenCalledOnce();
	expect(app.voice).not.toHaveProperty("notice");
	app.unmount();
});

it.each([
	"hidden",
	"unmounted",
	"new owner",
	"new request",
	"still background",
])("does not publish a canceled permission result into a %s composer", async (boundary) => {
	let finish!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.permissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const navigation = createNavigation();
	const app = mount("Original draft", navigation);
	let starting!: Promise<void>;
	act(() => {
		starting = app.voice.start();
	});
	await act(async () => {});
	appState("background");
	appState("active");
	let other: ReturnType<typeof mount> | undefined;
	if (boundary === "hidden") act(() => navigation.blur());
	if (boundary === "still background") appState("background");
	if (boundary === "unmounted") app.unmount();
	if (boundary === "new owner") {
		other = mount("Other draft");
		await act(() => other!.voice.start());
		emit("end"); // Even a later released lease must invalidate old permission feedback.
	}
	if (boundary === "new request") await act(() => app.voice.start());
	await act(async () => {
		finish({ granted: false, canAskAgain: false });
		await starting;
	});
	expect(app.voice.error).toBeUndefined();
	expect(app.voice).not.toHaveProperty("notice");
	expect(app.draft).toBe("Original draft");
	if (boundary !== "unmounted") app.unmount();
	other?.unmount();
});

it("renders permission-enabled feedback as muted text rather than an error", () => {
	const notice = "Microphone enabled. Tap the microphone again to dictate.";
	const screen = render(
		<VoiceInputFeedback voice={{ state: "idle", active: false, notice }} />,
	);
	expect(screen.root.findAll((node) => node.type === Text)[0]!.props.tone).toBe(
		"muted",
	);
	expect(
		screen.root.findAll((node) => node.type === Text)[0]!.props.children,
	).toBe(notice);
	screen.unmount();
});

it("starts with an already-granted microphone without reopening the Android permission Activity", async () => {
	native.getPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
	const app = mount("Draft");
	await act(() => app.voice.start());
	expect(native.getPermissions).toHaveBeenCalledOnce();
	expect(native.permissions).not.toHaveBeenCalled();
	expect(native.start).toHaveBeenCalledOnce();
	app.unmount();
});

it("uses the granted preflight on the explicit retry after permission Activity pause", async () => {
	let finish!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.permissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const app = mount("Unsent draft");
	let starting!: Promise<void>;
	act(() => {
		starting = app.voice.start();
	});
	await act(async () => {});
	appState("background");
	appState("active");
	await act(async () => {
		finish({ granted: true, canAskAgain: true });
		await starting;
	});
	expect(native.start).not.toHaveBeenCalled();
	expect(app.voice.notice).toContain("Tap the microphone again");
	native.getPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
	await act(() => app.voice.start());
	expect(native.permissions).toHaveBeenCalledOnce();
	expect(native.start).toHaveBeenCalledOnce();
	expect(app.voice.notice).toBeUndefined();
	expect(app.draft).toBe("Unsent draft");
	app.unmount();
});

it("shows Settings guidance without opening another request when permission cannot be requested", async () => {
	native.getPermissions.mockResolvedValue({
		granted: false,
		canAskAgain: false,
	});
	const app = mount("Draft");
	await act(() => app.voice.start());
	expect(native.permissions).not.toHaveBeenCalled();
	expect(native.start).not.toHaveBeenCalled();
	expect(app.voice.error).toContain("Settings");
	app.unmount();
});

it.each([
	"blur",
	"background",
	"new owner",
])("does not request permissions after a late preflight on %s", async (boundary) => {
	let finish!: (value: { granted: boolean; canAskAgain: boolean }) => void;
	native.getPermissions.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const navigation = createNavigation();
	const app = mount("Original", navigation);
	let starting!: Promise<void>;
	act(() => {
		starting = app.voice.start();
	});
	await act(async () => {});
	let other: ReturnType<typeof mount> | undefined;
	if (boundary === "blur") act(() => navigation.blur());
	if (boundary === "background") appState("background");
	if (boundary === "new owner") {
		other = mount("Other");
		native.getPermissions.mockResolvedValueOnce({
			granted: true,
			canAskAgain: true,
		});
		await act(() => other!.voice.start());
	}
	await act(async () => {
		finish({ granted: false, canAskAgain: true });
		await starting;
	});
	expect(native.permissions).not.toHaveBeenCalled();
	expect(native.start).toHaveBeenCalledTimes(boundary === "new owner" ? 1 : 0);
	expect(app.draft).toBe("Original");
	app.unmount();
	other?.unmount();
});

it("recovers an iOS recognizer-construction error without end through one explicit abort/drain retry", async () => {
	vi.useFakeTimers();
	try {
		const app = mount("Keep draft");
		await act(() => app.voice.start());
		emit("error", {
			error: "not-allowed",
			message: "Recognizer initialization failed",
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(native.abort).not.toHaveBeenCalled();
		expect(native.start).toHaveBeenCalledOnce();
		await act(() => app.voice.start());
		expect(native.abort).toHaveBeenCalledOnce();
		expect(native.start).toHaveBeenCalledTimes(2);
		expect(app.voice.error).toBeUndefined();
		expect(app.draft).toBe("Keep draft");
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("keeps error-only retry waiting for abort end and ignores retiring results", async () => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {});
		const app = mount("Keep draft");
		await act(() => app.voice.start());
		emit("error", {
			error: "not-allowed",
			message: "Recognizer initialization failed",
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		let retry!: Promise<void>;
		act(() => {
			retry = app.voice.start();
		});
		await act(async () => {});
		expect(native.abort).toHaveBeenCalledOnce();
		expect(native.start).toHaveBeenCalledOnce();
		expect(native.listeners.get("end")?.size).toBe(2); // Hook + one shared drain listener.
		emit("result", {
			results: [{ transcript: "retiring transcript" }],
			isFinal: true,
		});
		expect(app.draft).toBe("Keep draft");
		emit("end");
		await act(() => retry);
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it.each([
	"missing end",
	"throwing abort",
])("bounds error-only abort recovery to one attempt on %s", async (boundary) => {
	vi.useFakeTimers();
	try {
		native.abort.mockImplementationOnce(() => {
			if (boundary === "throwing abort") throw new Error("native abort failed");
		});
		const app = mount("Keep draft");
		await act(() => app.voice.start());
		emit("error", {
			error: "not-allowed",
			message: "Recognizer initialization failed",
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		let retry!: Promise<void>;
		act(() => {
			retry = app.voice.start();
		});
		await act(async () => {});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
			await retry;
		});
		expect(native.abort).toHaveBeenCalledOnce();
		expect(app.voice.error).toContain("Close and reopen the app");
		await act(() => app.voice.start());
		expect(native.abort).toHaveBeenCalledOnce();
		expect(native.start).toHaveBeenCalledOnce();
		emit("end");
		await act(() => app.voice.start());
		expect(native.start).toHaveBeenCalledTimes(2);
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});

it("does not begin error-only abort recovery after the explicit retry's composer blurs", async () => {
	vi.useFakeTimers();
	try {
		const navigation = createNavigation();
		const app = mount("Keep draft", navigation);
		await act(() => app.voice.start());
		emit("error", {
			error: "not-allowed",
			message: "Recognizer initialization failed",
		});
		let retry!: Promise<void>;
		act(() => {
			retry = app.voice.start();
		});
		await act(async () => {});
		act(() => navigation.blur());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
			await retry;
		});
		expect(native.abort).not.toHaveBeenCalled();
		expect(native.start).toHaveBeenCalledOnce();
		expect(app.draft).toBe("Keep draft");
		emit("end");
		app.unmount();
	} finally {
		vi.useRealTimers();
	}
});
