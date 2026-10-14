import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSlashCommands } from "./use-slash-commands";

const reactMock = vi.hoisted(() => ({
	cleanups: [] as Array<() => void>,
	setCommands: vi.fn(),
}));
vi.mock("react", () => ({
	useState: (initial: unknown) => [initial, reactMock.setCommands],
	useMemo: (compute: () => unknown) => compute(),
	useEffect: (effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (cleanup) reactMock.cleanups.push(cleanup);
	},
}));
const first = [{ name: "first", description: "First", instructions: "" }];
const next = [{ name: "next", description: "Next", instructions: "" }];
function useTestSlashCommands(
	load: NonNullable<
		Parameters<typeof useSlashCommands>[0]["loadAdditionalSlashCommands"]
	>,
	subscribe?: Parameters<
		typeof useSlashCommands
	>[0]["subscribeAdditionalSlashCommands"],
) {
	useSlashCommands({
		workflowSlashCommands: [],
		loadAdditionalSlashCommands: load,
		subscribeAdditionalSlashCommands: subscribe,
		canFork: false,
	});
}
function unmount() {
	for (const cleanup of reactMock.cleanups.splice(0)) cleanup();
}
beforeEach(() => {
	vi.useFakeTimers();
	reactMock.setCommands.mockClear();
});
afterEach(() => {
	unmount();
	vi.useRealTimers();
});
describe("plugin slash command catalog lifecycle", () => {
	it("retries a failed subscription and receives updates after recovery", async () => {
		let listener = () => {};
		const stop = vi.fn();
		const load = vi.fn().mockResolvedValue(first);
		const subscribe = vi
			.fn()
			.mockRejectedValueOnce(new Error("startup failed"))
			.mockImplementation(async (refresh) => {
				listener = refresh;
				return stop;
			});
		useTestSlashCommands(load, subscribe);
		await vi.advanceTimersByTimeAsync(0);
		expect(subscribe).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(subscribe).toHaveBeenCalledTimes(2);
		load.mockResolvedValue(next);
		listener();
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(next);
		unmount();
		expect(stop).toHaveBeenCalledTimes(1);
	});
	it("retains the loaded catalog during a failed refresh and retries without an event", async () => {
		let listener = () => {};
		const load = vi.fn().mockResolvedValue(first);
		useTestSlashCommands(load, async (refresh) => {
			listener = refresh;
			return () => {};
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(first);
		const successfulUpdates = reactMock.setCommands.mock.calls.length;
		load
			.mockRejectedValueOnce(new Error("connection lost"))
			.mockResolvedValue(next);
		listener();
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenCalledTimes(successfulUpdates);
		await vi.advanceTimersByTimeAsync(1000);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(next);
	});
	it("backs off refresh retries and cancels retries on unmount", async () => {
		const load = vi.fn().mockRejectedValue(new Error("offline"));
		useTestSlashCommands(load);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1000);
		expect(load).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1999);
		expect(load).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(load).toHaveBeenCalledTimes(3);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(load).toHaveBeenCalledTimes(3);
	});
	it("cancels failed subscription retries on unmount", async () => {
		const load = vi.fn().mockResolvedValue(first);
		const subscribe = vi.fn().mockRejectedValue(new Error("offline"));
		useTestSlashCommands(load, subscribe);
		await vi.advanceTimersByTimeAsync(0);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(subscribe).toHaveBeenCalledTimes(1);
	});
	it("stops a subscription that resolves after unmount", async () => {
		let resolve!: (stop: () => void) => void;
		const pending = new Promise<() => void>((done) => {
			resolve = done;
		});
		const stop = vi.fn();
		useTestSlashCommands(vi.fn().mockResolvedValue(first), () => pending);
		unmount();
		resolve(stop);
		await vi.advanceTimersByTimeAsync(0);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(reactMock.setCommands).not.toHaveBeenCalled();
	});
	it("ignores an older refresh that resolves after the subscribed catalog", async () => {
		let resolve!: (commands: typeof first) => void;
		const pending = new Promise<typeof first>((done) => {
			resolve = done;
		});
		const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(next);
		useTestSlashCommands(load, async () => () => {});
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(next);
		resolve(first);
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenCalledTimes(1);
	});

	it("publishes the initial catalog while the subscription refresh stalls", async () => {
		let resolve!: (commands: typeof first) => void;
		const initial = new Promise<typeof first>((done) => {
			resolve = done;
		});
		const stalled = new Promise<typeof first>(() => {});
		const load = vi
			.fn()
			.mockReturnValueOnce(initial)
			.mockReturnValueOnce(stalled);
		useTestSlashCommands(load, async () => () => {});
		await vi.advanceTimersByTimeAsync(0);
		expect(load).toHaveBeenCalledTimes(2);
		resolve(first);
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(first);
	});

	it("keeps an initial success when the subscription refresh fails and retries", async () => {
		let resolve!: (commands: typeof first) => void;
		const initial = new Promise<typeof first>((done) => {
			resolve = done;
		});
		const load = vi
			.fn()
			.mockReturnValueOnce(initial)
			.mockRejectedValueOnce(new Error("refresh failed"))
			.mockResolvedValue(next);
		useTestSlashCommands(load, async () => () => {});
		await vi.advanceTimersByTimeAsync(0);
		resolve(first);
		await vi.advanceTimersByTimeAsync(0);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(first);
		await vi.advanceTimersByTimeAsync(1000);
		expect(reactMock.setCommands).toHaveBeenLastCalledWith(next);
	});
});
