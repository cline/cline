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
	reactMock.setCommands.mockClear();
});
afterEach(() => {
	unmount();
});
describe("plugin slash command catalog lifecycle", () => {
	it("reloads when notified and keeps the last catalog when a reload fails", async () => {
		let notify = () => {};
		const stop = vi.fn();
		const load = vi
			.fn()
			.mockResolvedValueOnce(first)
			.mockRejectedValueOnce(new Error("hub unavailable"))
			.mockResolvedValueOnce(next);
		useTestSlashCommands(load, (listener) => {
			notify = listener;
			return stop;
		});
		await vi.waitFor(() =>
			expect(reactMock.setCommands).toHaveBeenLastCalledWith(first),
		);
		notify();
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
		await Promise.resolve();
		expect(reactMock.setCommands).toHaveBeenCalledTimes(1);
		notify();
		await vi.waitFor(() =>
			expect(reactMock.setCommands).toHaveBeenLastCalledWith(next),
		);
		unmount();
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("ignores an older load that resolves after a newer one", async () => {
		let notify = () => {};
		let resolveOlder!: (commands: typeof first) => void;
		const load = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOlder = resolve;
					}),
			)
			.mockResolvedValueOnce(next);
		useTestSlashCommands(load, (listener) => {
			notify = listener;
			return () => {};
		});
		notify();
		await vi.waitFor(() =>
			expect(reactMock.setCommands).toHaveBeenLastCalledWith(next),
		);
		resolveOlder(first);
		await Promise.resolve();
		expect(reactMock.setCommands).toHaveBeenCalledTimes(1);
	});
});
