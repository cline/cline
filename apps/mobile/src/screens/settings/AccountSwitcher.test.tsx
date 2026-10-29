import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClineAuthStore, createInMemoryAuthStorage } from "@/cloud";
import { CloudAuthProvider, useCloudAccountScope } from "@/state/cloud-auth";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { AccountSwitcher } from "./AccountSwitcher";

const mocks = vi.hoisted(() => ({
	listAccounts: vi.fn(),
	switchAccount: vi.fn(),
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = mocks.listAccounts;
		switchAccount = mocks.switchAccount;
	},
}));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.listAccounts.mockResolvedValue([
		{ name: "Personal", active: false },
		{ name: "Team", active: true, organizationId: "org-1" },
	]);
	mocks.switchAccount.mockResolvedValue(undefined);
});
async function mount(store?: ClineAuthStore, collapsed = false) {
	let scope!: ReturnType<typeof useCloudAccountScope>;
	function Observe() {
		scope = useCloudAccountScope();
		return null;
	}
	let visible = true;
	function Harness() {
		return (
			<CloudAuthProvider store={store}>
				<Observe />
				{visible ? <AccountSwitcher /> : null}
			</CloudAuthProvider>
		);
	}
	const result = render(<Harness />);
	await act(async () => {});
	const row = (label: string) =>
		result.root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === label,
			)
			.at(-1);
	const expandChoices = () => {
		const button = result.root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityRole === "button" &&
					node.props.accessibilityLabel?.startsWith("Current account:"),
			)
			.at(-1);
		if (button?.props.accessibilityState?.expanded === false)
			act(() => button.props.onPress());
	};
	if (!collapsed) expandChoices();
	return {
		...result,
		row,
		expandChoices,
		getScope: () => scope,
		hide: () => {
			visible = false;
			result.renderer.update(<Harness />);
		},
		show: async () => {
			visible = true;
			result.renderer.update(<Harness />);
			await act(async () => {});
			expandChoices();
		},
	};
}
describe("Account settings switcher", () => {
	it("keeps choices collapsed until the user expands the current account", async () => {
		const screen = await mount(undefined, true);
		expect(screen.row("Team")).toBeUndefined();
		expect(screen.row("Personal")).toBeUndefined();
		expect(
			screen.row("Current account: Team")?.props.accessibilityState.expanded,
		).toBe(false);
		screen.expandChoices();
		expect(screen.row("Team")).toBeDefined();
		expect(screen.row("Personal")).toBeDefined();
		act(() => screen.row("Current account: Team")?.props.onPress());
		expect(screen.row("Team")).toBeUndefined();
		expect(mocks.switchAccount).not.toHaveBeenCalled();
	});

	it("ignores account discovery from an identity replaced before its response arrives", async () => {
		const credentials = {
			access: "a",
			refresh: "r",
			expires: Date.now() + 86400000,
			accountId: "person-a",
		};
		const store = new ClineAuthStore({
			storage: createInMemoryAuthStorage(credentials),
		});
		await store.getCredentials();
		const old =
			Promise.withResolvers<
				Array<{ name: string; active: boolean; organizationId?: string }>
			>();
		mocks.listAccounts.mockReturnValueOnce(old.promise).mockResolvedValueOnce([
			{ name: "Personal", active: true },
			{ name: "Current Org B", organizationId: "current-b", active: false },
		]);
		const screen = await mount(store);
		await act(async () => {
			await store.setCredentials({
				...credentials,
				access: "b",
				accountId: "person-b",
			});
		});
		await act(async () =>
			old.resolve([
				{ name: "Personal", active: true },
				{ name: "Retired Org A", organizationId: "retired-a", active: false },
			]),
		);
		screen.expandChoices();
		expect(screen.row("Current Org B")).toBeDefined();
		expect(screen.row("Retired Org A")).toBeUndefined();
	});
	it("retires a mounted previous identity's organization rows and rejects their captured click before a new identity renders", async () => {
		const credentials = {
			access: "a",
			refresh: "r",
			expires: Date.now() + 86400000,
			accountId: "person-a",
		};
		const store = new ClineAuthStore({
			storage: createInMemoryAuthStorage(credentials),
		});
		await store.getCredentials();
		mocks.listAccounts.mockResolvedValueOnce([
			{ name: "Personal", active: true },
			{ name: "Private Org A", organizationId: "private-a", active: false },
		]);
		const screen = await mount(store);
		const stalePress = screen.row("Private Org A")!.props.onPress;
		const next =
			Promise.withResolvers<
				Array<{ name: string; active: boolean; organizationId?: string }>
			>();
		mocks.listAccounts.mockReturnValueOnce(next.promise);
		await act(async () => {
			const changed = store.setCredentials({
				...credentials,
				access: "b",
				accountId: "person-b",
			});
			stalePress();
			await changed;
		});
		expect(mocks.switchAccount).not.toHaveBeenCalled();
		expect(screen.row("Private Org A")).toBeUndefined();
		expect(mocks.listAccounts).toHaveBeenCalledTimes(2);
		await act(async () =>
			next.resolve([
				{ name: "Personal", active: true },
				{ name: "Private Org B", organizationId: "private-b", active: false },
			]),
		);
		screen.expandChoices();
		expect(screen.row("Private Org B")).toBeDefined();
		expect(screen.row("Private Org A")).toBeUndefined();
	});
	it("keeps a remounted switcher disabled while the shared account RPC is pending", async () => {
		const pending = Promise.withResolvers<void>();
		mocks.switchAccount.mockReturnValue(pending.promise);
		const screen = await mount();
		act(() => screen.row("Personal")?.props.onPress());
		act(() => screen.hide());
		await act(async () => screen.show());
		screen.expandChoices();
		act(() => screen.row("Personal")?.props.onPress());
		expect(mocks.switchAccount).toHaveBeenCalledOnce();
		expect(screen.row("Personal")?.props.accessibilityState.disabled).toBe(
			true,
		);
		expect(screen.row("Team")?.props.accessibilityState.disabled).toBe(true);
		await act(async () => pending.resolve());
		expect(screen.getScope().scope).toEqual({
			organizationId: undefined,
			accountName: "Personal",
		});
		expect(screen.row("Personal")?.props.accessibilityState.checked).toBe(true);
		expect(screen.row("Personal")?.props.accessibilityState.disabled).toBe(
			false,
		);
	});
	it("shows the current Personal account even when there is nothing to switch", async () => {
		mocks.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
		const { row, root } = await mount();
		expect(row("Personal")).toBeUndefined();
		expect(row("Current account: Personal")).toBeDefined();
		expect(containsText(root, "Personal")).toBe(true);
	});
	it("disables account rows while a switch is pending", async () => {
		let complete!: () => void;
		mocks.switchAccount.mockReturnValue(
			new Promise<void>((resolve) => {
				complete = resolve;
			}),
		);
		const { row } = await mount();
		act(() => {
			row("Personal")?.props.onPress();
		});
		expect(row("Team")?.props.accessibilityState.disabled).toBe(true);
		act(() => {
			row("Personal")?.props.onPress();
		});
		expect(mocks.switchAccount).toHaveBeenCalledOnce();
		await act(async () => complete());
		expect(row("Personal")?.props.accessibilityState.checked).toBe(true);
		expect(row("Personal")?.props.accessibilityState.disabled).toBe(false);
	});
	it("switches Personal and organization through the existing API", async () => {
		const { row, getScope } = await mount();
		const completeOldRefresh = getScope().beginRefresh();
		expect(row("Team")?.props.accessibilityState.checked).toBe(true);
		await act(async () => row("Personal")?.props.onPress());
		expect(mocks.switchAccount).toHaveBeenLastCalledWith(undefined);
		expect(row("Personal")?.props.accessibilityState.checked).toBe(true);
		expect(getScope().scope).toEqual({
			organizationId: undefined,
			accountName: "Personal",
		});
		act(() => completeOldRefresh({ organizationId: "org-1" }));
		expect(getScope().scope).toEqual({
			organizationId: undefined,
			accountName: "Personal",
		});
		await act(async () => row("Team")?.props.onPress());
		expect(mocks.switchAccount).toHaveBeenLastCalledWith("org-1");
		expect(getScope().scope).toEqual({
			organizationId: "org-1",
			accountName: "Team",
		});
	});
	it("retains the active account and shows a readable failure", async () => {
		mocks.switchAccount.mockRejectedValue(
			new Error("Account unavailable. Try again."),
		);
		const { root, row } = await mount();
		await act(async () => row("Personal")?.props.onPress());
		expect(row("Team")?.props.accessibilityState.checked).toBe(true);
		expect(containsText(root, "Account unavailable. Try again.")).toBe(true);
	});
	it("does not switch the already-active account", async () => {
		const { row } = await mount();
		await act(async () => row("Team")?.props.onPress());
		expect(mocks.switchAccount).not.toHaveBeenCalled();
	});
	it("retries discovery after a load failure", async () => {
		mocks.listAccounts.mockRejectedValueOnce(new Error("Try again."));
		const { row } = await mount();
		await act(async () => row("Retry accounts")?.props.onPress());
		act(() => row("Current account: Team")?.props.onPress());
		expect(row("Team")).toBeDefined();
	});
});

