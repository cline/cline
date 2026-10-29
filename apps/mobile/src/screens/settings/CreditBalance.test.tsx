import { AppState, type AppStateStatus } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import { SessionSidebar } from "../home/SessionSidebar";
import { CreditBalance, SidebarAccountSummary } from "./CreditBalance";

const fixture = vi.hoisted(() => ({
	scope: undefined as
		| { organizationId?: string; accountName?: string }
		| undefined,
	selectionPending: false,
	account: { phase: "signed-in" },
	balance: vi.fn(),
	store: { getValidAccessToken: vi.fn(), identityVersion: 0 },
}));
vi.mock("@/state/cloud-auth", () => ({
	useCloudAuth: () => ({ store: fixture.store, account: fixture.account }),
	useCloudAccountScope: () => ({
		scope: fixture.scope,
		selectionPending: fixture.selectionPending,
	}),
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		creditBalance = fixture.balance;
	},
}));
beforeEach(() => {
	vi.clearAllMocks();
	fixture.scope = {};
	fixture.selectionPending = false;
	fixture.account.phase = "signed-in";
	fixture.store.identityVersion = 0;
	fixture.balance.mockResolvedValue(12.34);
});
afterEach(() => vi.restoreAllMocks());

describe("Settings credit balance", () => {
	it.each([
		0, 12.34, -1.55,
	])("shows the actual %s balance directly", async (dollars) => {
		fixture.balance.mockResolvedValue(dollars);
		const screen = render(<CreditBalance />);
		await act(async () => {});
		expect(
			findByLabel(
				screen.root,
				`Credit balance: ${dollars.toFixed(2)} US dollars`,
			),
		).toBeDefined();
		expect(fixture.balance).toHaveBeenCalledExactlyOnceWith(undefined);
	});
	it("waits for account discovery and discards an old account response", async () => {
		fixture.scope = undefined;
		const screen = render(<CreditBalance />);
		await act(async () => {});
		expect(fixture.balance).not.toHaveBeenCalled();
		let finish!: (value: number) => void;
		fixture.balance.mockImplementationOnce(
			() =>
				new Promise<number>((resolve) => {
					finish = resolve;
				}),
		);
		fixture.scope = { organizationId: "org-old" };
		act(() => screen.renderer.update(<CreditBalance />));
		fixture.scope = { organizationId: "org-new" };
		fixture.balance.mockResolvedValue(98.76);
		await act(async () => screen.renderer.update(<CreditBalance />));
		await act(async () => finish(999));
		expect(containsText(screen.root, "Organization credit balance")).toBe(true);
		expect(
			findByLabel(screen.root, "Credit balance: 98.76 US dollars"),
		).toBeDefined();
		expect(
			findByLabel(screen.root, "Credit balance: 999.00 US dollars"),
		).toBeUndefined();
	});
	it("shows an actionable error, retries, and refreshes after foregrounding", async () => {
		let foreground!: (state: AppStateStatus) => void;
		const remove = vi.fn();
		vi.spyOn(AppState, "addEventListener").mockImplementation(
			(_type, listener) => {
				foreground = listener;
				return { remove };
			},
		);
		fixture.balance.mockRejectedValueOnce(new Error("private server response"));
		const screen = render(<CreditBalance />);
		await act(async () => {});
		expect(containsText(screen.root, "Credit balance unavailable")).toBe(true);
		expect(containsText(screen.root, "private server response")).toBe(false);
		await act(async () =>
			findByLabel(screen.root, "Retry credit balance")?.props.onPress(),
		);
		expect(
			findByLabel(screen.root, "Credit balance: 12.34 US dollars"),
		).toBeDefined();
		fixture.balance.mockResolvedValue(11.11);
		await act(async () => foreground("active"));
		expect(
			findByLabel(screen.root, "Credit balance: 11.11 US dollars"),
		).toBeDefined();
		screen.unmount();
		expect(remove).toHaveBeenCalledOnce();
	});
});

