// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fetchComposioStatus,
	getComposioStatusSnapshot,
	resetComposioCacheForTesting,
} from "./composio";
import type { ComposioStatusResponse } from "./composio-types";
import { useComposioConnections } from "./use-composio-connections";

type ConnectionAction = "connect" | "cancel" | "disconnect";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), subscribe: vi.fn() }));
vi.mock("./desktop-client", () => ({ desktopClient: mocks }));

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
function Probe({ onChanged }: { onChanged?: () => void } = {}) {
	const connections = useComposioConnections({ onChanged });
	return (
		<div>
			<output>
				{connections.status?.integrations[0]?.status ?? "loading"}
			</output>
			<button onClick={() => void connections.refresh()} type="button">
				Refresh
			</button>
			<button
				onClick={() => void connections.disconnect("gmail")}
				type="button"
			>
				Disconnect
			</button>
			<button onClick={() => void connections.connect("gmail")} type="button">
				Connect
			</button>
			<button
				onClick={() => void connections.cancelConnect("gmail")}
				type="button"
			>
				Cancel
			</button>
			<span data-action-error>{JSON.stringify(connections.actionError)}</span>
			<span data-busy>{connections.busyToolkit}</span>
			<span data-load-error>{connections.loadError}</span>
			<span data-refreshing>{String(connections.refreshing)}</span>
		</div>
	);
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	resetComposioCacheForTesting();
	vi.clearAllMocks();
	mocks.subscribe.mockReturnValue(() => {});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	resetComposioCacheForTesting();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("connector connection state across navigation", () => {
	it("shares loading and clears a failed read in every consumer when one refresh recovers", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("Connectors offline"));
		await act(async () =>
			root.render(
				<>
					<Probe />
					<Probe />
				</>,
			),
		);
		expect(
			[...container.querySelectorAll("[data-load-error]")].map(
				(node) => node.textContent,
			),
		).toEqual(["Connectors offline", "Connectors offline"]);
		const recovery = deferred<ComposioStatusResponse>();
		mocks.invoke.mockReturnValueOnce(recovery.promise);
		await act(async () => container.querySelector("button")?.click());
		expect(
			[...container.querySelectorAll("[data-refreshing]")].map(
				(node) => node.textContent,
			),
		).toEqual(["true", "true"]);
		await act(async () => recovery.resolve(status()));
		expect(
			[...container.querySelectorAll("[data-load-error]")].map(
				(node) => node.textContent,
			),
		).toEqual(["", ""]);
		expect(
			[...container.querySelectorAll("[data-refreshing]")].map(
				(node) => node.textContent,
			),
		).toEqual(["false", "false"]);
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});

	it.each<{
		operation: ConnectionAction;
		label: string;
		connection: "connected" | "not_connected" | "pending";
	}>([
		{ operation: "connect", label: "Connect", connection: "not_connected" },
		{ operation: "cancel", label: "Cancel", connection: "pending" },
		{ operation: "disconnect", label: "Disconnect", connection: "connected" },
	])("preserves the failed $operation operation and clears it on retry", async ({
		operation,
		label,
		connection,
	}) => {
		mocks.invoke.mockResolvedValueOnce(status(connection));
		await act(async () => root.render(<Probe />));
		const actionButton = [...container.querySelectorAll("button")].find(
			(entry) => entry.textContent === label,
		);
		mocks.invoke.mockRejectedValueOnce(new Error("Request was rejected"));
		await act(async () => actionButton?.click());
		expect(
			JSON.parse(
				container.querySelector("[data-action-error]")?.textContent ?? "null",
			),
		).toEqual({
			toolkit: "gmail",
			message: "Request was rejected",
		});
		expect(container.querySelector("[data-busy]")?.textContent).toBe("");
		expect(container.querySelector("output")?.textContent).toBe(connection);
		const retry = deferred<
			ComposioStatusResponse | { status: ComposioStatusResponse }
		>();
		mocks.invoke.mockReturnValueOnce(retry.promise);
		await act(async () => actionButton?.click());
		expect(container.querySelector("[data-action-error]")?.textContent).toBe(
			"null",
		);
		expect(container.querySelector("[data-busy]")?.textContent).toBe("gmail");
		await act(async () =>
			retry.resolve(
				operation === "connect"
					? { status: status("pending") }
					: status("not_connected"),
			),
		);
		expect(container.querySelector("[data-busy]")?.textContent).toBe("");
	});

	it("shows shared fresh status immediately when remounted without another request", async () => {
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () => root.render(<Probe />));
		await act(async () => root.render(null));
		act(() => root.render(<Probe />));
		expect(container.querySelector("output")?.textContent).toBe("connected");
		await act(async () => {});
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
	});

	it("keeps expired status visible during a background read and forces explicit refresh", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		mocks.invoke.mockResolvedValueOnce(status());
		await fetchComposioStatus();
		now.mockReturnValue(61_001);
		const background = deferred<ComposioStatusResponse>();
		mocks.invoke.mockReturnValueOnce(background.promise);
		await act(async () => root.render(<Probe />));
		expect(container.querySelector("output")?.textContent).toBe("connected");
		await act(async () => background.resolve(status("not_connected")));
		expect(container.querySelector("output")?.textContent).toBe(
			"not_connected",
		);
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () => container.querySelector("button")?.click());
		expect(mocks.invoke).toHaveBeenLastCalledWith("composio_integrations", {
			operation: "status",
			refresh: true,
		});
		expect(container.querySelector("output")?.textContent).toBe("connected");
	});

	it("updates all mounted consumers when a connector is disconnected", async () => {
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () =>
			root.render(
				<>
					<Probe />
					<Probe />
				</>,
			),
		);
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		mocks.invoke.mockResolvedValueOnce(status("not_connected"));
		await act(async () => container.querySelectorAll("button")[1]?.click());
		expect(
			[...container.querySelectorAll("output")].map(
				(entry) => entry.textContent,
			),
		).toEqual(["not_connected", "not_connected"]);
	});

	it("queues connector mutations instead of running them concurrently", async () => {
		mocks.invoke.mockResolvedValueOnce(status("not_connected"));
		await act(async () => root.render(<Probe />));
		const connection = deferred<{ status: ComposioStatusResponse }>();
		mocks.invoke
			.mockReturnValueOnce(connection.promise)
			.mockResolvedValueOnce(status("not_connected"));
		const buttons = [...container.querySelectorAll("button")];
		const connect = buttons.find((button) => button.textContent === "Connect");
		const disconnect = buttons.find(
			(button) => button.textContent === "Disconnect",
		);
		await act(async () => {
			connect?.click();
			disconnect?.click();
			await Promise.resolve();
		});
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		expect(container.querySelector("[data-busy]")?.textContent).toBe("gmail");
		await act(async () => connection.resolve({ status: status("pending") }));
		expect(mocks.invoke).toHaveBeenCalledTimes(3);
		expect(mocks.invoke).toHaveBeenLastCalledWith(
			"composio_integrations",
			{ operation: "disconnect", toolkit: "gmail" },
			{ timeoutMs: 60_000 },
		);
	});

	it("reports installed connector changes without treating metadata or pending refreshes as inventory changes", async () => {
		const onChanged = vi.fn();
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () => root.render(<Probe onChanged={onChanged} />));
		expect(onChanged).not.toHaveBeenCalled();
		const renamed = status();
		renamed.integrations[0].name = "Renamed Gmail";
		mocks.invoke.mockResolvedValueOnce(renamed);
		await act(async () => container.querySelector("button")?.click());
		expect(onChanged).not.toHaveBeenCalled();
		mocks.invoke.mockResolvedValueOnce(status("not_connected"));
		await act(async () => container.querySelector("button")?.click());
		expect(onChanged).toHaveBeenCalledOnce();
		mocks.invoke.mockResolvedValueOnce(status("pending"));
		await act(async () => container.querySelector("button")?.click());
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("reloads mounted consumers after settings invalidation without restoring old account data", async () => {
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () => root.render(<Probe />));
		const old = deferred<ComposioStatusResponse>();
		const current = deferred<ComposioStatusResponse>();
		mocks.invoke
			.mockReturnValueOnce(old.promise)
			.mockReturnValueOnce(current.promise);
		await act(async () => container.querySelector("button")?.click());
		await act(async () => mocks.subscribe.mock.calls[0][1]());
		expect(container.querySelector("output")?.textContent).toBe("loading");
		await act(async () => old.resolve(status()));
		expect(getComposioStatusSnapshot().status).toBeNull();
		await act(async () => current.resolve(status("not_connected")));
		expect(container.querySelector("output")?.textContent).toBe(
			"not_connected",
		);
	});

	it("polls pending OAuth connections instead of reusing the fresh pending snapshot", async () => {
		vi.useFakeTimers();
		mocks.invoke.mockResolvedValueOnce(status("pending"));
		await act(async () => root.render(<Probe />));
		mocks.invoke.mockResolvedValueOnce(status());
		await act(async () => vi.advanceTimersByTimeAsync(3_000));
		expect(container.querySelector("output")?.textContent).toBe("connected");
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		await act(async () => vi.advanceTimersByTimeAsync(3_000));
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
	});
});
