// @vitest-environment jsdom
import { act, type ComponentProps, useEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
	ComposioCatalogResponse,
	ComposioIntegrationSummary,
} from "@/lib/composio-types";
import type { CustomizationTopic } from "../navigation/customize-category-filter";

const mocks = vi.hoisted(() => ({
	integrations: [] as ComposioIntegrationSummary[],
	configured: true,
	statusMissing: false,
	catalog: vi.fn(),
	cachedCatalog: null as ComposioCatalogResponse | null,
	connect: vi.fn(),
	disconnect: vi.fn(),
	cancel: vi.fn(),
	refresh: vi.fn(),
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
	loadError: null as string | null,
	actionError: null as {
		toolkit: string;
		operation: "connect" | "cancel" | "disconnect";
		message: string;
	} | null,
	busyToolkit: null as string | null,
	category: null as CustomizationTopic | null,
	setCategory: vi.fn(),
	categories: [] as CustomizationTopic[],
}));
vi.mock("../navigation/customize-category-filter", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../navigation/customize-category-filter")
	>()),
	useCustomizeCategoryFilter: () => ({
		category: mocks.category,
		categories: mocks.categories,
		setCategory: mocks.setCategory,
	}),
}));
vi.mock("@/lib/use-composio-status", () => ({
	useComposioStatus: () => {
		const integrations = mocks.integrations;
		const configured = mocks.configured;
		// biome-ignore lint/correctness/useExhaustiveDependencies: Tests replace fixtures between renders while catalog updates preserve status identity.
		const status = useMemo(
			() => ({ integrations, configured }),
			[integrations, configured],
		);
		return {
			status: mocks.statusMissing ? null : status,
			loading: false,
			error: mocks.loadError,
			refresh: mocks.refresh,
		};
	},
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: (
			command: string,
			args: { operation?: string },
			options?: unknown,
		) =>
			command === "composio_integrations" && args.operation === "listToolkits"
				? mocks.catalog()
				: mocks.invoke(command, args, options),
		subscribe: () => () => {},
	},
	openExternalUrl: mocks.openExternalUrl,
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	invalidateProviderCatalogCache: () => {},
}));
vi.mock("@/lib/use-composio-connections", () => ({
	useComposioConnections: () => {
		const integrations = mocks.integrations;
		// biome-ignore lint/correctness/useExhaustiveDependencies: Tests replace mocked integrations; keep status stable across catalog-only renders.
		const status = useMemo(() => ({ integrations }), [integrations]);
		return {
			configured: mocks.configured,
			status: mocks.statusMissing ? null : status,
			statusBySlug: new Map(
				mocks.integrations.map((integration) => [
					integration.toolkit,
					integration,
				]),
			),
			connect: mocks.connect,
			disconnect: mocks.disconnect,
			cancelConnect: mocks.cancel,
			refresh: mocks.refresh,
			refreshing: false,
			loadError: mocks.loadError,
			actionError: mocks.actionError,
			busyToolkit: mocks.busyToolkit,
		};
	},
}));

import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { AccountProvider } from "@/contexts/account-context";
import {
	fetchComposioToolkitCatalog,
	invalidateComposioCache,
	resetComposioCacheForTesting,
} from "@/lib/composio";
import { invalidateExtensionInventoryCache } from "@/lib/extension-inventory";
import { applyHubTheme } from "@/lib/theme";
import { CustomizationCategoryNavigationProvider } from "../shared/customization-category-section";
import {
	CustomizeRefreshButton,
	CustomizeRefreshProvider,
} from "../shared/customize-refresh";
import {
	ConnectorCatalogView,
	InstalledConnectorsView,
} from "./composio-connectors-view";
import { useConnectorResults } from "./use-connector-results";

type ConnectorsProps = {
	variant?: "catalog" | "installed";
	searchQuery?: string;
	searchResults?: boolean;
	/** Search lists only what is left to connect. */
	excludeConnected?: boolean;
	onSummary?: (
		summary: ReturnType<typeof useConnectorResults>["summary"],
	) => void;
} & Pick<
	ComponentProps<typeof ConnectorCatalogView>,
	"catalogHeader" | "catalogPreview" | "renderItem"
> &
	Pick<
		ComponentProps<typeof InstalledConnectorsView>,
		"onViewAll" | "previewLimit" | "itemOffset"
	>;

/** Resolves the results first, as Browse, Manage and search do, and shows a test their summary. */
function Connectors({
	variant = "catalog",
	excludeConnected,
	onSummary,
	...props
}: ConnectorsProps) {
	const model = useConnectorResults({
		searchQuery: props.searchQuery,
		searchResults: props.searchResults,
		excludeConnected,
		variant,
	});
	const { query, count, loading, error } = model.summary;
	useEffect(() => {
		onSummary?.({ query, count, loading, error });
	}, [onSummary, query, count, loading, error]);
	return variant === "installed" ? (
		<InstalledConnectorsView {...props} model={model} />
	) : (
		<ConnectorCatalogView {...props} model={model} />
	);
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	resetComposioCacheForTesting();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.clearAllMocks();
	mocks.loadError = null;
	mocks.actionError = null;
	mocks.busyToolkit = null;
	mocks.category = null;
	mocks.categories = [];
	mocks.configured = true;
	mocks.statusMissing = false;
	mocks.cachedCatalog = null;
	mocks.catalog.mockResolvedValue({ configured: true, toolkits: [] });
	mocks.integrations = [
		{
			toolkit: "gmail",
			name: "Gmail",
			description: "Email",
			recommended: true,
			status: "connected",
		},
	];
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	resetComposioCacheForTesting();
	vi.restoreAllMocks();
	container.remove();
	vi.unstubAllGlobals();
});
function button(text: string) {
	return [...document.querySelectorAll("button")].find(
		(entry) =>
			entry.textContent?.trim() === text ||
			entry.getAttribute("aria-label") === text,
	);
}
/** The detail dialog repeats the card's Connect, so look inside the dialog. */
function dialogButton(text: string) {
	return [...document.querySelectorAll('[role="dialog"] button')].find(
		(entry) => entry.textContent?.trim() === text,
	) as HTMLButtonElement | undefined;
}
function confirmationButton(label: string) {
	const dialog = document.querySelector('[role="alertdialog"]');
	if (!dialog) throw new Error("Expected disconnect confirmation");
	const result = [...dialog.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === label,
	);
	if (!result) throw new Error(`Expected confirmation button: ${label}`);
	return result;
}
function detailButton(name: string) {
	return container.querySelector<HTMLButtonElement>(
		`button[data-slot="item-card-primary"][aria-label="Open ${name} details"]`,
	);
}
function dialogStatus() {
	return [
		...document.querySelectorAll(
			'[role="dialog"] [data-slot="detail-list-item"]',
		),
	]
		.find((item) => item.querySelector("dt")?.textContent === "Status")
		?.querySelector(".cline-ui-detail-list-item__trailing")?.textContent;
}
async function render() {
	await act(async () => root.render(<Connectors />));
}

