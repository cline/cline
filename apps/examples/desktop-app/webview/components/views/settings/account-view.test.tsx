// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountView } from "./account-view";

const { invoke, openExternalUrl, useAccount, applyAccountUser } = vi.hoisted(
	() => ({
		invoke: vi.fn(),
		openExternalUrl: vi.fn(),
		useAccount: vi.fn(),
		applyAccountUser: vi.fn(),
	}),
);
vi.mock("@/contexts/account-context", () => ({ useAccount }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
	openExternalUrl,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	openExternalUrl.mockReset();
	applyAccountUser.mockReset();
	useAccount.mockReturnValue({
		clineAppBaseUrl: undefined,
		applyAccountUser,
		refreshAccount: vi.fn(),
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AccountView usage table", () => {
	it("opens the full usage dashboard from the empty table footer", async () => {
		invoke.mockImplementation(
			async (_command: string, args?: Record<string, unknown>) => {
				switch (args?.operation) {
					case "fetchMe":
						return {
							id: "user-1",
							email: "beatrix@cline.bot",
							displayName: "Beatrix",
							createdAt: "2024-01-01T00:00:00Z",
							updatedAt: "2024-01-01T00:00:00Z",
							organizations: [],
						};
					case "fetchBalance":
						return { balance: 5_000_000 };
					case "fetchUserOrganizations":
						return [];
					case "fetchUsageTransactions":
						return [];
					default:
						return {};
				}
			},
		);

		await act(async () => {
			root.render(<AccountView />);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Beatrix");
		});

		const usageTab = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "usage",
		);
		expect(usageTab).toBeDefined();
		await act(async () => usageTab?.click());

		await vi.waitFor(() => {
			expect(container.textContent).toContain("See More");
			expect(container.textContent).toContain("No usage transactions yet.");
		});
		const seeMoreButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("See More"),
		);
		await act(async () => seeMoreButton?.click());

		expect(openExternalUrl).toHaveBeenCalledWith(
			"https://app.cline.bot/dashboard/usage",
		);
	});
});

