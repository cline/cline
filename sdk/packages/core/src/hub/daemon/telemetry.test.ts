import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockIdentifyAccount,
	mockGetProviderSettings,
	mockFlush,
	mockDispose,
	mockTelemetryService,
	mockCreateConfiguredTelemetryHandle,
	providerSettingsManagerConstructions,
} = vi.hoisted(() => {
	const telemetry = { capture: vi.fn() };
	const mockFlush = vi.fn(async () => undefined);
	const mockDispose = vi.fn(async () => undefined);
	return {
		mockIdentifyAccount: vi.fn(),
		mockGetProviderSettings: vi.fn(),
		mockFlush,
		mockDispose,
		mockTelemetryService: telemetry,
		mockCreateConfiguredTelemetryHandle: vi.fn(() => ({
			telemetry,
			flush: mockFlush,
			dispose: mockDispose,
		})),
		providerSettingsManagerConstructions: { count: 0 },
	};
});

vi.mock("../../services/telemetry/OpenTelemetryProvider", () => ({
	createConfiguredTelemetryHandle: mockCreateConfiguredTelemetryHandle,
}));

vi.mock("../../services/telemetry/core-events", () => ({
	identifyAccount: mockIdentifyAccount,
}));

vi.mock("../../services/storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
		constructor() {
			providerSettingsManagerConstructions.count += 1;
		}
		getProviderSettings = mockGetProviderSettings;
	},
}));

import { createHubDaemonTelemetry } from "./telemetry";

describe("createHubDaemonTelemetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		mockIdentifyAccount.mockClear();
		mockGetProviderSettings.mockClear();
		mockFlush.mockClear();
		mockFlush.mockImplementation(async () => undefined);
		mockDispose.mockClear();
		mockCreateConfiguredTelemetryHandle.mockClear();
		providerSettingsManagerConstructions.count = 0;
	});

	it("identifies the cached cline account at startup", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: " usr-123 " },
		});
		const daemonTelemetry = createHubDaemonTelemetry();
		expect(daemonTelemetry.telemetry).toBe(mockTelemetryService);
		expect(mockCreateConfiguredTelemetryHandle).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					cline_type: "cli",
					platform: "cline-hub-daemon",
				}),
			}),
		);
		expect(mockIdentifyAccount).toHaveBeenCalledExactlyOnceWith(
			mockTelemetryService,
			{ id: "usr-123", provider: "cline" },
		);
	});

	it("stays anonymous when no cached account exists, then identifies once the user logs in", () => {
		mockGetProviderSettings.mockReturnValue(undefined);
		createHubDaemonTelemetry();
		expect(mockIdentifyAccount).not.toHaveBeenCalled();

		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-456" },
		});
		vi.advanceTimersByTime(5 * 60 * 1000);
		expect(mockIdentifyAccount).toHaveBeenCalledExactlyOnceWith(
			mockTelemetryService,
			{ id: "usr-456", provider: "cline" },
		);
	});

	it("does not re-identify an unchanged account and reuses one settings manager", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-123" },
		});
		createHubDaemonTelemetry();
		vi.advanceTimersByTime(30 * 60 * 1000);
		expect(mockIdentifyAccount).toHaveBeenCalledTimes(1);
		expect(providerSettingsManagerConstructions.count).toBe(1);
	});

	it("survives provider settings read failures", () => {
		mockGetProviderSettings.mockImplementation(() => {
			throw new Error("corrupt settings");
		});
		expect(() => createHubDaemonTelemetry()).not.toThrow();
		expect(mockIdentifyAccount).not.toHaveBeenCalled();
	});

	it("flushes and disposes the handle and stops the refresh timer on dispose", async () => {
		mockGetProviderSettings.mockReturnValue(undefined);
		const daemonTelemetry = createHubDaemonTelemetry();
		await daemonTelemetry.dispose();
		expect(mockFlush).toHaveBeenCalledTimes(1);
		expect(mockDispose).toHaveBeenCalledTimes(1);

		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-789" },
		});
		vi.advanceTimersByTime(30 * 60 * 1000);
		expect(mockIdentifyAccount).not.toHaveBeenCalled();
	});

	it("does not let a hung exporter block dispose past the deadline", async () => {
		mockGetProviderSettings.mockReturnValue(undefined);
		mockFlush.mockImplementation(() => new Promise<undefined>(() => undefined));
		const daemonTelemetry = createHubDaemonTelemetry();
		const disposed = daemonTelemetry.dispose();
		await vi.advanceTimersByTimeAsync(5_000);
		await expect(disposed).resolves.toBeUndefined();
	});
});
