// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FactoryLimits } from "@/lib/factory-limits";
import { useFactoryLimits } from "./use-factory-limits";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(
		async (_command: string, _args?: unknown): Promise<unknown> => undefined,
	),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useFactoryLimits>;
function Probe() {
	current = useFactoryLimits();
	return null;
}
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("reads the Hub's pause with the limit and keeps it while the limit changes", async () => {
	let release: (value: FactoryLimits) => void = () => {};
	mocks.invoke.mockImplementation(async (command) =>
		command === "factory_get_limits"
			? { supported: true, concurrency: 2, paused: true }
			: new Promise((resolve) => {
					release = resolve;
				}),
	);
	await act(async () => root.render(<Probe />));
	const limits: FactoryLimits | undefined = current.limits;
	// Typed: no cast is needed to read the pause.
	expect(limits?.supported === true ? limits.paused : undefined).toBe(true);

	let saving: Promise<void> = Promise.resolve();
	await act(async () => {
		saving = current.setConcurrency(4);
	});
	// The optimistic value keeps the pause the Hub reported.
	expect(current.limits).toEqual({
		supported: true,
		concurrency: 4,
		paused: true,
	});
	await act(async () => {
		release({ supported: true, concurrency: 4, paused: false });
		await saving;
	});
	expect(current.limits).toEqual({
		supported: true,
		concurrency: 4,
		paused: false,
	});
});

it("applies the daily spending limit immediately and rolls back when the Hub rejects it", async () => {
	let reject: (error: Error) => void = () => {};
	mocks.invoke.mockImplementation(async (command) =>
		command === "factory_get_limits"
			? { supported: true, concurrency: 2, dailyCostUsd: 50, spentTodayUsd: 7 }
			: new Promise((_, fail) => {
					reject = fail;
				}),
	);
	await act(async () => root.render(<Probe />));
	let saving: Promise<void> = Promise.resolve();
	await act(async () => {
		saving = current.setDailyCostUsd(null);
	});
	expect(mocks.invoke).toHaveBeenLastCalledWith("factory_set_limits", {
		dailyCostUsd: null,
	});
	// Shown before the Hub answers, keeping the other limits.
	expect(current.limits).toEqual({
		supported: true,
		concurrency: 2,
		dailyCostUsd: null,
		spentTodayUsd: 7,
	});
	expect(current.saving).toBe(true);
	await act(async () => {
		reject(new Error("Hub refused"));
		await saving;
	});
	expect(current.limits).toEqual({
		supported: true,
		concurrency: 2,
		dailyCostUsd: 50,
		spentTodayUsd: 7,
	});
	expect(current.error).toBe("Hub refused");
	expect(current.errorFor).toBe("dailyCostUsd");
	expect(current.saving).toBe(false);

	mocks.invoke.mockResolvedValueOnce({
		supported: true,
		concurrency: 2,
		dailyCostUsd: 20,
		spentTodayUsd: 7,
	});
	await act(async () => current.setDailyCostUsd(20));
	expect(current.limits).toMatchObject({ dailyCostUsd: 20 });
	expect(current.error).toBeNull();
	expect(current.errorFor).toBeNull();
});

it("does not change the daily limit before the Hub has reported limits", async () => {
	mocks.invoke.mockImplementation(async (command) =>
		command === "factory_get_limits" ? { supported: false } : undefined,
	);
	await act(async () => root.render(<Probe />));
	await act(async () => current.setDailyCostUsd(10));
	expect(mocks.invoke).not.toHaveBeenCalledWith(
		"factory_set_limits",
		expect.anything(),
	);
	expect(current.limits).toEqual({ supported: false });
});

it("reads nothing when disabled", async () => {
	function Disabled() {
		current = useFactoryLimits({ enabled: false });
		return null;
	}
	await act(async () => root.render(<Disabled />));
	expect(mocks.invoke).not.toHaveBeenCalled();
	expect(current.loading).toBe(false);
	expect(current.limits).toBeUndefined();
});
