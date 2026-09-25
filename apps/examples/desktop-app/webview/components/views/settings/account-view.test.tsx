// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountView } from "./account-view";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke },
	openExternalUrl,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	openExternalUrl.mockReset();
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
		expect(container.textContent).not.toContain("Sign Out");
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

describe("AccountView error recovery", () => {
	const getButton = (label: string) => {
		const button = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === label,
		);
		expect(button).toBeDefined();
		return button as HTMLButtonElement;
	};

	it("allows signing out after an account-deleted error and prevents retry during sign-out", async () => {
		let finishSignOut!: () => void;
		invoke.mockRejectedValueOnce(new Error("user account has been deleted"));
		invoke.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishSignOut = resolve;
				}),
		);

		await act(async () => root.render(<AccountView />));
		expect(container.textContent).toContain("user account has been deleted");
		expect(container.textContent).not.toContain("Sign in to Cline");
		expect(invoke).toHaveBeenCalledTimes(1);

		await act(async () => getButton("Sign Out").click());
		expect(invoke).toHaveBeenLastCalledWith("save_provider_settings", {
			provider: "cline",
			api_key: "",
			settings: {
				auth: { accessToken: "", refreshToken: "", accountId: "" },
			},
		});
		expect(getButton("Signing Out").disabled).toBe(true);
		expect(getButton("Retry").disabled).toBe(true);
		await act(async () => getButton("Retry").click());
		expect(invoke).toHaveBeenCalledTimes(2);

		await act(async () => finishSignOut());
		expect(container.textContent).toContain("Sign in to Cline");
		expect(getButton("Sign in").disabled).toBe(false);
		expect(container.textContent).not.toContain(
			"user account has been deleted",
		);
		expect(container.textContent).not.toContain("Sign Out");
	});

	it("keeps sign-out available if clearing credentials fails", async () => {
		invoke.mockRejectedValueOnce(new Error("user account has been deleted"));
		invoke.mockRejectedValueOnce(new Error("Unable to save provider settings"));
		invoke.mockResolvedValueOnce({});

		await act(async () => root.render(<AccountView />));
		await act(async () => getButton("Sign Out").click());
		expect(container.textContent).toContain("Unable to save provider settings");
		expect(container.textContent).not.toContain("Sign in to Cline");
		expect(getButton("Sign Out").disabled).toBe(false);
		expect(getButton("Retry").disabled).toBe(false);

		await act(async () => getButton("Sign Out").click());
		expect(container.textContent).toContain("Sign in to Cline");
		expect(container.textContent).not.toContain(
			"Unable to save provider settings",
		);
	});

	it.each([
		"Network unavailable",
		"Unauthorized organization access",
	])("keeps %s retryable without automatically clearing credentials", async (message) => {
		invoke.mockRejectedValueOnce(new Error(message));
		invoke.mockResolvedValueOnce({
			id: "user-1",
			email: "beatrix@cline.bot",
			displayName: "Beatrix",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-01T00:00:00Z",
			organizations: [],
		});
		invoke.mockResolvedValueOnce({ balance: 5_000_000 });
		invoke.mockResolvedValueOnce([]);

		await act(async () => root.render(<AccountView />));
		expect(container.textContent).toContain(message);
		expect(container.textContent).not.toContain("Sign in to Cline");
		await act(async () => getButton("Retry").click());
		expect(container.textContent).toContain("Beatrix");
		expect(container.textContent).not.toContain(message);
		expect(
			invoke.mock.calls.every(([command]) => command === "cline_account"),
		).toBe(true);
	});
});
