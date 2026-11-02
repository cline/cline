import { afterEach, describe, expect, it, vi } from "vitest";
import { observeAccountChange } from "./account-observer";
import type { SidecarContext } from "./types";
const mocks = vi.hoisted(() => ({
	settings: vi.fn(),
	identify: vi.fn(),
	clear: vi.fn(),
	flags: vi.fn(),
	reset: vi.fn(),
}));
vi.mock("@cline/core", () => ({
	ProviderSettingsManager: class {
		getProviderSettings = mocks.settings;
	},
	identifyAccount: mocks.identify,
	clearAccountTelemetryIdentity: mocks.clear,
}));
vi.mock("./feature-flags", () => ({
	identifyDesktopFeatureFlagsAccount: mocks.flags,
}));
vi.mock("./cloud-sessions", () => ({ resetCloudSessionManager: mocks.reset }));
vi.mock("./client-context", () => ({
	resolveDesktopTelemetryUser: (input?: { accountId: string }) => ({
		distinctId: input?.accountId ?? "device",
		...input,
	}),
}));
afterEach(() => vi.resetAllMocks());
describe("Hub account event observer", () => {
	it("updates Desktop identity after Hub-owned account metadata is persisted", async () => {
		mocks.settings.mockReturnValue({
			auth: {
				accountId: "account",
				email: "user@example.test",
				organizationId: "org",
			},
		});
		const ctx = { telemetry: {}, logger: {} } as SidecarContext;
		await observeAccountChange(ctx, {});
		expect(ctx.telemetryUser).toMatchObject({
			distinctId: "account",
			email: "user@example.test",
			organizationId: "org",
		});
		expect(mocks.flags).toHaveBeenCalledWith(
			{ id: "account", email: "user@example.test" },
			expect.any(Object),
		);
		expect(mocks.identify).toHaveBeenCalled();
		expect(mocks.reset).not.toHaveBeenCalled();
	});
	it("clears signed-out identity and resets cloud credentials even if old settings still exist", async () => {
		mocks.settings.mockReturnValue({ auth: { accountId: "old" } });
		const ctx = { telemetry: {}, logger: {} } as SidecarContext;
		await observeAccountChange(ctx, {
			signedOut: true,
			credentialsChanged: true,
		});
		expect(ctx.telemetryUser?.distinctId).toBe("device");
		expect(mocks.clear).toHaveBeenCalled();
		expect(mocks.reset).toHaveBeenCalledWith(ctx);
	});
});
