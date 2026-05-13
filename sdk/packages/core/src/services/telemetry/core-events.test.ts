import type { ITelemetryService } from "@cline/shared";
import { describe, expect, test, vi } from "vitest";
import {
	captureExtensionActivated,
	captureTelemetryOptOut,
	captureWorkspaceInitError,
	captureWorkspaceInitialized,
	captureWorkspacePathResolved,
} from "./core-events";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
import { TelemetryService } from "./TelemetryService";

interface TelemetryStub {
	telemetry: ITelemetryService;
	capture: ReturnType<typeof vi.fn>;
	captureRequired: ReturnType<typeof vi.fn>;
}

function createTelemetryStub(): TelemetryStub {
	const captureRequired = vi.fn();
	const capture = vi.fn();
	const telemetry = {
		capture,
		captureRequired,
		setDistinctId: vi.fn(),
		updateCommonProperties: vi.fn(),
		identify: vi.fn(),
	} as unknown as ITelemetryService;
	return { telemetry, capture, captureRequired };
}

function captureCallAt(
	stub: TelemetryStub,
	index: number,
): { event: string; properties?: Record<string, unknown> } {
	const call = stub.capture.mock.calls[index];
	if (!call) {
		throw new Error(`expected capture call at index ${index}`);
	}
	const [arg] = call as [
		{ event: string; properties?: Record<string, unknown> },
	];
	return arg;
}

describe("captureExtensionActivated", () => {
	test("emits user.extension_activated as a normal opt-out-respecting event", () => {
		const stub = createTelemetryStub();
		captureExtensionActivated(stub.telemetry);
		expect(stub.capture).toHaveBeenCalledTimes(1);
		expect(stub.captureRequired).not.toHaveBeenCalled();
		const { event, properties } = captureCallAt(stub, 0);
		expect(event).toBe("user.extension_activated");
		expect(properties).toBeUndefined();
	});

	test("no-ops when telemetry is undefined", () => {
		expect(() => captureExtensionActivated(undefined)).not.toThrow();
	});
});

describe("captureTelemetryOptOut", () => {
	test("emits user.opt_out as a required event", () => {
		const stub = createTelemetryStub();
		captureTelemetryOptOut(stub.telemetry);
		expect(stub.capture).not.toHaveBeenCalled();
		expect(stub.captureRequired).toHaveBeenCalledWith(
			"user.opt_out",
			undefined,
		);
	});
});

describe("captureWorkspaceInitialized", () => {
	test("emits workspace.initialized with derived flags", () => {
		const stub = createTelemetryStub();
		captureWorkspaceInitialized(stub.telemetry, {
			root_count: 1,
			vcs_types: ["git"],
			init_duration_ms: 92.7155,
			feature_flag_enabled: true,
		});
		expect(stub.capture).toHaveBeenCalledTimes(1);
		expect(stub.captureRequired).not.toHaveBeenCalled();
		const { event, properties } = captureCallAt(stub, 0);
		expect(event).toBe("workspace.initialized");
		expect(properties).toEqual({
			root_count: 1,
			vcs_types: ["git"],
			is_multi_root: false,
			has_git: true,
			has_mercurial: false,
			init_duration_ms: 92.7155,
			feature_flag_enabled: true,
		});
	});

	test("derives is_multi_root from root_count > 1", () => {
		const stub = createTelemetryStub();
		captureWorkspaceInitialized(stub.telemetry, {
			root_count: 3,
			vcs_types: ["git", "none", "Mercurial"],
		});
		const { properties } = captureCallAt(stub, 0);
		const props = properties as Record<string, unknown>;
		expect(props.is_multi_root).toBe(true);
		expect(props.has_git).toBe(true);
		expect(props.has_mercurial).toBe(true);
	});

	test("treats hg/Mercurial as Mercurial for has_mercurial", () => {
		const stub = createTelemetryStub();
		captureWorkspaceInitialized(stub.telemetry, {
			root_count: 1,
			vcs_types: ["hg"],
		});
		const { properties } = captureCallAt(stub, 0);
		const props = properties as Record<string, unknown>;
		expect(props.has_mercurial).toBe(true);
		expect(props.has_git).toBe(false);
	});

	test("only includes is_remote_workspace when supplied", () => {
		const stub = createTelemetryStub();
		captureWorkspaceInitialized(stub.telemetry, {
			root_count: 1,
			vcs_types: ["none"],
			is_remote_workspace: true,
		});
		const { properties } = captureCallAt(stub, 0);
		const props = properties as Record<string, unknown>;
		expect(props.is_remote_workspace).toBe(true);
	});

	test("no-ops when telemetry is undefined", () => {
		expect(() =>
			captureWorkspaceInitialized(undefined, {
				root_count: 1,
				vcs_types: ["none"],
			}),
		).not.toThrow();
	});
});

