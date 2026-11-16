// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), invoke: vi.fn() }));
vi.mock("./marketplace", () => ({
	fetchMarketplaceCatalog: mocks.catalog,
	getCachedMarketplaceCatalog: () => null,
}));
vi.mock("./desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
}));

import type { MarketplaceEntry } from "./marketplace";
import { clearMarketplaceInstalledEntries } from "./marketplace-installed";
import {
	MarketplaceActionsProvider,
	useMarketplaceDirectory,
} from "./use-marketplace-directory";

const entry: MarketplaceEntry = {
	id: "example",
	type: "skill",
	name: "Example skill",
	tagline: "An example",
	description: "An example skill",
	tags: [],
	install: { command: "", args: ["example/skill"] },
};

function Consumer({ name }: { name: string }) {
	const directory = useMarketplaceDirectory();
	const state = directory.actionStates.get("skill:example");
	return (
		<section data-consumer={name}>
			<button type="button" onClick={() => void directory.install(entry)}>
				Install
			</button>
			<button type="button" onClick={() => void directory.uninstall(entry)}>
				Uninstall
			</button>
			<button
				type="button"
				onClick={() => directory.removeInstalledKeys(["skill:example"])}
			>
				Reconcile removed files
			</button>
			<output
				data-operation={
					state?.status === "failed" ? state.operation : undefined
				}
			>
				{state?.status ?? "idle"}
				{state && "message" in state ? `: ${state.message}` : ""}
			</output>
			<span>
				{directory.installedKeys.has("skill:example") ? "installed" : "absent"}
			</span>
		</section>
	);
}

function Customize({ detailKey }: { detailKey?: string }) {
	return (
		<MarketplaceActionsProvider>
			<Consumer name="browse" />
			{detailKey ? <Consumer key={detailKey} name="detail" /> : null}
		</MarketplaceActionsProvider>
	);
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	clearMarketplaceInstalledEntries();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	mocks.catalog.mockReset().mockResolvedValue({ entries: [entry], tags: [] });
	mocks.invoke.mockReset().mockResolvedValue({ installedKeys: [] });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function consumer(name: string) {
	return container.querySelector(`[data-consumer="${name}"]`);
}
function installCalls() {
	return mocks.invoke.mock.calls.filter(
		([command]) => command === "install_marketplace_entry",
	);
}

it("shares pending actions and failures when opening and remounting details", async () => {
	let rejectInstall!: (error: Error) => void;
	const pending = new Promise((_resolve, reject) => {
		rejectInstall = reject;
	});
	mocks.invoke.mockImplementation((command: string) =>
		command === "install_marketplace_entry"
			? pending
			: Promise.resolve({ installedKeys: [] }),
	);
	await act(async () => root.render(<Customize />));
	await act(async () => consumer("browse")?.querySelector("button")?.click());
	await act(async () => root.render(<Customize detailKey="first" />));
	expect(consumer("browse")?.querySelector("output")?.textContent).toBe(
		"installing",
	);
	expect(consumer("detail")?.querySelector("output")?.textContent).toBe(
		"installing",
	);
	await act(async () => consumer("detail")?.querySelector("button")?.click());
	await act(async () => root.render(<Customize detailKey="remounted" />));
	await act(async () => consumer("detail")?.querySelector("button")?.click());
	expect(installCalls()).toHaveLength(1);
	await act(async () => rejectInstall(new Error("Install failed")));
	for (const name of ["browse", "detail"]) {
		expect(consumer(name)?.querySelector("output")?.textContent).toBe(
			"failed: Install failed",
		);
		expect(consumer(name)?.querySelector("output")?.dataset.operation).toBe(
			"install",
		);
	}
	await act(async () => root.render(<Customize />));
	await act(async () => root.render(<Customize detailKey="after-failure" />));
	expect(consumer("detail")?.querySelector("output")?.textContent).toBe(
		"failed: Install failed",
	);
});

it("preserves the failed uninstall operation when inventory changes and details remount", async () => {
	mocks.invoke.mockImplementation((command: string) =>
		command === "uninstall_marketplace_entry"
			? Promise.reject(new Error("Source is unavailable"))
			: Promise.resolve({ installedKeys: ["skill:example"] }),
	);
	await act(async () => root.render(<Customize />));
	await act(async () =>
		[...(consumer("browse")?.querySelectorAll("button") ?? [])]
			.find((button) => button.textContent === "Uninstall")
			?.click(),
	);
	await act(async () =>
		[...(consumer("browse")?.querySelectorAll("button") ?? [])]
			.find((button) => button.textContent === "Reconcile removed files")
			?.click(),
	);
	await act(async () => root.render(<Customize detailKey="after-failure" />));
	expect(consumer("browse")?.querySelector("span")?.textContent).toBe("absent");
	for (const name of ["browse", "detail"]) {
		expect(consumer(name)?.querySelector("output")?.textContent).toBe(
			"failed: Source is unavailable",
		);
		expect(consumer(name)?.querySelector("output")?.dataset.operation).toBe(
			"uninstall",
		);
	}
});

it("finishes a detail action after returning to Browse without starting it twice", async () => {
	let finishInstall!: (result: { status: string; message: string }) => void;
	const pending = new Promise((resolve) => {
		finishInstall = resolve;
	});
	mocks.invoke.mockImplementation((command: string) =>
		command === "install_marketplace_entry"
			? pending
			: Promise.resolve({ installedKeys: [] }),
	);
	await act(async () => root.render(<Customize detailKey="first" />));
	await act(async () => consumer("detail")?.querySelector("button")?.click());
	await act(async () => root.render(<Customize />));
	expect(consumer("browse")?.querySelector("output")?.textContent).toBe(
		"installing",
	);
	await act(async () => consumer("browse")?.querySelector("button")?.click());
	expect(installCalls()).toHaveLength(1);
	await act(async () =>
		finishInstall({ status: "installed", message: "Skill added." }),
	);
	expect(consumer("browse")?.querySelector("output")?.textContent).toBe(
		"installed: Skill added.",
	);
	expect(consumer("browse")?.querySelector("span")?.textContent).toBe(
		"installed",
	);
	await act(async () =>
		root.render(<Customize detailKey="after-completion" />),
	);
	expect(consumer("detail")?.querySelector("output")?.textContent).toBe(
		"installed: Skill added.",
	);
	expect(consumer("detail")?.querySelector("span")?.textContent).toBe(
		"installed",
	);
});
