// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	disconnectComposioIntegration,
	fetchComposioStatus,
	resetComposioCacheForTesting,
} from "@/lib/composio";
import type { ComposioStatusResponse } from "@/lib/composio-types";
import { subscribeToExtensionInventoryInvalidation } from "@/lib/extension-inventory";
import {
	type ConnectorResults,
	useConnectorResults,
} from "./use-connector-results";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
}));
vi.mock("../navigation/customize-category-filter", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../navigation/customize-category-filter")
	>()),
	useCustomizeCategoryFilter: () => null,
}));

const status: ComposioStatusResponse = {
	configured: true,
	integrations: [
		{
			toolkit: "gmail",
			name: "Gmail",
			description: "Email",
			recommended: true,
			status: "pending",
		},
	],
};
const catalog = {
	configured: true,
	toolkits: [
		{
			slug: "gmail",
			name: "Gmail",
			description: "Email",
			categories: ["Communication"],
		},
		{
			slug: "slack",
			name: "Slack",
			description: "Team messages",
			categories: ["Communication"],
		},
	],
};

let root: Root;
let container: HTMLDivElement;
let installed: ConnectorResults;
let available: ConnectorResults;
function Models() {
	installed = useConnectorResults({
		variant: "installed",
		searchQuery: "communication",
		searchResults: true,
	});
	available = useConnectorResults({
		searchQuery: "communication",
		searchResults: true,
		excludeConnected: true,
	});
	return null;
}

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	resetComposioCacheForTesting();
	mocks.invoke
		.mockReset()
		.mockImplementation((_command, args) =>
			Promise.resolve(args.operation === "status" ? status : catalog),
		);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	resetComposioCacheForTesting();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("resolves installed and available counts without rendering connector cards", async () => {
	await act(async () => root.render(<Models />));
	expect(installed.summary).toEqual({
		query: "communication",
		count: 1,
		loading: false,
		error: false,
	});
	expect(available.summary).toEqual({
		query: "communication",
		count: 1,
		loading: false,
		error: false,
	});
	expect(installed.matchingInstalled.map((entry) => entry.slug)).toEqual([
		"gmail",
	]);
	expect(available.matchingCatalog.map((entry) => entry.slug)).toEqual([
		"slack",
	]);
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("clears a failed availability read in both result models when another consumer recovers", async () => {
	mocks.invoke.mockRejectedValueOnce(new Error("Connectors offline"));
	await act(async () => root.render(<Models />));
	expect(installed.summary.error).toBe(true);
	expect(available.summary.error).toBe(true);
	await act(async () => {
		await fetchComposioStatus({ refresh: true });
	});
	expect(installed.loadError).toBeNull();
	expect(available.loadError).toBeNull();
	expect(available.summary).toEqual({
		query: "communication",
		count: 1,
		loading: false,
		error: false,
	});
});

it("refreshes extension inventory when the last connector disappears without a result renderer", async () => {
	await act(async () => root.render(<Models />));
	const invalidated = vi.fn();
	const unsubscribe = subscribeToExtensionInventoryInvalidation(invalidated);
	const disconnected = { configured: true, integrations: [] };
	mocks.invoke.mockImplementation((_command, args) =>
		Promise.resolve(args.operation === "listToolkits" ? catalog : disconnected),
	);
	await act(async () => {
		await disconnectComposioIntegration("gmail");
	});
	expect(installed.summary.count).toBe(0);
	expect(available.summary.count).toBe(2);
	expect(invalidated).toHaveBeenCalledOnce();
	// The mutation already publishes the complete shared status, so its
	// inventory invalidation must not duplicate the status request.
	expect(
		mocks.invoke.mock.calls.filter(([, args]) => args.operation === "status"),
	).toHaveLength(1);
	unsubscribe();
});

it("keeps one OAuth poller active for result models without mounted connector cards", async () => {
	vi.useFakeTimers();
	await act(async () => root.render(<Models />));
	const connected = {
		...status,
		integrations: status.integrations.map((entry) => ({
			...entry,
			status: "connected",
		})),
	};
	mocks.invoke.mockImplementation((_command, args) =>
		Promise.resolve(args.operation === "listToolkits" ? catalog : connected),
	);
	await act(async () => vi.advanceTimersByTimeAsync(3_000));
	expect(installed.status?.integrations[0]?.status).toBe("connected");
	expect(available.status?.integrations[0]?.status).toBe("connected");
	const calls = mocks.invoke.mock.calls.length;
	await act(async () => vi.advanceTimersByTimeAsync(6_000));
	expect(mocks.invoke).toHaveBeenCalledTimes(calls);
});
