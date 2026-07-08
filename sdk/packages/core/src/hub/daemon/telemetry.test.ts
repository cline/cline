import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockIdentifyAccount,
	mockGetProviderSettings,
	mockFlush,
	mockDispose,
	mockTelemetryService,
} = vi.hoisted(() => ({
	mockIdentifyAccount: vi.fn(),
	mockGetProviderSettings: vi.fn(),
	mockFlush: vi.fn(async () => undefined),
	mockDispose: vi.fn(async () => undefined),
	mockTelemetryService: { capture: vi.fn() },
}));

vi.mock("../../services/telemetry/OpenTelemetryProvider", () => ({
	createConfiguredTelemetryHandle: vi.fn(() => ({
		telemetry: mockTelemetryService,
		flush: mockFlush,
		dispose: mockDispose,
	})),
}));

vi.mock("../../services/telemetry/core-events", () => ({
	identifyAccount: mockIdentifyAccount,
}));

vi.mock("../../services/storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
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
		mockDispose.mockClear();
	});

	it("identifies the cached cline account at startup", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: " usr-123 " },
		});
		const daemonTelemetry = createHubDaemonTelemetry();
		expect(daemonTelemetry.telemetry).toBe(mockTelemetryService);
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

	it("does not re-identify an unchanged account on refresh", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-123" },
		});
		createHubDaemonTelemetry();
		vi.advanceTimersByTime(30 * 60 * 1000);
		expect(mockIdentifyAccount).toHaveBeenCalledTimes(1);
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
});
