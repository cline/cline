// @vitest-environment jsdom

import type { ClineAccountUser } from "@cline/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopTransportState } from "@/lib/desktop-transport";
import {
	ACCOUNT_IDENTITY_STORAGE_KEY,
	AccountProvider,
	isSignedOutAccountError,
	parseCachedAccountUser,
	useAccount,
} from "./account-context";

const { invoke, subscribeTransportState } = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribeTransportState: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribeTransportState },
}));

type TransportStateHandler = (state: DesktopTransportState) => void;
let transportStateHandlers: Set<TransportStateHandler>;

function setTransportState(state: DesktopTransportState) {
	for (const handler of transportStateHandlers) {
		handler(state);
	}
}

function makeUser(overrides: Partial<ClineAccountUser> = {}): ClineAccountUser {
	return {
		id: "user-1",
		email: "beatrix@cline.bot",
		displayName: "Beatrix",
		photoUrl: "",
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2024-01-01T00:00:00Z",
		organizations: [],
		...overrides,
	};
}

function Probe() {
	const { user, activeOrganization, privacySettingsUrl } = useAccount();
	return (
		<div>
			<span data-testid="account-name">{user?.displayName ?? "none"}</span>
			<span data-testid="account-org">
				{activeOrganization?.name ?? "none"}
			</span>
			<span data-testid="privacy-settings-url">
				{privacySettingsUrl ?? "none"}
			</span>
		</div>
	);
}

let container: HTMLDivElement;
let root: Root;

function probeText(testId: string): string | null | undefined {
	return container.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	invoke.mockReset();
	transportStateHandlers = new Set();
	subscribeTransportState.mockImplementation(
		(handler: TransportStateHandler) => {
			transportStateHandlers.add(handler);
			handler("connected");
			return () => transportStateHandlers.delete(handler);
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("account context", () => {
	it("parses only cached payloads that look like an account user", () => {
		expect(parseCachedAccountUser(null)).toBeNull();
		expect(parseCachedAccountUser("not json")).toBeNull();
		expect(parseCachedAccountUser(JSON.stringify({ user: 42 }))).toBeNull();
		expect(
			parseCachedAccountUser(JSON.stringify({ user: makeUser() }))?.displayName,
		).toBe("Beatrix");
	});

	it("classifies signed-out errors separately from transient failures", () => {
		expect(
			isSignedOutAccountError(new Error("No Cline account auth token found")),
		).toBe(true);
		expect(
			isSignedOutAccountError(
				new Error(
					'OAuth credentials for provider "cline" are no longer valid. Re-run authentication for this provider.',
				),
			),
		).toBe(true);
		expect(isSignedOutAccountError(new Error("fetch failed"))).toBe(false);
	});

	it("fetches the signed-in user on mount and caches the identity", async () => {
		invoke.mockResolvedValue(
			makeUser({
				organizations: [
					{
						active: true,
						memberId: "member-1",
						name: "Cline Bot Inc",
						organizationId: "org-1",
						roles: ["admin"],
					},
				],
			}),
		);

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("account-name")).toBe("Beatrix");
			expect(probeText("account-org")).toBe("Cline Bot Inc");
		});
		expect(invoke).toHaveBeenCalledWith("cline_account", {
			action: "clineAccount",
			operation: "fetchMe",
		});
		expect(
			parseCachedAccountUser(
				window.localStorage.getItem(ACCOUNT_IDENTITY_STORAGE_KEY),
			)?.email,
		).toBe("beatrix@cline.bot");
	});

	it("links to privacy settings on the sidecar's Cline app", async () => {
		invoke.mockImplementation(async (command: string) =>
			command === "get_cline_app_base_url"
				? "https://staging-app.cline.bot"
				: makeUser({ dataPrivacyPath: "/dashboard/account?tab=privacy" }),
		);

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("privacy-settings-url")).toBe(
				"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
			);
		});
	});

	it("looks up the sidecar's Cline app again after reconnecting", async () => {
		let sidecarReportsClineApp = false;
		invoke.mockImplementation(async (command: string) => {
			if (command !== "get_cline_app_base_url") {
				return makeUser({ dataPrivacyPath: "/dashboard/account?tab=privacy" });
			}
			if (!sidecarReportsClineApp) {
				throw new Error("Desktop backend transport unavailable");
			}
			return "https://staging-app.cline.bot";
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("account-name")).toBe("Beatrix");
		});
		expect(probeText("privacy-settings-url")).toBe("none");

		sidecarReportsClineApp = true;
		await act(async () => {
			setTransportState("reconnecting");
			setTransportState("connected");
		});

		await vi.waitFor(() => {
			expect(probeText("privacy-settings-url")).toBe(
				"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
			);
		});
	});

	it("adopts a user another view loads after the mount fetch failed", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_cline_app_base_url") {
				return "https://staging-app.cline.bot";
			}
			throw new Error("fetch failed");
		});

		function ApplyUserProbe() {
			const { applyAccountUser } = useAccount();
			return (
				<button
					type="button"
					onClick={() =>
						applyAccountUser(
							makeUser({ dataPrivacyPath: "/dashboard/account?tab=privacy" }),
						)
					}>
					apply
				</button>
			);
		}

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
					<ApplyUserProbe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("account-name")).toBe("none");
		});
		expect(probeText("privacy-settings-url")).toBe("none");

		await act(async () => {
			container.querySelector("button")?.click();
		});

		expect(probeText("account-name")).toBe("Beatrix");
		expect(probeText("privacy-settings-url")).toBe(
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
		);
	});

	it("treats the typed not-authenticated result as signed out", async () => {
		window.localStorage.setItem(
			ACCOUNT_IDENTITY_STORAGE_KEY,
			JSON.stringify({ user: makeUser() }),
		);
		invoke.mockResolvedValue({
			signedIn: false,
			code: "ACCOUNT_NOT_AUTHENTICATED",
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("account-name")).toBe("none");
		});
		expect(
			window.localStorage.getItem(ACCOUNT_IDENTITY_STORAGE_KEY),
		).toBeNull();
	});

	it("clears the cached identity when the account is signed out", async () => {
		window.localStorage.setItem(
			ACCOUNT_IDENTITY_STORAGE_KEY,
			JSON.stringify({ user: makeUser() }),
		);
		invoke.mockRejectedValue(new Error("No Cline account auth token found"));

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(probeText("account-name")).toBe("none");
		});
		expect(
			window.localStorage.getItem(ACCOUNT_IDENTITY_STORAGE_KEY),
		).toBeNull();
	});

	it("keeps the cached identity when the refresh fails transiently", async () => {
		window.localStorage.setItem(
			ACCOUNT_IDENTITY_STORAGE_KEY,
			JSON.stringify({ user: makeUser() }),
		);
		invoke.mockRejectedValue(
			new Error("Desktop backend transport unavailable"),
		);

		await act(async () => {
			root.render(
				<AccountProvider>
					<Probe />
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(invoke).toHaveBeenCalled();
		});
		expect(probeText("account-name")).toBe("Beatrix");
		expect(
			window.localStorage.getItem(ACCOUNT_IDENTITY_STORAGE_KEY),
		).not.toBeNull();
	});
});