describe("ConnectorLogo", () => {
	let previousClassName: string;
	let previousTheme: string | undefined;

	beforeEach(() => {
		previousClassName = document.documentElement.className;
		previousTheme = document.documentElement.dataset.clineHubTheme;
	});

	afterEach(async () => {
		await act(async () => {
			document.documentElement.className = previousClassName;
			if (previousTheme === undefined) {
				delete document.documentElement.dataset.clineHubTheme;
			} else {
				document.documentElement.dataset.clineHubTheme = previousTheme;
			}
		});
	});

	it.each([
		"light",
		"dark",
	] as const)("uses the %s theme for CDN catalog logos", async (theme) => {
		applyHubTheme(theme);
		await act(async () =>
			root.render(
				<ConnectorLogo
					slug="github"
					name="GitHub"
					logo="https://logos.composio.dev/api/github?theme=light"
				/>,
			),
		);
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			`https://logos.composio.dev/api/github${theme === "dark" ? "?theme=dark" : ""}`,
		);
	});

	it("updates all mounted logos when the app theme changes", async () => {
		applyHubTheme("light");
		await act(async () =>
			root.render(
				<>
					<ConnectorLogo slug="github" name="GitHub" />
					<ConnectorLogo slug="freshbooks" name="FreshBooks" />
				</>,
			),
		);
		await act(async () => {
			applyHubTheme("dark");
		});
		expect(
			[...container.querySelectorAll("img")].map((img) => img.src),
		).toEqual([
			"https://logos.composio.dev/api/github?theme=dark",
			"https://logos.composio.dev/api/freshbooks?theme=dark",
		]);
		await act(async () => {
			applyHubTheme("light");
		});
		expect(
			[...container.querySelectorAll("img")].map((img) => img.src),
		).toEqual([
			"https://logos.composio.dev/api/github",
			"https://logos.composio.dev/api/freshbooks",
		]);
	});

	it("preserves external catalog logos, falling back to the CDN and local icon", async () => {
		applyHubTheme("dark");
		await act(async () =>
			root.render(
				<ConnectorLogo
					slug="github"
					name="GitHub"
					logo="https://example.com/github.png"
				/>,
			),
		);
		expect(container.querySelector("img")?.src).toBe(
			"https://example.com/github.png",
		);
		await act(async () => {
			container.querySelector("img")?.dispatchEvent(new Event("error"));
		});
		expect(container.querySelector("img")?.src).toBe(
			"https://logos.composio.dev/api/github?theme=dark",
		);
		await act(async () => {
			container.querySelector("img")?.dispatchEvent(new Event("error"));
		});
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("svg")).not.toBeNull();
		await act(async () => {
			applyHubTheme("light");
		});
		expect(container.querySelector("img")?.src).toBe(
			"https://logos.composio.dev/api/github",
		);
	});
});

