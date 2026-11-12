import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioStatusResponse } from "./composio-types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), subscribe: vi.fn() }));
vi.mock("./desktop-client", () => ({ desktopClient: mocks }));

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.subscribe.mockReturnValue(() => {});
});
afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function status(
	connection: "connected" | "not_connected" | "pending" = "connected",
): ComposioStatusResponse {
	return {
		configured: true,
		integrations: [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Email",
				recommended: true,
				status: connection,
			},
		],
	};
}

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
		await expect(api.fetchComposioStatus({ refresh: true })).rejects.toThrow(
			"offline",
		);
		expect(api.getComposioAvailability()).toBe(true);
		mocks.invoke.mockResolvedValueOnce({ configured: false, integrations: [] });
		await api.fetchComposioStatus({ refresh: true });
		expect(api.getComposioAvailability()).toBe(false);
	});

	it("invalidates while unmounted and ignores pre-change requests", async () => {
		const api = await import("./composio");
		const unsubscribe = api.subscribeComposioAvailability(vi.fn());
		mocks.invoke.mockResolvedValueOnce({ configured: true, integrations: [] });
		await api.fetchComposioStatus();
		unsubscribe();
		const oldAccount = deferred<ComposioStatusResponse>();
		const currentAccount = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(oldAccount.promise)
			.mockReturnValueOnce(currentAccount.promise);
		const stale = api.fetchComposioStatus({ refresh: true });
		mocks.subscribe.mock.calls[0][1]();
		expect(api.getComposioAvailability()).toBeNull();
		oldAccount.resolve(status());
		await Promise.resolve();
		const current = { configured: false, integrations: [] };
		currentAccount.resolve(current);
		expect(await stale).toBe(current);
		expect(api.getComposioAvailability()).toBe(false);
	});
});