describe("captureWorkspaceInitError", () => {
	test("emits workspace.init_error with truncated error_message and defaulted workspace_count", () => {
		const stub = createTelemetryStub();
		const longMessage = "x".repeat(2000);
		const error = new Error(longMessage);
		error.name = "WorkspaceSetupError";
		captureWorkspaceInitError(stub.telemetry, error, {
			fallback_to_single_root: true,
		});
		expect(stub.capture).toHaveBeenCalledTimes(1);
		expect(stub.captureRequired).not.toHaveBeenCalled();
		const { event, properties } = captureCallAt(stub, 0);
		expect(event).toBe("workspace.init_error");
		const props = properties as Record<string, unknown>;
		expect(props.error_type).toBe("WorkspaceSetupError");
		expect((props.error_message as string | undefined)?.length).toBe(500);
		expect(props.fallback_to_single_root).toBe(true);
		expect(props.workspace_count).toBe(0);
	});

	test("respects supplied workspace_count", () => {
		const stub = createTelemetryStub();
		captureWorkspaceInitError(stub.telemetry, "boom", {
			fallback_to_single_root: false,
			workspace_count: 4,
		});
		const { properties } = captureCallAt(stub, 0);
		const props = properties as Record<string, unknown>;
		expect(props.error_type).toBe("Error");
		expect(props.error_message).toBe("boom");
		expect(props.workspace_count).toBe(4);
	});

	test("no-ops when telemetry is undefined", () => {
		expect(() =>
			captureWorkspaceInitError(undefined, "boom", {
				fallback_to_single_root: false,
			}),
		).not.toThrow();
	});
});

describe("captureWorkspacePathResolved", () => {
	test("emits workspace.path_resolved with snake_case fields", () => {
		const stub = createTelemetryStub();
		captureWorkspacePathResolved(stub.telemetry, {
			ulid: "ulid-1",
			context: "search_codebase",
			resolution_type: "hint_provided",
			hint_type: "workspace_name",
			resolution_success: true,
			target_workspace_index: 1,
			is_multi_root_enabled: true,
		});
		expect(stub.capture).toHaveBeenCalledTimes(1);
		expect(stub.captureRequired).not.toHaveBeenCalled();
		const { event, properties } = captureCallAt(stub, 0);
		expect(event).toBe("workspace.path_resolved");
		expect(properties).toEqual({
			ulid: "ulid-1",
			context: "search_codebase",
			resolution_type: "hint_provided",
			hint_type: "workspace_name",
			resolution_success: true,
			target_workspace_index: 1,
			is_multi_root_enabled: true,
		});
	});

	test("no-ops when telemetry is undefined", () => {
		expect(() =>
			captureWorkspacePathResolved(undefined, {
				ulid: "ulid-1",
				context: "search_codebase",
				resolution_type: "fallback_to_primary",
			}),
		).not.toThrow();
	});
});

/**
 * Telemetry-policy regression coverage.
 *
 * Background: an earlier rev of the activation/workspace funnel routed the
 * four event families
 *   - user.extension_activated
 *   - workspace.initialized
 *   - workspace.init_error
 *   - workspace.path_resolved
 * through `telemetry.captureRequired(...)`, which deliberately bypasses the
 * user's telemetry opt-out. That broadened the policy of `captureRequired`
 * (today only used by `OpenTelemetryProvider` for the
 * `telemetry.provider_created` heartbeat) to cover four new families of
 * non-essential events. The fix was to route them through `capture(...)`
 * so they respect the opt-out.
 *
 * These tests lock in that policy by constructing a real
 * {@link TelemetryService} backed by an adapter whose `isEnabled()`
 * returns `false`. A correctly-policed adapter drops `emit(...)` calls
 * when disabled but is allowed to honor `emitRequired(...)`. The helpers
 * below MUST call only `emit`, never `emitRequired`, so that a disabled
 * adapter never observes them as required.
 */
