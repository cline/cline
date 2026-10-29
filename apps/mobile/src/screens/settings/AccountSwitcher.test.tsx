import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
async function mount() {
	let scope!: ReturnType<typeof useCloudAccountScope>;
	function Observe() {
		scope = useCloudAccountScope();
		return null;
	}
	let visible = true;
	function Harness() {
		return (
			<CloudAuthProvider>
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
	return {
		...result,
		row,
		getScope: () => scope,
		hide: () => {
			visible = false;
			result.renderer.update(<Harness />);
		},
		show: () => {
			visible = true;
			result.renderer.update(<Harness />);
		},
	};
}
describe("Account settings switcher", () => {
	it("keeps a remounted switcher disabled while the shared account RPC is pending", async () => {
		const pending = Promise.withResolvers<void>();
		mocks.switchAccount.mockReturnValue(pending.promise);
		const screen = await mount();
		act(() => screen.row("Personal")?.props.onPress());
		act(() => screen.hide());
		await act(async () => screen.show());
		act(() => screen.row("Personal")?.props.onPress());
		expect(mocks.switchAccount).toHaveBeenCalledOnce();
		expect(screen.row("Personal")?.props.accessibilityState.disabled).toBe(
			true,
		);
		expect(screen.row("Team")?.props.accessibilityState.disabled).toBe(true);
		await act(async () => pending.resolve());
		expect(screen.getScope().scope).toEqual({ organizationId: undefined });
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
		expect(getScope().scope).toEqual({ organizationId: undefined });
		act(() => completeOldRefresh({ organizationId: "org-1" }));
		expect(getScope().scope).toEqual({ organizationId: undefined });
		await act(async () => row("Team")?.props.onPress());
		expect(mocks.switchAccount).toHaveBeenLastCalledWith("org-1");
		expect(getScope().scope).toEqual({ organizationId: "org-1" });
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
	expect(screen.getScope().scope).toEqual({ organizationId: undefined });
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
	expect(screen.getScope().scope).toEqual({ organizationId: "org-1" });
	expect(screen.getScope().selectionError).toBe(
		"Account could not be changed. Your previous account is still selected.",
	);
});
