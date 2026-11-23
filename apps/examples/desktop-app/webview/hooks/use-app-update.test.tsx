// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	toast: vi.fn(),
	dismiss: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	isTauriAvailable: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
	toast: mocks.toast,
}));

beforeEach(() => {
	mocks.invoke.mockReset();
	mocks.dismiss.mockReset();
	mocks.toast.mockReset().mockReturnValue({ dismiss: mocks.dismiss });
});

async function runCheck(status: unknown) {
	mocks.invoke.mockResolvedValue(status);
	const { checkForUpdateAndNotify } = await import("./use-app-update");
	await checkForUpdateAndNotify();
	expect(mocks.invoke).toHaveBeenCalledWith("check_for_update_now");
	expect(mocks.toast).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({ title: "Checking for updates..." }),
	);
	expect(mocks.dismiss).toHaveBeenCalledOnce();
	return mocks.toast.mock.calls[1]?.[0];
}

describe("checkForUpdateAndNotify", () => {
	it("offers a restart when the check staged an update", async () => {
		const result = await runCheck({ state: "ready", version: "1.2.3" });

		expect(result).toMatchObject({ title: "Update ready: v1.2.3" });
		expect(result.action).toBeTruthy();
	});

	it("confirms when no update is available", async () => {
		const result = await runCheck({ state: "idle" });

		expect(result).toMatchObject({ title: "You're up to date" });
	});

	it("surfaces a failed check", async () => {
		const result = await runCheck({ state: "error", error: "offline" });

		expect(result).toMatchObject({
			variant: "destructive",
			title: "Update check failed",
			description: "offline",
		});
	});

	it("reports when the check could not run", async () => {
		mocks.invoke.mockRejectedValue(new Error("no bridge"));
		const { checkForUpdateAndNotify } = await import("./use-app-update");

		await checkForUpdateAndNotify();

		expect(mocks.toast).toHaveBeenLastCalledWith(
			expect.objectContaining({
				variant: "destructive",
				title: "Unable to check for updates",
			}),
		);
	});
});
