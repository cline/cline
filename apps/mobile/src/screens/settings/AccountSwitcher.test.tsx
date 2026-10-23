import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { CloudAuthProvider, useCloudAccountScope } from "@/state/cloud-auth";
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
	const result = render(
		<CloudAuthProvider>
			<Observe />
			<AccountSwitcher />
		</CloudAuthProvider>,
	);
	await act(async () => {});
	const row = (label: string) =>
		result.root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === label,
			)
			.at(-1);
	return { ...result, row, getScope: () => scope };
}
describe("Account settings switcher", () => {
	it("hides the switcher when only the personal account exists", async () => {
		mocks.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
		const { row } = await mount();
		expect(row("Personal")).toBeUndefined();
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
