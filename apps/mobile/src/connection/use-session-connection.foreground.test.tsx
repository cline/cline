import { StrictMode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../ui/__testing__/render";
import { cloudLaunches } from "./cloud-launches";
import {
	initialSnapshot,
	type SessionConnectionController,
} from "./controller";
import type { ConnectionDescriptor } from "./endpoints";
import { useSessionConnection } from "./use-session-connection";

vi.mock("./cloud-launches", () => ({ cloudLaunches: { open: vi.fn() } }));
const focus = vi.hoisted(() => ({
	focused: true,
	listeners: new Set<() => void>(),
}));
vi.mock("expo-router", async () => {
	const { useEffect, useSyncExternalStore } = await import("react");
	return {
		useFocusEffect: (effect: () => undefined | (() => void)) => {
			const focused = useSyncExternalStore(
				(listener) => {
					focus.listeners.add(listener);
					return () => focus.listeners.delete(listener);
				},
				() => focus.focused,
			);
			useEffect(() => (focused ? effect() : undefined), [focused, effect]);
		},
	};
});

const descriptor: ConnectionDescriptor = {
	mode: "cloud",
	url: "wss://test.invalid",
	remoteSessionId: "outer-existing",
	hubSessionId: "inner-existing",
};
const listeners = new Set<(state: AppStateStatus) => void>();
const subscriptions: {
	listener: (state: AppStateStatus) => void;
	remove: ReturnType<typeof vi.fn>;
}[] = [];

function fakeLease() {
	const controller = {
		getSnapshot: vi.fn(initialSnapshot),
		subscribe: vi.fn(() => vi.fn()),
		start: vi.fn(async () => {}),
		recoverFromIdle: vi.fn(async () => {}),
		checkHealth: vi.fn(async () => {}),
		sendInput: vi.fn(),
	};
	const release = vi.fn();
	return { controller, release };
}
function useLease(lease: ReturnType<typeof fakeLease>) {
	vi.mocked(cloudLaunches.open).mockReturnValue({
		controller: lease.controller as unknown as SessionConnectionController,
		release: lease.release,
	});
}
function Probe({ target = descriptor }: { target?: ConnectionDescriptor }) {
	useSessionConnection(target);
	return null;
}
async function emit(...states: AppStateStatus[]) {
	await act(async () => {
		for (const state of states)
			for (const listener of listeners) listener(state);
	});
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	focus.focused = true;
	focus.listeners.clear();
	listeners.clear();
	subscriptions.length = 0;
	vi.mocked(AppState.addEventListener).mockImplementation(
		(_event, listener) => {
			const remove = vi.fn(() => listeners.delete(listener));
			listeners.add(listener);
			subscriptions.push({ listener, remove });
			return { remove };
		},
	);
});
afterEach(() => vi.useRealTimers());

