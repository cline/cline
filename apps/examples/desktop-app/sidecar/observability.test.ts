import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	captureExtensionActivated: vi.fn(),
	createClineTelemetryServiceConfig: vi.fn((config: unknown) => config),
	createConfiguredTelemetryHandle: vi.fn(),
	disposeTelemetry: vi.fn(async () => {}),
	disposeLogger: vi.fn(),
	identifyAccount: vi.fn(),
	setSdkLogger: vi.fn(),
}));

const logger = {
	debug: vi.fn(),
	log: vi.fn(),
	error: vi.fn(),
};
const telemetry = { capture: vi.fn() };

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		captureExtensionActivated: mocks.captureExtensionActivated,
		createClineTelemetryServiceConfig: mocks.createClineTelemetryServiceConfig,
		createConfiguredTelemetryHandle: mocks.createConfiguredTelemetryHandle,
		identifyAccount: mocks.identifyAccount,
		ProviderSettingsManager: class {
			getProviderSettings() {
				return { auth: { accountId: "account-1" } };
			}
		},
		setSdkLogger: mocks.setSdkLogger,
	};
});

vi.mock("./logging", () => ({
	createDesktopLoggerAdapter: () => ({
		core: logger,
		dispose: mocks.disposeLogger,
	}),
}));

const reportShellBreadcrumbs = vi.hoisted(() => vi.fn(() => 0));
vi.mock("./shell-breadcrumbs", () => ({
	reportShellBreadcrumbs,
}));

describe("desktop observability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createConfiguredTelemetryHandle.mockReturnValue({
			telemetry,
			dispose: mocks.disposeTelemetry,
		});
	});

	it("configures desktop telemetry, identity, activation, and lifecycle", async () => {
		const { createDesktopObservability } = await import("./observability");
		const observability = createDesktopObservability();

		expect(mocks.createClineTelemetryServiceConfig).toHaveBeenCalledWith({
			metadata: expect.objectContaining({
				cline_type: "desktop",
				platform: "Cline Code",
			}),
		});
		expect(mocks.createConfiguredTelemetryHandle).toHaveBeenCalledWith(
			expect.objectContaining({ logger }),
		);
		expect(mocks.identifyAccount).toHaveBeenCalledWith(telemetry, {
			id: "account-1",
			provider: "cline",
		});
		expect(mocks.captureExtensionActivated).toHaveBeenCalledWith(telemetry);
		expect(mocks.setSdkLogger).toHaveBeenCalledWith(logger);

		// Deferred off the boot path, so it must not have run synchronously.
		expect(reportShellBreadcrumbs).not.toHaveBeenCalled();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(reportShellBreadcrumbs).toHaveBeenCalledWith(telemetry, logger);

		await observability.dispose();
		await observability.dispose();

		expect(mocks.disposeTelemetry).toHaveBeenCalledTimes(1);
		expect(mocks.setSdkLogger).toHaveBeenLastCalledWith(undefined);
		expect(mocks.disposeLogger).toHaveBeenCalledTimes(1);
	});
});
