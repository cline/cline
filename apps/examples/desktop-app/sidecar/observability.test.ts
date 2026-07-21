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
const runtimeInfo = {
	app: { name: "Cline Code" as const, version: "1.2.3" },
	sdk: { coreVersion: "4.5.6" },
	runtime: {
		name: "bun" as const,
		version: "1.3.4",
		nodeVersion: "v24.0.0",
	},
	os: {
		platform: "darwin",
		name: "Darwin",
		version: "Darwin Kernel Version 25",
		release: "25.0.0",
		arch: "arm64",
	},
	environment: { pathSource: "shell" as const, pathChanged: true },
};

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
		const observability = createDesktopObservability(runtimeInfo);

		expect(mocks.createClineTelemetryServiceConfig).toHaveBeenCalledWith({
			metadata: expect.objectContaining({
				cline_type: "desktop",
				platform: "Cline Code",
				platform_version: "1.2.3",
				extension_version: "1.2.3",
				os_type: "darwin",
				os_version: "Darwin Kernel Version 25",
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

		await observability.dispose();
		await observability.dispose();

		expect(mocks.disposeTelemetry).toHaveBeenCalledTimes(1);
		expect(mocks.setSdkLogger).toHaveBeenLastCalledWith(undefined);
		expect(mocks.disposeLogger).toHaveBeenCalledTimes(1);
	});
});