describe("Customize connector catalog", () => {
	it.each([
		"catalog",
		"installed",
	] as const)("applies the shared category to %s connectors and restores All categories", async (variant) => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", categories: ["Communication"] },
				{ slug: "github", name: "GitHub", categories: ["Developer Tools"] },
			],
		});
		mocks.category = { id: "developer-tools", label: "Developer Tools" };
		await act(async () => root.render(<Connectors variant={variant} />));
		expect(detailButton("Gmail")).toBeNull();
		expect(
			container.querySelector('[aria-label="Suggested connectors"]'),
		).toBeNull();
		if (variant === "catalog") {
			expect(detailButton("GitHub")).not.toBeNull();
		} else {
			expect(container.textContent).toContain(
				"No connectors found in Developer Tools.",
			);
			expect(
				container.querySelector('[data-slot="section-heading"]')?.textContent,
			).toContain("Connectors0");
		}
		mocks.category = null;
		await act(async () => root.render(<Connectors variant={variant} />));
		expect(detailButton("Gmail")).not.toBeNull();
	});

	it.each([
		"catalog",
		"installed",
	] as const)("bypasses the shared category for global %s search results", async (variant) => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", categories: ["Communication"] },
			],
		});
		mocks.category = { id: "developer-tools", label: "Developer Tools" };
		await act(async () =>
			root.render(
				<Connectors variant={variant} searchQuery="gmail" searchResults />,
			),
		);
		expect(detailButton("Gmail")).not.toBeNull();
	});

	it("resets appended catalog pages when the shared category changes", async () => {
		let loadNextPage: (() => void) | undefined;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: IntersectionObserverCallback) {
					loadNextPage = () =>
						callback(
							[{ isIntersecting: true } as IntersectionObserverEntry],
							this as unknown as IntersectionObserver,
						);
				}
				observe() {}
				disconnect() {}
			},
		);
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: Array.from({ length: 50 }, (_, index) => ({
				slug: `app_${index}`,
				name: `App ${index}`,
				categories: [index < 30 ? "Communication" : "Developer Tools"],
			})),
		});
		await act(async () => root.render(<Connectors />));
		expect(detailButton("App 24")).toBeNull();
		await act(async () => loadNextPage?.());
		expect(detailButton("App 24")).not.toBeNull();
		mocks.category = { id: "communication", label: "Communication" };
		await act(async () => root.render(<Connectors />));
		expect(detailButton("App 23")).not.toBeNull();
		expect(detailButton("App 24")).toBeNull();
	});

	it("renders the cached catalog while a refresh is pending", async () => {
		mocks.cachedCatalog = {
			configured: true,
			toolkits: [{ slug: "github", name: "GitHub", recommended: true }],
		};
		mocks.catalog.mockResolvedValueOnce(mocks.cachedCatalog);
		await fetchComposioToolkitCatalog();
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_001);
		mocks.catalog.mockReturnValue(new Promise(() => {}));
		await render();
		expect(detailButton("GitHub")).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Loading connector catalog"]'),
		).toBeNull();
	});

	it.each([
		"loading",
		"error",
		"unavailable",
	])("retains the catalog heading while %s", async (state) => {
		mocks.statusMissing = state !== "unavailable";
		mocks.loadError = state === "error" ? "Network down" : null;
		mocks.configured = state !== "unavailable";
		await act(async () =>
			root.render(<Connectors catalogHeader={<h3>Connector catalog</h3>} />),
		);
		expect(container.querySelector("h3")?.textContent).toBe(
			"Connector catalog",
		);
		expect(
			container.querySelector('[aria-label="Suggested connectors"]'),
		).toBeNull();
	});
	it("omits discovery and the catalog heading in integrated search results", async () => {
		await act(async () =>
			root.render(
				<Connectors searchResults catalogHeader={<h3>Connector catalog</h3>} />,
			),
		);
		expect(container.textContent).not.toContain("Suggested");
		expect(container.textContent).not.toContain("Connector catalog");
	});
	it("connects inline, returns focus to details after failure, and retains disconnect in the dialog", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email" },
				{ slug: "github", name: "GitHub", description: "Code" },
				{
					slug: "googlecalendar",
					name: "Google Calendar",
					description: "Events",
				},
			],
		});
		await render();
		expect(container.textContent).toContain("GitHub");
		expect(container.textContent).toContain("Google Calendar");
		expect(container.textContent).not.toContain("Marketplace");
		expect(container.textContent).toContain("Connected");
		const connectButton = button("Connect");
		const githubDetails = detailButton("GitHub");
		await act(async () => {
			connectButton?.focus();
			connectButton?.click();
		});
		expect(mocks.connect).toHaveBeenCalledWith("github");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(detailButton("GitHub")?.querySelector("button")).toBeNull();
		mocks.actionError = {
			toolkit: "github",
			operation: "connect",
			message: "Could not connect",
		};
		await render();
		expect(connectButton?.isConnected).toBe(false);
		expect(document.activeElement).toBe(
			document.querySelector('[role="dialog"]'),
		);
		expect(dialogStatus()).toBe("Connection error");
		await act(async () => button("Close")?.click());
		await vi.waitFor(() => expect(document.activeElement).toBe(githubDetails));
		await act(async () => detailButton("Gmail")?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Gmail",
		);
		await act(async () => button("Disconnect")?.click());
		await act(async () => confirmationButton("Disconnect").click());
		expect(mocks.disconnect).toHaveBeenCalledWith("gmail");
	});

	it.each([
		"catalog",
		"installed",
	] as const)("requires confirmation to disconnect a connector from %s and preserves it on Cancel or Escape", async (variant) => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "gmail", name: "Gmail", description: "Email" }],
		});
		const renderView = async () => {
			await act(async () => root.render(<Connectors variant={variant} />));
		};
		await renderView();
		await act(async () => detailButton("Gmail")?.click());
		const uninstall = button("Disconnect");
		if (!uninstall) throw new Error("Expected connector Disconnect action");
		await act(async () => {
			uninstall.focus();
			uninstall.click();
		});
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain("Disconnect connector?");
		expect(
			document.querySelector('[role="alertdialog"]')?.textContent,
		).toContain('This will disconnect "Gmail"');
		expect(document.activeElement).toBe(confirmationButton("Cancel"));
		expect(mocks.disconnect).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(dialogStatus()).toBe("Connected");
		await vi.waitFor(() => expect(document.activeElement).toBe(uninstall));
		await act(async () => uninstall.click());
		await act(async () =>
			confirmationButton("Cancel").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		expect(mocks.disconnect).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(document.activeElement).toBe(uninstall));
		await act(async () => uninstall.click());
		await act(async () => confirmationButton("Disconnect").click());
		expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith("gmail");
		mocks.busyToolkit = "gmail";
		await renderView();
		expect(uninstall.disabled).toBe(true);
		await act(async () => uninstall.click());
		expect(mocks.disconnect).toHaveBeenCalledTimes(1);
	});

	it("keeps focus on the card when inline Connect becomes an auth warning", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "github", name: "GitHub", description: "Code" }],
		});
		await render();
		const connectButton = button("Connect");
		const opener = detailButton("GitHub");
		await act(async () => {
			connectButton?.focus();
			connectButton?.click();
		});
		expect(mocks.connect).toHaveBeenCalledWith("github");
		mocks.integrations = [
			{
				toolkit: "github",
				name: "GitHub",
				description: "Code",
				recommended: true,
				status: "pending",
			},
		];
		await render();
		expect(connectButton?.isConnected).toBe(false);
		expect(
			opener?.closest('[data-slot="item-card"]')?.querySelector("output")
				?.textContent,
		).toBe("Auth required");
		expect(document.activeElement).toBe(opener);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it.each([
		"catalog",
		"installed",
	] as const)("shows an auth warning for pending %s connectors and keeps cancellation in details", async (variant) => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "gmail", name: "Gmail", description: "Email" }],
		});
		mocks.integrations = [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Email",
				recommended: true,
				status: "pending",
			},
		];
		await act(async () => root.render(<Connectors variant={variant} />));
		const card = detailButton("Gmail")?.closest('[data-slot="item-card"]');
		const status = card?.querySelector("output");
		expect(status?.textContent).toBe("Auth required");
		expect(status?.classList.contains("text-warning-text")).toBe(true);
		expect(status?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(card?.querySelectorAll("button")).toHaveLength(1);
		await act(async () => detailButton("Gmail")?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Finish authorizing Gmail in your browser",
		);
		expect(dialogStatus()).toBe("Auth required");
		await act(async () => button("Cancel")?.click());
		expect(mocks.cancel).toHaveBeenCalledWith("gmail");
		expect(mocks.connect).not.toHaveBeenCalled();
	});

	it("supplies connection controls to custom rows and keeps pending actions and errors scoped to the connector", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail" },
				{ slug: "github", name: "GitHub" },
			],
		});
		mocks.integrations = [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Email",
				recommended: true,
				status: "pending",
			},
		];
		mocks.busyToolkit = "github";
		const renderCustom = () =>
			root.render(
				<Connectors
					renderItem={({ entry, actions, onOpenDetails, primaryRef }) => (
						<div data-connector={entry.slug}>
							<button ref={primaryRef} onClick={onOpenDetails} type="button">
								{entry.name}
							</button>
							{actions}
						</div>
					)}
				/>,
			);
		await act(async () => renderCustom());
		expect((button("Connect") as HTMLButtonElement).disabled).toBe(true);
		await act(async () => button("Connect")?.click());
		expect(mocks.connect).not.toHaveBeenCalled();
		expect(button("Cancel")).toBeUndefined();
		expect(
			container.querySelector('[data-connector="gmail"] output')?.textContent,
		).toBe("Auth required");
		await act(async () => button("Gmail")?.click());
		await act(async () => button("Cancel")?.click());
		expect(mocks.cancel).toHaveBeenCalledWith("gmail");
		await act(async () => button("Close")?.click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		mocks.actionError = {
			toolkit: "github",
			operation: "connect",
			message: "Could not connect GitHub",
		};
		await act(async () => renderCustom());
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(
			container.querySelector('[data-connector="github"] output'),
		).toBeNull();
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Could not connect GitHub");
		await act(async () => button("Close")?.click());

		mocks.busyToolkit = null;
		await act(async () => renderCustom());
		expect(
			container.querySelector('[data-connector="github"] output')?.textContent,
		).toBe("Connection error");
		expect(
			container.querySelector('[data-connector="gmail"] output')?.textContent,
		).toBe("Auth required");
		expect(button("Connect")).toBeUndefined();
		await act(async () => button("GitHub")?.click());
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Could not connect GitHub");
		await act(async () => dialogButton("Connect")?.click());
		expect(mocks.connect).toHaveBeenCalledWith("github");
		await act(async () => button("Close")?.click());
		mocks.connect.mockClear();
		mocks.actionError = null;
		await act(async () => renderCustom());
		await act(async () => button("Connect")?.click());
		expect(mocks.connect).toHaveBeenCalledWith("github");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();

		mocks.integrations = mocks.integrations.map((entry) => ({
			...entry,
			status: "connected",
		}));
		await act(async () => renderCustom());
		expect(
			container.querySelector('[data-connector="gmail"]')?.textContent,
		).toContain("Connected");
		expect(button("Cancel")).toBeUndefined();
		await act(async () => button("Gmail")?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Gmail",
		);
	});

	it("restores the originating custom row through its primary ref without card DOM selectors", async () => {
		mocks.integrations = [];
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "github", name: "GitHub" },
				{ slug: "gmail", name: "Gmail" },
			],
		});
		const renderCustom = () =>
			root.render(
				<Connectors
					searchResults
					renderItem={({ entry, actions, onOpenDetails, primaryRef }) => (
						<div data-connector={entry.slug}>
							<button ref={primaryRef} onClick={onOpenDetails} type="button">
								{entry.name}
							</button>
							{actions}
						</div>
					)}
				/>,
			);
		await act(async () => renderCustom());
		const github = container.querySelector('[data-connector="github"]');
		const opener = github?.querySelector("button");
		const connect = Array.from(github?.querySelectorAll("button") ?? []).find(
			(element) => element.textContent === "Connect",
		);
		expect(container.querySelector('[data-slot="item-card"]')).toBeNull();
		await act(async () => {
			connect?.focus();
			connect?.click();
		});
		expect(mocks.connect).toHaveBeenCalledExactlyOnceWith("github");
		expect(document.activeElement).toBe(opener);
		mocks.actionError = {
			toolkit: "github",
			operation: "connect",
			message: "Connection failed",
		};
		await act(async () => renderCustom());
		expect(connect?.isConnected).toBe(false);
		await act(async () => button("Close")?.click());
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("lists the first page in Browse and every match in search results", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: Array.from({ length: 25 }, (_, i) => ({
				slug: `app_${i}`,
				name: `App ${i}`,
				description: "An app",
			})),
		});
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		await render();
		expect(container.textContent).toContain("App 23");
		expect(container.textContent).not.toContain("App 24");
		await act(async () =>
			root.render(<Connectors searchQuery="App 24" searchResults />),
		);
		expect(container.textContent).toContain("App 24");
		expect(container.textContent).not.toContain("App 23");
	});

	it("shows catalog errors and retries in Customize", async () => {
		mocks.catalog
			.mockRejectedValueOnce(new Error("Service unavailable"))
			.mockResolvedValueOnce({
				configured: true,
				toolkits: [{ slug: "gmail", name: "Gmail" }],
			});
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Service unavailable",
		);
		await act(async () => button("Retry")?.click());
		expect(container.textContent).toContain("Gmail");
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});
});