describe("telemetry policy: helpers respect telemetry opt-out", () => {
	function createDisabledAdapter(): {
		adapter: ITelemetryAdapter;
		emit: ReturnType<typeof vi.fn>;
		emitRequired: ReturnType<typeof vi.fn>;
	} {
		const emit = vi.fn();
		const emitRequired = vi.fn();
		const adapter: ITelemetryAdapter = {
			name: "disabled-test-adapter",
			emit: (event, properties) => {
				// Mirror the production contract: a disabled adapter drops
				// non-required events. We still record the attempt so the
				// test can assert that it *was* an `emit` (not an
				// `emitRequired`) call before the drop happened.
				emit(event, properties);
			},
			emitRequired: (event, properties) => {
				emitRequired(event, properties);
			},
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: () => false,
			flush: () => Promise.resolve(),
			dispose: () => Promise.resolve(),
		};
		return { adapter, emit, emitRequired };
	}

	test("captureExtensionActivated never invokes captureRequired", () => {
		const { adapter, emitRequired } = createDisabledAdapter();
		const service = new TelemetryService({
			distinctId: "test-distinct-id",
			adapters: [adapter],
		});
		captureExtensionActivated(service);
		expect(emitRequired).not.toHaveBeenCalled();
	});

	test("captureWorkspaceInitialized never invokes captureRequired", () => {
		const { adapter, emitRequired } = createDisabledAdapter();
		const service = new TelemetryService({
			distinctId: "test-distinct-id",
			adapters: [adapter],
		});
		captureWorkspaceInitialized(service, {
			root_count: 1,
			vcs_types: ["git"],
		});
		expect(emitRequired).not.toHaveBeenCalled();
	});

	test("captureWorkspaceInitError never invokes captureRequired", () => {
		const { adapter, emitRequired } = createDisabledAdapter();
		const service = new TelemetryService({
			distinctId: "test-distinct-id",
			adapters: [adapter],
		});
		captureWorkspaceInitError(service, "boom", {
			fallback_to_single_root: true,
		});
		expect(emitRequired).not.toHaveBeenCalled();
	});

	test("captureWorkspacePathResolved never invokes captureRequired", () => {
		const { adapter, emitRequired } = createDisabledAdapter();
		const service = new TelemetryService({
			distinctId: "test-distinct-id",
			adapters: [adapter],
		});
		captureWorkspacePathResolved(service, {
			ulid: "ulid-1",
			context: "search_codebase",
			resolution_type: "fallback_to_primary",
		});
		expect(emitRequired).not.toHaveBeenCalled();
	});

	test("a correctly-policed adapter drops these events when disabled", () => {
		// This test layers on top of the previous four to assert the *full*
		// end-to-end policy: when the adapter is disabled, a real adapter
		// implementation (not the stubbed pass-through above) drops
		// `emit(...)` calls. We verify here by using a stricter adapter
		// that early-returns from `emit` when `isEnabled() === false`,
		// matching the behavior of `OpenTelemetryAdapter` and
		// `TelemetryLoggerSink`.
		const dropped: string[] = [];
		const observed: string[] = [];
		const adapter: ITelemetryAdapter = {
			name: "policed-disabled-adapter",
			emit: (event) => {
				if (!adapter.isEnabled()) {
					dropped.push(event);
					return;
				}
				observed.push(event);
			},
			emitRequired: (event) => observed.push(event),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: () => false,
			flush: () => Promise.resolve(),
			dispose: () => Promise.resolve(),
		};
		const service = new TelemetryService({
			distinctId: "test-distinct-id",
			adapters: [adapter],
		});
		captureExtensionActivated(service);
		captureWorkspaceInitialized(service, {
			root_count: 1,
			vcs_types: ["git"],
		});
		captureWorkspaceInitError(service, "boom", {
			fallback_to_single_root: true,
		});
		captureWorkspacePathResolved(service, {
			ulid: "ulid-1",
			context: "search_codebase",
			resolution_type: "fallback_to_primary",
		});
		expect(observed).toEqual([]);
		expect(dropped).toEqual([
			"user.extension_activated",
			"workspace.initialized",
			"workspace.init_error",
			"workspace.path_resolved",
		]);
	});
});
