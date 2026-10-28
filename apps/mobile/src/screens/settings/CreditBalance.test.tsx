import { AppState, type AppStateStatus } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import { CreditBalance } from "./CreditBalance";

const fixture = vi.hoisted(() => ({
	scope: undefined as { organizationId?: string } | undefined,
	balance: vi.fn(),
	store: { getValidAccessToken: vi.fn() },
}));
vi.mock("@/state/cloud-auth", () => ({
	useCloudAuth: () => ({ store: fixture.store }),
	useCloudAccountScope: () => ({ scope: fixture.scope }),
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		creditBalance = fixture.balance;
	},
}));
beforeEach(() => {
	vi.clearAllMocks();
	fixture.scope = {};
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