describe("installed connectors", () => {
	it("shows only installed connectors, filtered by the page's search, with their actions", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email" },
				{ slug: "github", name: "GitHub", description: "Code" },
			],
		});
		await act(async () => root.render(<Connectors variant="installed" />));
		expect(mocks.catalog).toHaveBeenCalledOnce();
		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).not.toContain("GitHub");
		expect(
			Array.from(
				container.querySelectorAll("h3"),
				(heading) => heading.textContent,
			),
		).toEqual(["Connectors"]);
		expect(
			container.querySelector('[data-slot="section-heading"]')?.textContent,
		).toContain("Connectors1");
		// The page's own search field is the only one.
		expect(container.querySelector("input")).toBeNull();
		await act(async () =>
			root.render(<Connectors variant="installed" searchQuery="missing" />),
		);
		expect(container.textContent).toContain(
			'No connectors found for "missing".',
		);
		await act(async () =>
			root.render(<Connectors variant="installed" searchQuery="gmail" />),
		);
		expect(container.textContent).toContain("Gmail");
		await act(async () =>
			(
				container.querySelector(
					'[aria-label="Refresh connectors"]',
				) as HTMLElement
			).click(),
		);
		expect(mocks.refresh).toHaveBeenCalledOnce();
		expect(button("Disconnect")).toBeUndefined();
		expect(container.textContent).toContain("Connected");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(detailButton("Gmail")?.querySelector("button")).toBeNull();
		await act(async () => detailButton("Gmail")?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Disconnect",
		);
		expect(dialogStatus()).toBe("Connected");
		await act(async () => button("Disconnect")?.click());
		await act(async () => confirmationButton("Disconnect").click());
		expect(mocks.disconnect).toHaveBeenCalledWith("gmail");
	});

	it("shows installed connector failures in the status slot and keeps details in the dialog", async () => {
		mocks.actionError = {
			toolkit: "gmail",
			operation: "disconnect",
			message: "Could not disconnect Gmail",
		};
		await act(async () => root.render(<Connectors variant="installed" />));
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(
			container.querySelector('[data-slot="item-card"]')?.textContent,
		).not.toContain("Could not disconnect");
		expect(
			container.querySelector('[data-slot="item-card"] output')?.textContent,
		).toBe("Disconnect failed");
		expect(
			container.querySelector('[data-slot="item-card"]')?.textContent,
		).not.toContain("Connected");
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Could not disconnect Gmail");
		expect(dialogStatus()).toBe("Disconnect failed");
		expect(
			container
				.querySelector('[data-slot="item-card"] button')
				?.getAttribute("aria-label"),
		).toBe("Open Gmail details");
		expect(
			container.querySelectorAll('[data-slot="item-card"] button'),
		).toHaveLength(1);
		await act(async () => button("Disconnect")?.click());
		await act(async () => confirmationButton("Disconnect").click());
		expect(mocks.disconnect).toHaveBeenCalledWith("gmail");
	});

	it.each([
		["catalog", "not_connected"],
		["catalog", "connected"],
		["installed", "connected"],
	] as const)("labels persisted errors as connection errors in %s for %s connectors", async (variant, connection) => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "gmail", name: "Gmail", description: "Email" }],
		});
		mocks.integrations = mocks.integrations.map((integration) => ({
			...integration,
			status: connection,
			error: "The connection could not be verified",
		}));
		await act(async () => root.render(<Connectors variant={variant} />));
		const card = detailButton("Gmail")?.closest('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe("Connection error");
		expect(card?.querySelectorAll("button")).toHaveLength(1);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await act(async () => detailButton("Gmail")?.click());
		expect(
			document.querySelector(
				'[role="dialog"] [data-slot="detail-list-item"] .cline-ui-detail-list-item__description [role="alert"]',
			)?.textContent,
		).toBe("The connection could not be verified");
		expect(dialogStatus()).toBe("Connection error");
		expect(
			dialogButton(connection === "connected" ? "Disconnect" : "Connect"),
		).toBeDefined();
	});

	it("keeps pending authorization visible when cancellation fails and permits retry in details", async () => {
		mocks.integrations = mocks.integrations.map((integration) => ({
			...integration,
			status: "pending",
		}));
		mocks.actionError = {
			toolkit: "gmail",
			operation: "cancel",
			message: "Could not cancel authorization",
		};
		await act(async () => root.render(<Connectors variant="installed" />));
		const card = detailButton("Gmail")?.closest('[data-slot="item-card"]');
		expect(card?.querySelector("output")?.textContent).toBe("Auth required");
		expect(card?.querySelectorAll("button")).toHaveLength(1);
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Could not cancel authorization");
		expect(dialogStatus()).toBe("Auth required");
		await act(async () => button("Cancel")?.click());
		expect(mocks.cancel).toHaveBeenCalledWith("gmail");
	});

	it("links the centered empty installed state to Browse without suggestions", async () => {
		const onSelectType = vi.fn();
		mocks.integrations = [];
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider
					onSelectCategory={mocks.setCategory}
					onSelectType={onSelectType}
				>
					<Connectors variant="installed" />
				</CustomizationCategoryNavigationProvider>,
			),
		);
		const emptyState = container.querySelector('[data-slot="empty-state"]');
		expect(emptyState?.getAttribute("data-align")).toBe("center");
		expect(
			emptyState?.querySelector('[data-slot="empty-state-description"]')
				?.textContent,
		).toBe("No connectors found.");
		expect(container.textContent).not.toContain("below");
		expect(container.textContent).not.toContain("Suggested");
		const browse = emptyState?.querySelector("button");
		expect(browse?.textContent).toBe("Browse customizations");
		expect(emptyState?.querySelectorAll("button")).toHaveLength(1);
		await act(async () => browse?.click());
		expect(onSelectType).toHaveBeenCalledExactlyOnceWith("connector");
	});

	it("keeps connection controls on catalog cards in Browse", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "github", name: "GitHub", description: "Code" }],
		});
		await act(async () => root.render(<Connectors />));
		expect(container.textContent).toContain("GitHub");
		await act(async () => button("Connect")?.click());
		expect(mocks.connect).toHaveBeenCalledWith("github");
	});

	it.each([
		"category",
		"type",
	] as const)("selects a connector detail %s badge, closes the dialog, and restores focus", async (selection) => {
		const category = { id: "productivity", label: "Productivity" };
		const onSelectType = vi.fn();
		const onRestoreFocus = vi.fn(() =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Filter by category"]')
				?.focus(),
		);
		mocks.categories = [category];
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", categories: ["productivity"] },
			],
		});
		await act(async () =>
			root.render(
				<CustomizationCategoryNavigationProvider
					onSelectCategory={mocks.setCategory}
					onSelectType={onSelectType}
					onRestoreFocus={onRestoreFocus}
				>
					<button type="button" aria-label="Filter by category">
						All categories
					</button>
					<Connectors />
				</CustomizationCategoryNavigationProvider>,
			),
		);
		await act(async () => detailButton("Gmail")?.click());
		const categoryButton = document.querySelector<HTMLButtonElement>(
			'[role="dialog"] button[title="Filter by Productivity"]',
		);
		expect(categoryButton).not.toBeNull();
		expect(
			categoryButton
				?.closest('[data-slot="detail-list-item"]')
				?.querySelector("dt")?.textContent,
		).toBe("Category");
		const typeButton = document.querySelector<HTMLButtonElement>(
			'[role="dialog"] button[title="Browse Connectors"]',
		);
		expect(typeButton?.textContent).toBe("Connector");
		expect(typeButton?.closest('[data-slot="dialog-header"]')).not.toBeNull();
		const title = document.querySelector('[data-slot="dialog-title"]');
		expect(
			title &&
				typeButton &&
				typeButton.compareDocumentPosition(title) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await act(async () =>
			(selection === "category" ? categoryButton : typeButton)?.click(),
		);
		if (selection === "category") {
			expect(mocks.setCategory).toHaveBeenCalledExactlyOnceWith(category);
			expect(onSelectType).not.toHaveBeenCalled();
		} else {
			expect(onSelectType).toHaveBeenCalledExactlyOnceWith("connector");
			expect(mocks.setCategory).not.toHaveBeenCalled();
		}
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				container.querySelector('[aria-label="Filter by category"]'),
			),
		);
		expect(onRestoreFocus).toHaveBeenCalledOnce();
	});

	it("shows the catalog tool count in an accessible connector dialog", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email", toolsCount: 47 },
			],
		});
		await render();
		const opener = detailButton("Gmail");
		await act(async () => {
			opener?.focus();
			opener?.click();
		});
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
		const titleId = dialog?.getAttribute("aria-labelledby");
		const descriptionId = dialog?.getAttribute("aria-describedby");
		expect(titleId && document.getElementById(titleId)?.textContent).toBe(
			"Gmail",
		);
		expect(
			descriptionId && document.getElementById(descriptionId)?.textContent,
		).toBe("Email");
		expect(document.activeElement).toBe(dialog);
		const text = dialog?.textContent;
		expect(text).toContain("Tools47");
		expect(text).not.toContain("available in new sessions");
		await act(async () => {
			dialog?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it("keeps catalog metadata in details as it arrives without resizing installed cards", async () => {
		let resolveCatalog!: (response: {
			configured: boolean;
			toolkits: Array<{ slug: string; name: string; toolsCount: number }>;
		}) => void;
		mocks.catalog.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCatalog = resolve;
				}),
		);
		const renderInstalled = () =>
			root.render(<Connectors variant="installed" />);
		const installedCard = () =>
			container.querySelector('[aria-label="Open Gmail details"]');
		await act(async () => renderInstalled());
		expect(installedCard()?.textContent).not.toContain("tools");
		await act(async () =>
			resolveCatalog({
				configured: true,
				toolkits: [
					{ slug: "github", name: "GitHub", toolsCount: 99 },
					{ slug: "gmail", name: "Gmail catalog name", toolsCount: 47 },
				],
			}),
		);
		expect(installedCard()?.textContent).not.toContain("47 tools");
		expect(installedCard()?.textContent).not.toContain("99 tools");
		expect(installedCard()?.textContent).not.toContain("Gmail catalog name");
		await act(async () => (installedCard() as HTMLElement).click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Tools47",
		);
		await act(async () => button("Close")?.click());
		// Account invalidation reloads catalog data without changing connector identity.
		mocks.configured = false;
		await act(async () => {
			invalidateComposioCache();
			renderInstalled();
		});
		mocks.configured = true;
		await act(async () => renderInstalled());
		await act(async () =>
			resolveCatalog({
				configured: true,
				toolkits: [{ slug: "gmail", name: "Gmail", toolsCount: 53 }],
			}),
		);
		expect(installedCard()?.textContent).not.toContain("53 tools");
		await act(async () => (installedCard() as HTMLElement).click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Tools53",
		);
		expect(installedCard()?.textContent).not.toContain("47 tools");
	});

	it("omits an unknown tool count for a connected connector", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [{ slug: "gmail", name: "Gmail", description: "Email" }],
		});
		await render();
		await act(async () => detailButton("Gmail")?.click());
		const text = document.querySelector('[role="dialog"]')?.textContent;
		expect(text).toContain("Gmail");
		expect(text).not.toContain("Tools");
		expect(text).not.toContain("available in new sessions");
	});

	it("shows the empty state when no connectors are installed", async () => {
		mocks.integrations = [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Email",
				recommended: true,
				status: "not_connected",
			},
		];
		await act(async () => root.render(<Connectors variant="installed" />));
		const installed = container.querySelector("section");
		expect(
			container.querySelector('[data-slot="section-heading"]')?.textContent,
		).toContain("Connectors0");
		expect(installed?.textContent).toContain("No connectors found");
		expect(installed?.textContent).not.toContain("Gmail");
		expect(container.textContent).not.toContain("Suggested");
		expect(container.textContent).not.toContain("Browse");
	});

	it("opens suggested connector details by name and connects with the plus action", async () => {
		await render();
		const suggested = container.querySelector(
			'section[aria-label="Suggested connectors"]',
		);
		expect(suggested?.textContent).toContain("Organize your day");
		expect(suggested?.textContent).toContain("Debug production incidents");
		expect(
			suggested?.querySelector('[data-slot="section-heading-title"]')?.tagName,
		).toBe("H3");
		expect(
			suggested?.querySelector('[role="heading"][aria-level="4"]')?.textContent,
		).toBe("Organize your day");
		const opener = suggested?.querySelector<HTMLButtonElement>(
			'[aria-label="Open Sentry details"]',
		);
		await act(async () => {
			opener?.focus();
			opener?.click();
		});
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Sentry",
		);
		expect(mocks.connect).not.toHaveBeenCalled();
		expect(mocks.cancel).not.toHaveBeenCalled();
		await act(async () => button("Close")?.click());
		await vi.waitFor(() => expect(document.activeElement).toBe(opener));
		const install = suggested?.querySelector<HTMLButtonElement>(
			'[aria-label="Connect Sentry"]',
		);
		expect(install?.textContent).toBe("");
		expect(opener?.querySelector("button")).toBeNull();
		await act(async () => {
			install?.focus();
			install?.click();
		});
		expect(mocks.connect).toHaveBeenCalledExactlyOnceWith("sentry");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	it("hides a recipe once all of its connectors are connected", async () => {
		mocks.integrations = [
			["gmail", "Gmail"],
			["slack", "Slack"],
			["googlecalendar", "Google Calendar"],
		].map(([toolkit, name]) => ({
			toolkit,
			name,
			description: "",
			recommended: toolkit !== "slack",
			status: "connected" as const,
		}));
		await act(async () => root.render(<Connectors variant="catalog" />));
		expect(container.textContent).not.toContain("Organize your day");
		expect(container.textContent).toContain("Debug production incidents");
		// Connected connectors keep their details action without an install action.
		expect(container.querySelector('[aria-label="Connect Slack"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Connect Sentry"]'),
		).not.toBeNull();
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Open Slack details"]')
				?.click(),
		);
		expect(dialogStatus()).toBe("Connected");
		expect(mocks.connect).not.toHaveBeenCalled();
	});
	it("retains pending cancellation and scoped connection failures in Browse suggestions", async () => {
		mocks.integrations = [
			{
				toolkit: "sentry",
				name: "Sentry",
				description: "Errors",
				recommended: false,
				status: "pending",
			},
		];
		mocks.actionError = {
			toolkit: "sentry",
			operation: "connect",
			message: "Authorization failed",
		};
		mocks.busyToolkit = "linear";
		await render();
		const suggested = container.querySelector(
			'[aria-label="Suggested connectors"]',
		);
		expect(suggested?.querySelector('[role="alert"]')).toBeNull();
		expect(
			document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
		).toBe("Authorization failed");
		expect(
			suggested?.querySelector<HTMLButtonElement>(
				'[aria-label="Connect Linear"]',
			)?.disabled,
		).toBe(true);
		await act(async () =>
			suggested
				?.querySelector<HTMLButtonElement>('[aria-label="Cancel Sentry"]')
				?.click(),
		);
		expect(mocks.cancel).toHaveBeenCalledWith("sentry");
		expect(mocks.connect).not.toHaveBeenCalled();
		await act(async () => button("Close")?.click());
		const busyDetails = suggested?.querySelector<HTMLButtonElement>(
			'[aria-label="Open Linear details"]',
		);
		expect(busyDetails?.disabled).toBe(false);
		await act(async () => busyDetails?.click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Linear",
		);
		expect(mocks.connect).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("refreshes from the toolbar and keeps the list when a refresh fails (shared: %s)", async (shared) => {
		mocks.loadError = "Network down";
		await act(async () =>
			root.render(
				<CustomizeRefreshProvider enabled={shared}>
					<CustomizeRefreshButton />
					<Connectors variant="installed" />
				</CustomizeRefreshProvider>,
			),
		);
		expect(container.textContent).toContain("Gmail");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Network down",
		);
		expect(container.querySelectorAll('[aria-label^="Refresh "]')).toHaveLength(
			1,
		);
		await act(async () =>
			(
				container.querySelector(
					shared
						? '[aria-label="Refresh customizations"]'
						: '[aria-label="Refresh connectors"]',
				) as HTMLElement
			).click(),
		);
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it("lists installed connectors without showing recommendations", async () => {
		mocks.integrations = [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Email",
				recommended: true,
				status: "connected",
			},
			{
				toolkit: "github",
				name: "GitHub",
				description: "Code",
				recommended: true,
				status: "not_connected",
			},
		];
		await act(async () => root.render(<Connectors variant="installed" />));
		const installed = container.querySelector("section");
		expect(installed?.textContent).toContain("Gmail");
		expect(installed?.textContent).not.toContain("GitHub");
		expect(container.textContent).not.toContain("Recommended");
		await act(async () => detailButton("Gmail")?.click());
		await act(async () => button("Disconnect")?.click());
		await act(async () => confirmationButton("Disconnect").click());
		expect(mocks.disconnect).toHaveBeenCalledWith("gmail");
	});

	it("keeps suggestions before the catalog heading and hides them for a search", async () => {
		mocks.catalog.mockResolvedValue({
			configured: true,
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email" },
				{ slug: "github", name: "GitHub", description: "Code" },
				{ slug: "notion", name: "Notion", description: "Docs" },
			],
		});
		const renderCatalog = (searchQuery?: string) =>
			act(async () =>
				root.render(
					<Connectors
						catalogHeader={<h3>Connector catalog</h3>}
						searchQuery={searchQuery}
					/>,
				),
			);
		await renderCatalog();
		const suggestions = container.querySelector(
			'section[aria-label="Suggested connectors"]',
		);
		const catalogHeading = [...container.querySelectorAll("h3")].find(
			(heading) => heading.textContent === "Connector catalog",
		);
		expect(
			catalogHeading && suggestions?.compareDocumentPosition(catalogHeading),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(detailButton("Gmail")).not.toBeNull();
		expect(detailButton("GitHub")).not.toBeNull();
		await renderCatalog("notion");
		expect(
			container.querySelector('section[aria-label="Suggested connectors"]'),
		).toBeNull();
		expect(detailButton("Notion")).not.toBeNull();
		expect(detailButton("GitHub")).toBeNull();
		expect(container.textContent).toContain("Connector catalog");
		await renderCatalog("");
		expect(
			container.querySelector('section[aria-label="Suggested connectors"]'),
		).not.toBeNull();
	});

	it("waits for the account lookup before offering sign-in", async () => {
		mocks.configured = false;
		let resolveMe: (value: unknown) => void = () => {};
		mocks.invoke.mockImplementation(
			(command: string) =>
				new Promise((resolve) => {
					if (command === "cline_account") resolveMe = resolve;
					else resolve({});
				}),
		);
		await act(async () =>
			root.render(
				<AccountProvider>
					<Connectors variant="installed" />
				</AccountProvider>,
			),
		);
		expect(
			container.querySelector('[aria-label="Loading account"]'),
		).not.toBeNull();
		expect(button("Sign in")).toBeUndefined();
		await act(async () =>
			resolveMe({ email: "dev@cline.bot", displayName: "Dev" }),
		);
		expect(container.textContent).toContain(
			"Connectors aren't enabled for your account yet",
		);
	});

	it("offers Cline sign-in when connectors are unavailable and the user is signed out", async () => {
		mocks.configured = false;
		mocks.invoke.mockResolvedValue({
			signedIn: false,
			code: "ACCOUNT_NOT_AUTHENTICATED",
		});
		await act(async () =>
			root.render(
				<AccountProvider>
					<Connectors variant="installed" />
				</AccountProvider>,
			),
		);
		expect(container.textContent).toContain(
			"Sign in to Cline to use connectors",
		);
		expect(container.textContent).not.toContain("Browse");
		expect(
			container.querySelector(
				'img[src="https://logos.composio.dev/api/slack"]',
			),
		).not.toBeNull();
		await act(async () => button("Sign in")?.click());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"run_provider_oauth_login",
			{ provider: "cline" },
			expect.anything(),
		);
		expect(mocks.refresh).toHaveBeenCalled();
		await act(async () => button("Create account")?.click());
		expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://app.cline.bot");
	});

	it("explains the beta rollout when signed in without connector access", async () => {
		mocks.configured = false;
		mocks.invoke.mockResolvedValue({
			email: "dev@cline.bot",
			displayName: "Dev",
		});
		await act(async () =>
			root.render(
				<AccountProvider>
					<Connectors variant="installed" />
				</AccountProvider>,
			),
		);
		expect(container.textContent).toContain(
			"Connectors aren't enabled for your account yet",
		);
		expect(button("Sign in")).toBeUndefined();
		await act(async () => button("Check again")?.click());
		expect(mocks.refresh).toHaveBeenCalled();
	});

	it("shows catalog errors and retries in the Browse section", async () => {
		mocks.catalog
			.mockRejectedValueOnce(new Error("Service unavailable"))
			.mockResolvedValueOnce({
				configured: true,
				toolkits: [{ slug: "notion", name: "Notion" }],
			});
		await act(async () => root.render(<Connectors variant="catalog" />));
		expect(container.textContent).toContain("Service unavailable");
		await act(async () => button("Retry")?.click());
		expect(container.textContent).toContain("Notion");
		expect(container.textContent).not.toContain("Service unavailable");
	});
});

