import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Hoist the spy so vi.mock's factory can reference it without TDZ errors.
const hoisted = vi.hoisted(() => ({
	captureExtensionActivated: vi.fn(),
	identifyAccount: vi.fn(),
	getCliTelemetryService: vi.fn(() => undefined),
}));

vi.mock("@cline/core", () => ({
	captureExtensionActivated: hoisted.captureExtensionActivated,
	identifyAccount: hoisted.identifyAccount,
	// CLI telemetry singleton path normally pulls in
	// `createConfiguredTelemetryHandle` and `createClineTelemetryServiceConfig`;
	// stub them so the test never spins up a real OpenTelemetry provider.
	createClineTelemetryServiceConfig: vi.fn(() => ({})),
	createConfiguredTelemetryHandle: vi.fn(() => ({
		telemetry: undefined,
		provider: undefined,
		flush: vi.fn(),
		dispose: vi.fn(),
	})),
	registerDisposable: vi.fn(),
	TelemetryLoggerSink: class {},
}));

vi.mock("./telemetry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./telemetry")>();
	return {
		...actual,
		getCliTelemetryService: hoisted.getCliTelemetryService,
	};
});

import {
	captureCliExtensionActivated,
	identifyCliTelemetryAccount,
} from "./telemetry";
import { resetCliExtensionActivationForTests } from "./telemetry.test-helpers";

describe("captureCliExtensionActivated", () => {
	beforeEach(() => {
		hoisted.captureExtensionActivated.mockClear();
		hoisted.identifyAccount.mockClear();
		hoisted.getCliTelemetryService.mockClear();
		resetCliExtensionActivationForTests();
	});

	afterEach(() => {
		resetCliExtensionActivationForTests();
	});

	test("emits user.extension_activated on first call via core helper", () => {
		captureCliExtensionActivated();
		expect(hoisted.captureExtensionActivated).toHaveBeenCalledTimes(1);
	});

	test("memoizes emission across subsequent calls", () => {
		captureCliExtensionActivated();
		captureCliExtensionActivated();
		captureCliExtensionActivated();
		expect(hoisted.captureExtensionActivated).toHaveBeenCalledTimes(1);
	});

	test("identifies the active organization before capturing activation", () => {
		const account = {
			id: "user-1",
			email: "user@example.com",
			provider: "cline",
			organizationId: "org-1",
			organizationName: "Acme Corp",
			memberId: "member-9",
		};
		captureCliExtensionActivated(undefined, account);

		expect(hoisted.identifyAccount).toHaveBeenCalledTimes(1);
		expect(hoisted.identifyAccount).toHaveBeenCalledWith(undefined, account);

		// identifyAccount must be invoked strictly before captureExtensionActivated
		// so the org_id common properties land on user.extension_activated.
		const identifyOrder =
			hoisted.identifyAccount.mock.invocationCallOrder[0] ?? Infinity;
		const captureOrder =
			hoisted.captureExtensionActivated.mock.invocationCallOrder[0] ??
			-Infinity;
		expect(identifyOrder).toBeLessThan(captureOrder);
		expect(hoisted.captureExtensionActivated).toHaveBeenCalledTimes(1);
	});

	test("does not call identifyAccount when no account context is provided", () => {
		captureCliExtensionActivated();
		expect(hoisted.identifyAccount).not.toHaveBeenCalled();
	});
});

describe("identifyCliTelemetryAccount", () => {
	beforeEach(() => {
		hoisted.identifyAccount.mockClear();
		hoisted.getCliTelemetryService.mockClear();
	});

	test("forwards account context to core identifyAccount on the CLI telemetry service", () => {
		const account = {
			id: "user-2",
			organizationId: "org-2",
			organizationName: "Beta Inc",
			memberId: "member-7",
			provider: "cline",
		};
		identifyCliTelemetryAccount(account);
		expect(hoisted.identifyAccount).toHaveBeenCalledWith(undefined, account);
	});
});