describe("shared connector data cache", () => {
	it("reconciles remote connections on a cold read and then reuses fresh status", async () => {
		const api = await import("./composio");
		mocks.invoke.mockResolvedValueOnce(status());
		const first = await api.fetchComposioStatus({ refresh: false });
		expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
			"composio_integrations",
			{ operation: "status", refresh: true },
		);
		expect(await api.fetchComposioStatus()).toBe(first);
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
	});

	it("deduplicates reads, reuses fresh status, and retains expired status during revalidation", async () => {
		const api = await import("./composio");
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const first = deferred<ComposioStatusResponse>();
		mocks.invoke.mockReturnValueOnce(first.promise);
		const read = api.fetchComposioStatus();
		expect(api.fetchComposioStatus()).toBe(read);
		first.resolve(status());
		await read;
		expect(await api.fetchComposioStatus()).toBe(
			api.getComposioStatusSnapshot().status,
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		now.mockReturnValue(61_001);
		const second = deferred<ComposioStatusResponse>();
		mocks.invoke.mockReturnValueOnce(second.promise);
		const revalidation = api.fetchComposioStatus();
		expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
			operation: "status",
			refresh: true,
		});
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("connected");
		second.resolve(status("not_connected"));
		await revalidation;
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("not_connected");
	});

	it("forces explicit refreshes and prevents an older ordinary read from replacing them", async () => {
		const api = await import("./composio");
		mocks.invoke.mockResolvedValueOnce(status("pending"));
		await api.fetchComposioStatus();
		const ordinary = deferred<ComposioStatusResponse>();
		const forced = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(ordinary.promise)
			.mockReturnValueOnce(forced.promise);
		const read = api.fetchComposioStatus();
		const refresh = api.fetchComposioStatus({ refresh: true });
		expect(api.fetchComposioStatus({ refresh: true })).toBe(refresh);
		const refreshed = status("not_connected");
		forced.resolve(refreshed);
		await refresh;
		ordinary.resolve(status());
		expect(await read).toBe(refreshed);
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("not_connected");
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
		expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
			operation: "status",
			refresh: true,
		});
	});

	it("keeps polling pending OAuth status inside the freshness window", async () => {
		const api = await import("./composio");
		mocks.invoke
			.mockResolvedValueOnce(status("pending"))
			.mockResolvedValueOnce(status());
		await api.fetchComposioStatus();
		await api.fetchComposioStatus();
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
			operation: "status",
			refresh: false,
		});
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("connected");
	});

	it("shares catalog reads and invalidates status and catalog caches on settings changes", async () => {
		const api = await import("./composio");
		const catalog = { configured: true, toolkits: [] };
		const first = deferred<typeof catalog>();
		mocks.invoke.mockReturnValueOnce(first.promise);
		const read = api.fetchComposioToolkitCatalog();
		expect(api.fetchComposioToolkitCatalog()).toBe(read);
		first.resolve(catalog);
		await read;
		expect(await api.fetchComposioToolkitCatalog()).toBe(catalog);
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		mocks.invoke.mockResolvedValueOnce(status());
		await api.fetchComposioStatus();
		mocks.subscribe.mock.calls[0][1]();
		expect(api.getComposioStatusSnapshot().status).toBeNull();
		const current = { configured: false, toolkits: [] };
		mocks.invoke.mockResolvedValueOnce(current);
		expect(await api.fetchComposioToolkitCatalog()).toBe(current);
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
	});

	it("rejects old-account catalog completion during revalidation", async () => {
		const api = await import("./composio");
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const catalog = { configured: true, toolkits: [] };
		mocks.invoke.mockResolvedValueOnce(catalog);
		await api.fetchComposioToolkitCatalog();
		now.mockReturnValue(3_601_001);
		const next = deferred<typeof catalog>();
		mocks.invoke.mockReturnValueOnce(next.promise);
		const read = api.fetchComposioToolkitCatalog();
		mocks.subscribe.mock.calls[0][1]();
		const current = {
			configured: false,
			toolkits: [
				{ slug: "current", name: "Current account", recommended: false },
			],
		};
		const replacement = deferred<typeof current>();
		mocks.invoke.mockReturnValueOnce(replacement.promise);
		next.resolve(catalog);
		await Promise.resolve();
		replacement.resolve(current);
		expect(await read).toBe(current);
		expect(await api.fetchComposioToolkitCatalog()).toBe(current);
	});

	it.each([
		"connect",
		"cancel",
		"disconnect",
	])("publishes %s mutation status to reads begun before or during it", async (operation) => {
		const api = await import("./composio");
		const before = deferred<ComposioStatusResponse>();
		const mutation = deferred<unknown>();
		mocks.invoke
			.mockReturnValueOnce(before.promise)
			.mockReturnValueOnce(mutation.promise);
		const beforeRead = api.fetchComposioStatus();
		const change =
			operation === "connect"
				? api.connectComposioIntegration("gmail")
				: operation === "cancel"
					? api.cancelComposioConnect("gmail")
					: api.disconnectComposioIntegration("gmail");
		const duringRead = api.fetchComposioStatus();
		const next = status("not_connected");
		mutation.resolve(operation === "connect" ? { status: next } : next);
		await change;
		before.resolve(status());
		const [beforeResult, duringResult] = await Promise.all([
			beforeRead,
			duringRead,
		]);
		expect(beforeResult).toBe(next);
		expect(duringResult).toBe(next);
		expect(api.getComposioStatusSnapshot().status).toBe(next);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it("does not publish a mutation response after an account/settings change", async () => {
		const api = await import("./composio");
		const mutation = deferred<ComposioStatusResponse>();
		mocks.invoke.mockReturnValueOnce(mutation.promise);
		const change = api.disconnectComposioIntegration("gmail");
		mocks.subscribe.mock.calls[0][1]();
		mutation.resolve(status("not_connected"));
		await change;
		expect(api.getComposioStatusSnapshot().status).toBeNull();
		expect(api.getComposioAvailability()).toBeNull();
	});
});
