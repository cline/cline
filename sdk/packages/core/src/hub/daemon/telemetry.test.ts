import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockClearAccountTelemetryIdentity,
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
		mockClearAccountTelemetryIdentity: vi.fn(),
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
	clearAccountTelemetryIdentity: mockClearAccountTelemetryIdentity,
	identifyAccount: mockIdentifyAccount,
}));

vi.mock("../../services/telemetry/distinct-id", () => ({
	resolveCoreDistinctId: () => "machine-123",
}));

vi.mock("../../services/storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
		constructor() {
			providerSettingsManagerConstructions.count += 1;
		}
		getProviderSettings = mockGetProviderSettings;
	},
}));

import {
	createHubDaemonTelemetry,
	hubDaemonResourceAttributes,
} from "./telemetry";

describe("createHubDaemonTelemetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		mockClearAccountTelemetryIdentity.mockClear();
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
					cline_type: "hub",
					platform: "cline-hub-daemon",
				}),
			}),
		);
		expect(mockIdentifyAccount).toHaveBeenCalledExactlyOnceWith(
			mockTelemetryService,
			{ id: "usr-123", provider: "cline" },
		);
	});

	it("carries a daemon-distinct trace resource identity", () => {
		mockGetProviderSettings.mockReturnValue(undefined);
		createHubDaemonTelemetry();
		// The daemon ships in the same binary as the CLI; without its own
		// service name, daemon-emitted spans would be indistinguishable from
		// CLI-local ones.
		expect(mockCreateConfiguredTelemetryHandle).toHaveBeenCalledWith(
			expect.objectContaining({
				serviceName: "cline-hub-daemon",
				serviceVersion: expect.any(String),
			}),
		);
	});

	it("publishes who launched the daemon as resource attributes", () => {
		mockGetProviderSettings.mockReturnValue(undefined);
		vi.stubEnv("CLINE_HUB_LAUNCHER_CLIENT", "cline-desktop");
		vi.stubEnv("CLINE_HUB_LAUNCHER_VERSION", "0.0.46");
		vi.stubEnv("CLINE_HUB_LAUNCHER_TRANSPORT", "local");
		try {
			const daemonTelemetry = createHubDaemonTelemetry();
			expect(daemonTelemetry.launcher).toEqual({
				client: "cline-desktop",
				version: "0.0.46",
				transport: "local",
			});
			// A desktop session hosted by a CLI-started hub (or the reverse)
			// is only attributable through the daemon's resource, since the
			// span's clientName describes the session's client, not the host.
			// Claimed, not read: hosted sessions must not inherit the stamp.
			expect(process.env.CLINE_HUB_LAUNCHER_CLIENT).toBeUndefined();
			expect(process.env.CLINE_HUB_LAUNCHER_VERSION).toBeUndefined();
			expect(process.env.CLINE_HUB_LAUNCHER_TRANSPORT).toBeUndefined();
			expect(mockCreateConfiguredTelemetryHandle).toHaveBeenCalledWith(
				expect.objectContaining({
					resourceAttributes: expect.objectContaining({
						"cline.hub.launcher.client": "cline-desktop",
						"cline.hub.launcher.version": "0.0.46",
						"cline.hub.launcher.transport": "local",
						"cline.hub.build_id": expect.any(String),
						"cline.hub.runtime": expect.any(String),
					}),
				}),
			);
		} finally {
			vi.unstubAllEnvs();
		}
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

	it("attaches persisted organization context to the identity", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: {
				accountId: "usr-123",
				organizationId: "org-1",
				organizationName: "Acme",
				memberId: "member-9",
			},
		});
		createHubDaemonTelemetry();
		expect(mockIdentifyAccount).toHaveBeenCalledExactlyOnceWith(
			mockTelemetryService,
			{
				id: "usr-123",
				provider: "cline",
				organizationId: "org-1",
				organizationName: "Acme",
				memberId: "member-9",
			},
		);
	});

	it("re-identifies when the active organization changes for the same account", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-123", organizationId: "org-1" },
		});
		createHubDaemonTelemetry();
		expect(mockIdentifyAccount).toHaveBeenCalledTimes(1);

		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-123", organizationId: "org-2" },
		});
		vi.advanceTimersByTime(5 * 60 * 1000);
		expect(mockIdentifyAccount).toHaveBeenCalledTimes(2);
		expect(mockIdentifyAccount).toHaveBeenLastCalledWith(
			mockTelemetryService,
			expect.objectContaining({ id: "usr-123", organizationId: "org-2" }),
		);
	});

	it("restores anonymous process identity when the cached account signs out", () => {
		mockGetProviderSettings.mockReturnValue({
			auth: { accountId: "usr-123", organizationId: "org-1" },
		});
		createHubDaemonTelemetry();
		expect(mockIdentifyAccount).toHaveBeenCalledTimes(1);

		mockGetProviderSettings.mockReturnValue(undefined);
		vi.advanceTimersByTime(5 * 60 * 1000);

		expect(mockClearAccountTelemetryIdentity).toHaveBeenCalledExactlyOnceWith(
			mockTelemetryService,
			"machine-123",
		);
		vi.advanceTimersByTime(5 * 60 * 1000);
		expect(mockClearAccountTelemetryIdentity).toHaveBeenCalledTimes(1);
	});

	it("does not clear a known identity for a transient settings read failure", () => {
		mockGetProviderSettings.mockReturnValue({ auth: { accountId: "usr-123" } });
		createHubDaemonTelemetry();

		mockGetProviderSettings.mockImplementation(() => {
			throw new Error("temporary settings failure");
		});
		vi.advanceTimersByTime(5 * 60 * 1000);

		expect(mockClearAccountTelemetryIdentity).not.toHaveBeenCalled();
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

describe("hubDaemonResourceAttributes", () => {
	it("falls back to unknown launcher fields and strips the executable path", () => {
		expect(
			hubDaemonResourceAttributes(undefined, {
				buildId: "build-1",
				execPath: "C:\\Program Files\\Cline\\cline-cli.exe",
			}),
		).toEqual({
			"cline.hub.build_id": "build-1",
			"cline.hub.runtime": "cline-cli",
			"cline.hub.launcher.client": "unknown",
			"cline.hub.launcher.version": "unknown",
			"cline.hub.launcher.transport": "local",
		});
		expect(
			hubDaemonResourceAttributes(
				{ client: "cline-cli", version: "3.0.72", transport: "ssh" },
				{ buildId: "build-2", execPath: "/home/dev/.cline/remote/cline" },
			),
		).toMatchObject({
			"cline.hub.runtime": "cline",
			"cline.hub.launcher.client": "cline-cli",
			"cline.hub.launcher.version": "3.0.72",
			"cline.hub.launcher.transport": "ssh",
		});
	});
});