describe("Compact drawer account summary", () => {
	it("does not mount credit requests inside a closed drawer", async () => {
		const props = {
			rows: [],
			now: 0,
			onClose: () => {},
			onNew: () => {},
			onOpen: () => {},
			onOpenSettings: () => {},
		};
		const screen = render(<SessionSidebar {...props} open={false} />);
		await act(async () => {});
		expect(fixture.balance).not.toHaveBeenCalled();
		await act(async () =>
			screen.renderer.update(<SessionSidebar {...props} open />),
		);
		expect(fixture.balance).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(findByLabel(screen.root, "Account: Personal")).toBeDefined();
		act(() =>
			screen.renderer.update(<SessionSidebar {...props} open={false} />),
		);
		expect(
			findByLabel(screen.root, "Credit balance: 12.34 US dollars"),
		).toBeUndefined();
	});
	it("shows accepted account name and scoped credit without discovering accounts", async () => {
		fixture.scope = { organizationId: "org-1", accountName: "Team mobile" };
		const open = vi.fn();
		const screen = render(<SidebarAccountSummary onPress={open} />);
		await act(async () => {});
		expect(findByLabel(screen.root, "Account: Team mobile")).toBeDefined();
		expect(
			findByLabel(screen.root, "Credit balance: 12.34 US dollars"),
		).toBeDefined();
		expect(findByLabel(screen.root, "Refresh credit balance")).toBeUndefined();
		expect(fixture.balance).toHaveBeenCalledExactlyOnceWith("org-1");
		act(() =>
			findByLabel(screen.root, "Account: Team mobile")?.props.onPress(),
		);
		expect(open).toHaveBeenCalledOnce();
	});
	it("does not guess Personal or request credit while scope is unknown or signed out", async () => {
		fixture.scope = undefined;
		const screen = render(<SidebarAccountSummary onPress={() => {}} />);
		await act(async () => {});
		expect(
			findByLabel(screen.root, "Account: Account unavailable"),
		).toBeDefined();
		expect(containsText(screen.root, "Personal")).toBe(false);
		expect(fixture.balance).not.toHaveBeenCalled();
		fixture.scope = {};
		fixture.account.phase = "signed-out";
		act(() =>
			screen.renderer.update(<SidebarAccountSummary onPress={() => {}} />),
		);
		expect(containsText(screen.root, "Personal")).toBe(false);
		expect(fixture.balance).not.toHaveBeenCalled();
	});
	it("uses an honest organization fallback without rendering an internal ID", async () => {
		fixture.scope = { organizationId: "org-internal-123" };
		const screen = render(<SidebarAccountSummary onPress={() => {}} />);
		await act(async () => {});
		expect(
			findByLabel(screen.root, "Account: Organization account"),
		).toBeDefined();
		expect(containsText(screen.root, "org-internal-123")).toBe(false);
	});
	it("hides previous credit while an account selection is pending", async () => {
		const screen = render(<SidebarAccountSummary onPress={() => {}} />);
		await act(async () => {});
		expect(
			findByLabel(screen.root, "Credit balance: 12.34 US dollars"),
		).toBeDefined();
		fixture.selectionPending = true;
		act(() =>
			screen.renderer.update(<SidebarAccountSummary onPress={() => {}} />),
		);
		expect(
			findByLabel(screen.root, "Credit balance: 12.34 US dollars"),
		).toBeUndefined();
		expect(containsText(screen.root, "Changing account…")).toBe(true);
	});
	it("rejects a previous identity's late same-scope balance", async () => {
		const old = Promise.withResolvers<number>();
		fixture.balance
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(21.21);
		const screen = render(<CreditBalance compact />);
		fixture.store.identityVersion += 1;
		await act(async () => screen.renderer.update(<CreditBalance compact />));
		await act(async () => old.resolve(999));
		expect(
			findByLabel(screen.root, "Credit balance: 21.21 US dollars"),
		).toBeDefined();
		expect(
			findByLabel(screen.root, "Credit balance: 999.00 US dollars"),
		).toBeUndefined();
	});
});
