import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), subscribe: vi.fn() }));
vi.mock("./desktop-client", () => ({ desktopClient: mocks }));

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.subscribe.mockReturnValue(() => {});
});

describe("connector availability cache", () => {
	it("retains availability across mounts and transient refresh failures", async () => {
		const api = await import("./composio");
		const unsubscribe = api.subscribeComposioAvailability(vi.fn());
		mocks.invoke.mockResolvedValueOnce({ configured: true, integrations: [] });
		await api.fetchComposioStatus();
		unsubscribe();
		api.subscribeComposioAvailability(vi.fn());
		expect(api.getComposioAvailability()).toBe(true);
		expect(mocks.subscribe).toHaveBeenCalledTimes(1);
		mocks.invoke.mockRejectedValueOnce(new Error("offline"));
		await expect(api.fetchComposioStatus()).rejects.toThrow("offline");
		expect(api.getComposioAvailability()).toBe(true);
		mocks.invoke.mockResolvedValueOnce({ configured: false, integrations: [] });
		await api.fetchComposioStatus();
		expect(api.getComposioAvailability()).toBe(false);
	});

	it("invalidates while unmounted and ignores pre-change requests", async () => {
		const api = await import("./composio");
		const unsubscribe = api.subscribeComposioAvailability(vi.fn());
		mocks.invoke.mockResolvedValueOnce({ configured: true, integrations: [] });
		await api.fetchComposioStatus();
		unsubscribe();
		let complete!: (value: unknown) => void;
		mocks.invoke.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const stale = api.fetchComposioStatus();
		mocks.subscribe.mock.calls[0][1]();
		expect(api.getComposioAvailability()).toBeNull();
		complete({ configured: true, integrations: [] });
		await stale;
		expect(api.getComposioAvailability()).toBeNull();
	});
});