it.each([
	"sign-out",
	"newer selection",
	"unmount then sign-out",
])("does not publish a pending account switch after %s", async (retirement) => {
	const pending = Promise.withResolvers<void>();
	mocks.switchAccount.mockReturnValue(pending.promise);
	const screen = await mount();
	act(() => screen.row("Personal")?.props.onPress());
	act(() => {
		if (retirement === "sign-out") screen.getScope().selectScope(undefined);
		else if (retirement === "newer selection")
			screen.getScope().selectScope({ organizationId: "new-scope" });
		else {
			screen.hide();
			screen.getScope().selectScope(undefined);
		}
	});
	await act(async () => pending.resolve());
	expect(screen.getScope().scope).toEqual(
		retirement === "newer selection"
			? { organizationId: "new-scope" }
			: undefined,
	);
	screen.unmount();
});

it("finishes the selected account switch when Settings is left before the response", async () => {
	const pending = Promise.withResolvers<void>();
	mocks.switchAccount.mockReturnValue(pending.promise);
	const screen = await mount();
	act(() => screen.row("Personal")?.props.onPress());
	act(() => screen.hide());
	await act(async () => pending.resolve());
	// The successful preference change belongs to the signed-in account, not
	// the Settings route. Home must use the same account as the server.
	expect(screen.getScope().scope).toEqual({
		organizationId: undefined,
		accountName: "Personal",
	});
	screen.unmount();
});

it("publishes an owned failure after Settings unmounts so Home can explain the retained account", async () => {
	const pending = Promise.withResolvers<void>();
	mocks.switchAccount.mockReturnValue(pending.promise);
	const screen = await mount();
	act(() => screen.row("Personal")?.props.onPress());
	expect(screen.getScope().selectionPending).toBe(true);
	act(() => screen.hide());
	await act(async () => pending.reject(new Error("Network unavailable")));
	expect(screen.getScope().selectionPending).toBe(false);
	expect(screen.getScope().scope).toEqual({
		organizationId: "org-1",
		accountName: "Team",
	});
	expect(screen.getScope().selectionError).toBe(
		"Account could not be changed. Your previous account is still selected.",
	);
});