describe("Cloud foreground recovery", () => {
	it("hydrates on refocus after off-screen AppState changes, without replaying input", async () => {
		const lease = fakeLease();
		useLease(lease);
		render(<Probe />);
		await act(async () => {
			focus.focused = false;
			for (const listener of focus.listeners) listener();
		});
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).not.toHaveBeenCalled();
		await act(async () => {
			focus.focused = true;
			for (const listener of focus.listeners) listener();
		});
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		expect(lease.controller.sendInput).not.toHaveBeenCalled();
	});

	it("refreshes an already-retained ready controller once on mount, even in Strict Mode", async () => {
		const lease = fakeLease();
		lease.controller.getSnapshot.mockReturnValue({
			...initialSnapshot(),
			status: { phase: "ready" },
			sessionId: "inner-existing",
		});
		useLease(lease);
		render(
			<StrictMode>
				<Probe />
			</StrictMode>,
		);
		await act(async () => {});
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		expect(lease.controller.sendInput).not.toHaveBeenCalled();
	});
	it("recovers on actual returns to active, without a mount reconnect or prompt replay", async () => {
		const lease = fakeLease();
		useLease(lease);
		render(<Probe />);
		expect(lease.controller.start).toHaveBeenCalledOnce();
		await emit("active", "active");
		expect(lease.controller.recoverFromIdle).not.toHaveBeenCalled();
		await emit("inactive", "background", "active", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		await emit("inactive", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledTimes(2);
		expect(lease.controller.sendInput).not.toHaveBeenCalled();
	});

	it("coalesces foreground events while recovery is still pending", async () => {
		const lease = fakeLease();
		let finish = () => {};
		lease.controller.recoverFromIdle.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		useLease(lease);
		render(<Probe />);
		await emit("background", "active", "inactive", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		await act(async () => finish());
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledTimes(2);
		await act(async () => finish());
	});

	it("handles recovery rejection and permits a later foreground retry", async () => {
		const lease = fakeLease();
		lease.controller.recoverFromIdle.mockRejectedValueOnce(
			new Error("offline"),
		);
		useLease(lease);
		render(<Probe />);
		await emit("background", "active");
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledTimes(2);
	});

	it("removes old listeners on descriptor replacement and unmount, including queued callbacks", async () => {
		const old = fakeLease();
		useLease(old);
		const screen = render(<Probe />);
		const oldSubscription = subscriptions[0];
		const next = fakeLease();
		useLease(next);
		act(() =>
			screen.renderer.update(
				<Probe target={{ ...descriptor, hubSessionId: "other" }} />,
			),
		);
		expect(old.release).toHaveBeenCalledOnce();
		expect(oldSubscription.remove).toHaveBeenCalledOnce();
		await act(async () => {
			oldSubscription.listener("background");
			oldSubscription.listener("active");
		});
		await emit("background", "active");
		expect(old.controller.recoverFromIdle).not.toHaveBeenCalled();
		expect(next.controller.recoverFromIdle).toHaveBeenCalledOnce();
		screen.unmount();
		expect(next.release).toHaveBeenCalledOnce();
		expect(listeners.size).toBe(0);
		await emit("background", "active");
		expect(next.controller.recoverFromIdle).toHaveBeenCalledOnce();
	});

	it("leaves one listener after Strict Mode remount and removes it on unmount", async () => {
		const lease = fakeLease();
		useLease(lease);
		const screen = render(
			<StrictMode>
				<Probe />
			</StrictMode>,
		);
		expect(listeners.size).toBe(1);
		expect(lease.controller.recoverFromIdle).not.toHaveBeenCalled();
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		screen.unmount();
		expect(listeners.size).toBe(0);
		expect(
			subscriptions.every(
				(subscription) => subscription.remove.mock.calls.length === 1,
			),
		).toBe(true);
	});

	it("does not install foreground recovery for computer sessions", async () => {
		const lease = fakeLease();
		useLease(lease);
		render(<Probe target={{ mode: "local", url: "ws://test.invalid" }} />);
		expect(AppState.addEventListener).not.toHaveBeenCalled();
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).not.toHaveBeenCalled();
	});

	it("checks health every 30 seconds only while the exact conversation is active and focused", async () => {
		vi.useFakeTimers();
		const lease = fakeLease();
		lease.controller.getSnapshot.mockReturnValue({
			...initialSnapshot(),
			sessionId: "inner-existing",
		});
		useLease(lease);
		const screen = render(<Probe />);
		expect(lease.controller.checkHealth).not.toHaveBeenCalled();
		await advance(30_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledOnce();
		await emit("background");
		await advance(120_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledOnce();
		await emit("active");
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
		await advance(30_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledTimes(2);
		screen.unmount();
		await advance(120_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledTimes(2);
		expect(lease.controller.sendInput).not.toHaveBeenCalled();
	});

	it("does not start health checks before an inner session exists", async () => {
		vi.useFakeTimers();
		const lease = fakeLease();
		useLease(lease);
		render(<Probe />);
		await advance(120_000);
		expect(lease.controller.checkHealth).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops health checks when another screen is focused and restarts them on return", async () => {
		vi.useFakeTimers();
		const lease = fakeLease();
		lease.controller.getSnapshot.mockReturnValue({
			...initialSnapshot(),
			sessionId: "inner-existing",
		});
		useLease(lease);
		render(<Probe />);
		act(() => {
			focus.focused = false;
			for (const listener of focus.listeners) listener();
		});
		expect(listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		await advance(120_000);
		expect(lease.controller.checkHealth).not.toHaveBeenCalled();
		act(() => {
			focus.focused = true;
			for (const listener of focus.listeners) listener();
		});
		await advance(30_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledOnce();
	});

	it("deduplicates stalled health checks and follows them with full recovery after returning active", async () => {
		vi.useFakeTimers();
		const lease = fakeLease();
		lease.controller.getSnapshot.mockReturnValue({
			...initialSnapshot(),
			sessionId: "inner-existing",
		});
		let finish = () => {};
		lease.controller.checkHealth.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		useLease(lease);
		render(<Probe />);
		await advance(90_000);
		expect(lease.controller.checkHealth).toHaveBeenCalledOnce();
		await emit("background", "active");
		expect(lease.controller.recoverFromIdle).not.toHaveBeenCalled();
		await act(async () => finish());
		expect(lease.controller.recoverFromIdle).toHaveBeenCalledOnce();
	});
});
