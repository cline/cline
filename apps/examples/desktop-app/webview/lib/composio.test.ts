import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioStatusResponse } from "./composio-types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), subscribe: vi.fn() }));
vi.mock("./desktop-client", () => ({ desktopClient: mocks }));

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	mocks.subscribe.mockReturnValue(() => {});
});
afterEach(async () => {
	const api = await import("./composio");
	api.resetComposioCacheForTesting();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function emitDesktopEvent(name: string) {
	const callback = mocks.subscribe.mock.calls.find(
		([eventName]) => eventName === name,
	)?.[1] as (() => void) | undefined;
	expect(callback).toBeTypeOf("function");
	callback?.();
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
		expect(mocks.subscribe).toHaveBeenCalledTimes(2);
		expect(mocks.subscribe).toHaveBeenCalledWith(
			"cloud_sessions_changed",
			expect.any(Function),
		);
		mocks.invoke.mockRejectedValueOnce(new Error("offline"));
		await expect(api.fetchComposioStatus({ refresh: true })).rejects.toThrow(
			"offline",
		);
		expect(api.getComposioAvailability()).toBe(true);
		mocks.invoke.mockResolvedValueOnce({ configured: false, integrations: [] });
		await api.fetchComposioStatus({ refresh: true });
		expect(api.getComposioAvailability()).toBe(false);
	});

	it("invalidates on account changes while unmounted and ignores pre-change requests", async () => {
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
		emitDesktopEvent("cloud_sessions_changed");
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

	it("publishes mutations and later OAuth completion to persistent inventory subscribers", async () => {
		const api = await import("./composio");
		mocks.invoke.mockResolvedValueOnce(status("not_connected"));
		const onInventoryChanged = vi.fn();
		const unsubscribe =
			api.subscribeComposioInventoryChanges(onInventoryChanged);
		await api.fetchComposioStatus();
		expect(onInventoryChanged).not.toHaveBeenCalled();

		mocks.invoke.mockResolvedValueOnce({ status: status("pending") });
		await api.connectComposioIntegration("gmail");
		expect(onInventoryChanged).toHaveBeenCalledTimes(1);

		mocks.invoke.mockResolvedValueOnce(status());
		await api.fetchComposioStatus();
		expect(onInventoryChanged).toHaveBeenCalledTimes(2);
		unsubscribe();
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
		emitDesktopEvent("settings.changed");
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
		emitDesktopEvent("settings.changed");
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

	it.each([
		"before",
		"after",
	])("resumes OAuth polling when a settings refresh finishes %s connect", async (refreshCompletion) => {
		vi.useFakeTimers();
		const api = await import("./composio");
		mocks.invoke.mockResolvedValueOnce(status("not_connected"));
		api.subscribeComposioStatus(vi.fn());
		await api.fetchComposioStatus();

		const connection = deferred<{ status: ComposioStatusResponse }>();
		const replacement = deferred<ComposioStatusResponse>();
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(connection.promise)
			.mockReturnValueOnce(replacement.promise)
			.mockReturnValueOnce(recovery.promise);
		const connect = api.connectComposioIntegration("gmail");
		await Promise.resolve();
		emitDesktopEvent("settings.changed");
		const replacementRead = api.fetchComposioStatus();
		if (refreshCompletion === "before") {
			replacement.resolve(status("not_connected"));
			await replacementRead;
		}

		connection.resolve({ status: status("pending") });
		await connect;
		expect(mocks.invoke).toHaveBeenCalledTimes(4);
		expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
			operation: "status",
			refresh: true,
		});
		const recoveryRead = api.fetchComposioStatus();
		const pending = status("pending");
		recovery.resolve(pending);
		await recoveryRead;
		if (refreshCompletion === "after") {
			replacement.resolve(status("not_connected"));
			expect(await replacementRead).toBe(pending);
		}
		expect(api.getComposioStatusSnapshot().status).toBe(pending);

		mocks.invoke.mockResolvedValueOnce(status());
		await vi.advanceTimersByTimeAsync(3_000);
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("connected");
		expect(mocks.invoke).toHaveBeenCalledTimes(5);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(mocks.invoke).toHaveBeenCalledTimes(5);
	});

	it.each([
		"older-first",
		"newer-first",
	])("reconciles overlapping mutations completed %s without serializing requests", async (completionOrder) => {
		const api = await import("./composio");
		const both = (
			gmail: "connected" | "not_connected",
			github: "connected" | "not_connected",
		) => ({
			configured: true,
			integrations: [
				...status(gmail).integrations,
				...status(github).integrations.map((integration) => ({
					...integration,
					toolkit: "github",
				})),
			],
		});
		const older = deferred<ComposioStatusResponse>();
		const newer = deferred<ComposioStatusResponse>();
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockResolvedValueOnce(both("connected", "connected"))
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise)
			.mockReturnValueOnce(recovery.promise);
		await api.fetchComposioStatus();
		const first = api.disconnectComposioIntegration("gmail");
		const second = api.disconnectComposioIntegration("github");
		await Promise.resolve();
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
		const finalStatus = both("not_connected", "not_connected");
		if (completionOrder === "older-first") {
			older.resolve(both("not_connected", "connected"));
			await first;
			expect(mocks.invoke).toHaveBeenCalledTimes(3);
			newer.resolve(finalStatus);
			await second;
		} else {
			newer.resolve(both("connected", "not_connected"));
			await second;
			older.resolve(finalStatus);
			await first;
		}
		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
				operation: "status",
				refresh: true,
			}),
		);
		const read = api.fetchComposioStatus();
		recovery.resolve(finalStatus);
		expect(await read).toBe(finalStatus);
		expect(api.getComposioStatusSnapshot().status).toBe(finalStatus);
		expect(mocks.invoke).toHaveBeenCalledTimes(4);
	});

	it("keeps completed mutations successful when overlap recovery fails and permits retry", async () => {
		const api = await import("./composio");
		const older = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(older.promise)
			.mockResolvedValueOnce(status())
			.mockRejectedValueOnce(new Error("offline"));
		const first = api.disconnectComposioIntegration("gmail");
		await api.disconnectComposioIntegration("github");
		const finalStatus = status("not_connected");
		older.resolve(finalStatus);
		await expect(first).resolves.toBe(finalStatus);
		expect(api.getComposioStatusSnapshot().error).toBe("offline");
		mocks.invoke.mockResolvedValueOnce(finalStatus);
		await api.fetchComposioStatus({ refresh: true });
		expect(api.getComposioStatusSnapshot()).toEqual({
			status: finalStatus,
			loading: false,
			error: null,
		});
	});

	it("reads current account status instead of publishing an old mutation response", async () => {
		const api = await import("./composio");
		const mutation = deferred<ComposioStatusResponse>();
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(mutation.promise)
			.mockReturnValueOnce(recovery.promise);
		const change = api.disconnectComposioIntegration("gmail");
		await Promise.resolve();
		emitDesktopEvent("cloud_sessions_changed");
		mutation.resolve(status("not_connected"));
		await change;
		expect(api.getComposioStatusSnapshot().status).toBeNull();
		expect(api.getComposioAvailability()).toBeNull();
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		const current = { configured: false, integrations: [] };
		const read = api.fetchComposioStatus();
		recovery.resolve(current);
		await read;
		expect(api.getComposioStatusSnapshot().status).toBe(current);
		expect(api.getComposioAvailability()).toBe(false);
	});

	it("lets a newer mutation publish after an invalidated mutation finishes", async () => {
		const api = await import("./composio");
		const connection = deferred<{ status: ComposioStatusResponse }>();
		const cancellation = deferred<ComposioStatusResponse>();
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(connection.promise)
			.mockReturnValueOnce(cancellation.promise)
			.mockReturnValueOnce(recovery.promise);
		const connect = api.connectComposioIntegration("gmail");
		await Promise.resolve();
		emitDesktopEvent("settings.changed");
		const cancel = api.cancelComposioConnect("gmail");
		const read = api.fetchComposioStatus();
		connection.resolve({ status: status("pending") });
		await connect;
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		const cancelled = status("not_connected");
		cancellation.resolve(cancelled);
		await cancel;
		expect(await read).toBe(cancelled);
		expect(api.getComposioStatusSnapshot().status).toBe(cancelled);
		const recoveryRead = api.fetchComposioStatus();
		recovery.resolve(cancelled);
		await recoveryRead;
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
	});

	it.each([
		false,
		true,
	])("recovers a superseded connection after a newer mutation fails (invalidated: %s)", async (invalidated) => {
		vi.useFakeTimers();
		const api = await import("./composio");
		const connection = deferred<{ status: ComposioStatusResponse }>();
		const cancellation = deferred<ComposioStatusResponse>();
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(connection.promise)
			.mockReturnValueOnce(cancellation.promise)
			.mockReturnValueOnce(recovery.promise);
		const connect = api.connectComposioIntegration("gmail");
		await Promise.resolve();
		if (invalidated) emitDesktopEvent("settings.changed");
		const cancel = api.cancelComposioConnect("gmail");
		connection.resolve({ status: status("pending") });
		await connect;
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		cancellation.reject(new Error("cancel failed"));
		await expect(cancel).rejects.toThrow("cancel failed");
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
		const recoveryRead = api.fetchComposioStatus();
		const pending = status("pending");
		recovery.resolve(pending);
		await recoveryRead;
		expect(api.getComposioStatusSnapshot().status).toBe(pending);
		mocks.invoke.mockResolvedValueOnce(status());
		await vi.advanceTimersByTimeAsync(3_000);
		expect(
			api.getComposioStatusSnapshot().status?.integrations[0]?.status,
		).toBe("connected");
	});

	it("keeps a successful mutation successful when its recovery read fails", async () => {
		const api = await import("./composio");
		const connection = deferred<{ status: ComposioStatusResponse }>();
		mocks.invoke
			.mockReturnValueOnce(connection.promise)
			.mockRejectedValueOnce(new Error("offline"));
		const connect = api.connectComposioIntegration("gmail");
		await Promise.resolve();
		emitDesktopEvent("settings.changed");
		const result = { status: status("pending") };
		connection.resolve(result);
		await expect(connect).resolves.toBe(result);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		expect(api.getComposioStatusSnapshot()).toEqual({
			status: null,
			loading: false,
			error: "offline",
		});
	});
});