describe("Integrated connector search", () => {
	it("filters each list by the page's search without a search field of its own", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: [
				{ slug: "gmail", name: "Gmail", description: "Email" },
				{ slug: "github", name: "GitHub", description: "Code" },
			],
		});
		await act(async () =>
			root.render(<Connectors searchQuery="git" variant="installed" />),
		);
		expect(container.querySelector("input")).toBeNull();
		expect(
			container.querySelector('button[aria-label="Open Gmail details"]'),
		).toBeNull();
		expect(detailButton("GitHub")).toBeNull();
		await act(async () =>
			root.render(<Connectors searchQuery="git" variant="catalog" />),
		);
		expect(detailButton("GitHub")).not.toBeNull();
		expect(
			container.querySelector('section[aria-label="Suggested connectors"]'),
		).toBeNull();
		await act(async () =>
			root.render(<Connectors searchQuery="gmail" variant="installed" />),
		);
		expect(detailButton("Gmail")).not.toBeNull();
		expect(detailButton("GitHub")).toBeNull();
		await act(async () =>
			root.render(<Connectors searchQuery="" variant="installed" />),
		);
		expect(container.querySelector("input")).toBeNull();
	});

	it("searches installed slug-only entries and keeps connected status without discovery chrome", async () => {
		mocks.integrations = [
			{
				toolkit: "private-app",
				name: "",
				description: "",
				recommended: false,
				status: "connected",
			},
		];
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<Connectors
					searchQuery=" PRIVATE-App "
					variant="installed"
					searchResults
					onSummary={onSummary}
				/>,
			),
		);
		expect(detailButton("private-app")).not.toBeNull();
		expect(button("Disconnect")).toBeUndefined();
		expect(container.textContent).toContain("Connected");
		expect(container.querySelector("h2")).toBeNull();
		expect(container.textContent).not.toContain("Suggested");
		expect(container.querySelector("input")).toBeNull();
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "private-app",
			count: 1,
			loading: false,
			error: false,
		});
	});

	it("excludes installed connectors, reports all matching cards, and keeps inline connection actions", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: [
				{ slug: "gmail", name: "Gmail" },
				...Array.from({ length: 61 }, (_, i) => ({
					slug: `app-${i}`,
					name: `App ${i}`,
				})),
			],
		});
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<Connectors
					searchQuery=""
					searchResults
					excludeConnected
					onSummary={onSummary}
				/>,
			),
		);
		expect(container.querySelectorAll('[data-slot="item-card"]')).toHaveLength(
			61,
		);
		expect(detailButton("Gmail")).toBeNull();
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "",
			count: 61,
			loading: false,
			error: false,
		});
		await act(async () => button("Connect")?.click());
		expect(mocks.connect).toHaveBeenCalledWith("app-0");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it("reports catalog loading and errors without hiding the error behind an empty search state", async () => {
		let failCatalog: (error: Error) => void = () => {};
		mocks.catalog.mockImplementation(
			() =>
				new Promise((_, reject) => {
					failCatalog = reject;
				}),
		);
		const onSummary = vi.fn();
		await act(async () =>
			root.render(
				<Connectors
					searchQuery="missing"
					searchResults
					onSummary={onSummary}
				/>,
			),
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "missing",
			count: 0,
			loading: true,
			error: false,
		});
		await act(async () => failCatalog(new Error("Catalog offline")));
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Catalog offline",
		);
		expect(onSummary).toHaveBeenLastCalledWith({
			query: "missing",
			count: 0,
			loading: false,
			error: true,
		});
	});

	it("refreshes both mounted connector models after inventory invalidation", async () => {
		mocks.catalog.mockResolvedValue({
			toolkits: [{ slug: "gmail", name: "Gmail", description: "Email" }],
		});
		const update = () =>
			root.render(
				<>
					<section aria-label="Installed results">
						<Connectors variant="installed" searchQuery="gmail" searchResults />
					</section>
					<section aria-label="Available results">
						<Connectors
							variant="catalog"
							searchQuery="gmail"
							searchResults
							excludeConnected
						/>
					</section>
				</>,
			);
		await act(async () => update());
		const installed = container.querySelector(
			'section[aria-label="Installed results"]',
		);
		const available = container.querySelector(
			'section[aria-label="Available results"]',
		);
		expect(installed?.querySelector('[data-slot="item-card"]')).not.toBeNull();
		expect(available?.querySelector('[data-slot="item-card"]')).toBeNull();
		await act(async () => invalidateExtensionInventoryCache());
		expect(mocks.refresh).toHaveBeenCalledTimes(2);

		// Both hook refreshes resolve the disconnected inventory from the server.
		mocks.integrations = [];
		await act(async () => update());
		expect(installed?.querySelector('[data-slot="item-card"]')).toBeNull();
		expect(available?.querySelector('[data-slot="item-card"]')).not.toBeNull();
		const refreshCount = mocks.refresh.mock.calls.length;
		// Fresh response objects with the same statuses do not invalidate again.
		mocks.integrations = [];
		await act(async () => update());
		expect(mocks.refresh).toHaveBeenCalledTimes(refreshCount);
	});
});