describe("AccountView signed-out state", () => {
	it("recovers from a failed cancel and restores Sign in without reloading the overview", async () => {
		let rejectLogin!: (error: Error) => void;
		let failCancel = true;
		invoke.mockImplementation(async (command) => {
			if (command === "run_provider_oauth_login") {
				return await new Promise((_, reject) => {
					rejectLogin = reject;
				});
			}
			if (command === "cancel_provider_oauth_login") {
				if (failCancel) {
					failCancel = false;
					throw new Error("Connection unavailable");
				}
				rejectLogin(new Error("Sign-in cancelled"));
				return { cancelled: true };
			}
			return { signedIn: false, code: "ACCOUNT_NOT_AUTHENTICATED" };
		});
		await act(async () => root.render(<AccountView />));
		const button = (label: string) => {
			const found = Array.from(container.querySelectorAll("button")).find(
				(button) => button.textContent === label,
			);
			if (!found) throw new Error(`Missing button: ${label}`);
			return found;
		};
		await act(async () => button("Sign in").click());
		expect(button("Signing in").disabled).toBe(true);
		expect(container.textContent).not.toContain("Create account");
		await act(async () => button("Cancel").click());
		expect(container.textContent).toContain("Could not cancel sign-in");
		expect(button("Signing in").disabled).toBe(true);
		expect(button("Cancel").disabled).toBe(false);
		await act(async () => button("Cancel").click());
		expect(container.textContent).not.toContain("Could not cancel sign-in");
		expect(button("Sign in").disabled).toBe(false);
		expect(button("Create account").disabled).toBe(false);
		expect(container.textContent).not.toContain("Sign-in cancelled");
		expect(
			invoke.mock.calls.filter(([command]) => command === "cline_account"),
		).toHaveLength(1);
	});

	it("renders the sign-in prompt from the typed result and stops fetching account data", async () => {
		invoke.mockResolvedValue({
			signedIn: false,
			code: "ACCOUNT_NOT_AUTHENTICATED",
		});

		await act(async () => {
			root.render(<AccountView />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Sign in to Cline");
		});
		expect(container.textContent).not.toContain(
			"No Cline account auth token found",
		);
		// The auth state gates the rest of the overview: signed out means the
		// balance/organization commands are never fired.
		const accountCalls = invoke.mock.calls.filter(
			([command]) => command === "cline_account",
		);
		expect(accountCalls).toEqual([
			["cline_account", { action: "clineAccount", operation: "fetchMe" }],
		]);
	});

	it("signs out when the organization balance fetch reports the typed signed-out result", async () => {
		// The token can expire between the initial account fetches and the
		// organization-balance fetch; the typed result must sign the view out
		// rather than being coerced into a signed-in view with no balance.
		invoke.mockImplementation(
			async (_command: string, args?: Record<string, unknown>) => {
				switch (args?.operation) {
					case "fetchMe":
						return {
							id: "user-1",
							email: "beatrix@cline.bot",
							displayName: "Beatrix",
							createdAt: "2024-01-01T00:00:00Z",
							updatedAt: "2024-01-01T00:00:00Z",
							organizations: [],
						};
					case "fetchBalance":
						return { balance: 5_000_000 };
					case "fetchUserOrganizations":
						return [
							{
								organizationId: "org-1",
								name: "Cline",
								active: true,
								roles: ["member"],
							},
						];
					case "fetchOrganizationBalance":
						return { signedIn: false, code: "ACCOUNT_NOT_AUTHENTICATED" };
					default:
						return {};
				}
			},
		);

		await act(async () => {
			root.render(<AccountView />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Sign in to Cline");
		});
		expect(container.textContent).not.toContain("Beatrix");
	});

	it("renders account data when the session is signed in", async () => {
		invoke.mockImplementation(
			async (_command: string, args?: Record<string, unknown>) => {
				switch (args?.operation) {
					case "fetchMe":
						return {
							id: "user-1",
							email: "beatrix@cline.bot",
							displayName: "Beatrix",
							createdAt: "2024-01-01T00:00:00Z",
							updatedAt: "2024-01-01T00:00:00Z",
							organizations: [],
						};
					case "fetchBalance":
						return { balance: 5_000_000 };
					case "fetchUserOrganizations":
						return [];
					default:
						return {};
				}
			},
		);

		await act(async () => {
			root.render(<AccountView />);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Beatrix");
		});
		expect(container.textContent).not.toContain("Sign in to Cline");
	});
});

describe("AccountView privacy settings", () => {
	async function renderSignedInWithPrivacyLink(dataPrivacyPath?: string) {
		useAccount.mockReturnValue({
			clineAppBaseUrl: "https://staging-app.cline.bot",
			applyAccountUser,
			refreshAccount: vi.fn(),
		});
		invoke.mockImplementation(
			async (_command: string, args?: Record<string, unknown>) => {
				switch (args?.operation) {
					case "fetchMe":
						return {
							id: "user-1",
							email: "harrison@cline.bot",
							displayName: "Harrison",
							createdAt: "2024-01-01T00:00:00Z",
							updatedAt: "2024-01-01T00:00:00Z",
							organizations: [],
							dataPrivacyPath,
						};
					case "fetchBalance":
						return { balance: 5_000_000 };
					case "fetchUserOrganizations":
						return [];
					default:
						return {};
				}
			},
		);
		await act(async () => {
			root.render(<AccountView />);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("Harrison");
		});
	}

	const dashboardButton = () =>
		container.querySelector<HTMLButtonElement>(
			'button[title="Open dashboard"]',
		);

	const privacySettingsButton = () =>
		container.querySelector<HTMLButtonElement>(
			'button[title="Privacy settings"]',
		);

	it("hides the action when there is no privacy settings link", async () => {
		await renderSignedInWithPrivacyLink(undefined);

		expect(dashboardButton()).not.toBeNull();
		expect(privacySettingsButton()).toBeNull();
	});

	it("opens privacy settings and the dashboard on the sidecar's Cline app", async () => {
		await renderSignedInWithPrivacyLink("/dashboard/account?tab=privacy");

		await act(async () => privacySettingsButton()?.click());
		await act(async () => dashboardButton()?.click());

		expect(openExternalUrl).toHaveBeenNthCalledWith(
			1,
			"https://staging-app.cline.bot/dashboard/account?tab=privacy&client=desktop",
		);
		expect(openExternalUrl).toHaveBeenNthCalledWith(
			2,
			"https://staging-app.cline.bot/dashboard",
		);
	});

	it("publishes the user it loads so the shared link can follow it", async () => {
		await renderSignedInWithPrivacyLink("/dashboard/account?tab=privacy");

		expect(applyAccountUser).toHaveBeenCalledWith(
			expect.objectContaining({
				dataPrivacyPath: "/dashboard/account?tab=privacy",
			}),
		);
	});
});
